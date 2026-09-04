import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./env";
import { isSuccessfulOrder, orderEmailKey } from "./orderEmail/dashboard";
import { accountJigLines, accountPaymentLines, isWarmupOrder } from "./orderEmail/performance";
import type { AccountPerformance } from "./orderEmail/performance";
import { isOpenAiMisspellConfigured } from "./openaiMisspell";
import type {
  OrderAnalysisCause,
  OrderAnalysisRecord,
  OrderAnalysisResult,
  OrderAnalysisSeverity,
  OrderRetailer,
  ParsedOrder,
} from "./types";

const DEFAULT_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini";
const DISPLAY_MAX = 72;
export const ANALYSIS_PROMPT_VERSION = 2;

export const ORDER_ANALYSIS_CAUSES: readonly OrderAnalysisCause[] = [
  "street_too_aggressive",
  "street_type_combo",
  "unit_line_unrecognized",
  "name_too_aggressive",
  "name_card_mismatch",
  "geocodio_fail",
  "master_mismatch",
  "payment_or_card",
  "email_flagged",
  "no_warmup",
  "sku_pattern",
  "timing_cluster",
  "insufficient_data",
];

const CAUSE_SET = new Set<string>(ORDER_ANALYSIS_CAUSES);

export const ORDER_ANALYSIS_SYSTEM_PROMPT = `You are an order-risk analyst for a US checkout-profile tool (Target first).
Return JSON only. Be terse. Do not invent Target policy or cancel reasons we did not provide.

GOAL
Explain why THIS EMAIL's delivery orders cancel more than they stick, using jig + delivery-order facts only.

FACTS YOU MUST ACCEPT
- City/state/ZIP (last line) are never jigged. Never blame last-line jigging. Never suggest changing city, state, or ZIP.
- Pickup / warm-up orders are ONLY a positive account-warm-up credit. They never explain cancellations. Do not mention mixed fulfillment, pickup vs delivery mix, or cancelled pickups.
- orders[] contains delivery orders only. warmupPickups is a count of pickups — treat it as a good sign, not a cancel pattern.
- We do not have Target's cancel-reason body. Never claim a specific Target reason (fraud, OOS, address, payment) unless the delivery-order facts make that the only consistent pattern. Prefer "likely" + evidence.
- One fat-finger name typo and light street variation are expected and usually fine.
- Aggressive line-1 noise (random letter blocks), odd line-2 unit labels (Room/Door/1K), suffix/direction expansion, Geocodio fail, or master mismatch are higher risk.
- Same card or same email burning across many delivery cancels points to payment/account, not street.

ADDRESS LINES (be specific)
- Line 1 = street (house number + street name + suffix + direction). Culprits: random letter blocks, Ave/Avenue, SE/Southeast, misspell. Causes: street_too_aggressive, street_type_combo.
- Line 2 = unit (Apt/Suite/Room/Door/#/1K). Culprits: Room, Door, 1K, odd labels. Cause: unit_line_unrecognized.
- Last line = City, ST ZIP. Never the culprit. Never tell the user to fix it.
If you blame the address, display and action MUST name the line ("line 1" or "line 2") and the token. Examples: "Line 2 unit (Room) likely AVS" / "Re-jig line 2 to Apt or Suite; leave line 1".
If the issue is name or card, say that — do not say "fix address."

HOW TO REASON (in order)
1. Volume: 1 delivery cancel is weak. Prefer patterns across 2+ delivery cancels or cancel rate >= 40%.
2. Warm-up credit: warmupPickups > 0 is positive. If warmupPickups is 0 and deliveries cancel, you may suggest placing a pickup (cause no_warmup). Never treat pickups as the cancel problem.
3. Jig aggressiveness: which line (1 vs 2), name vs cardholder, Geocodio status.
4. Payment: same card on many delivery cancels; all-cancel vs mixed success on that card.
5. Basket: repeated SKU/qty on cancelled deliveries only.
6. Timing: delivery cancels clustered (site-side) vs spread out (profile/account).

OUTPUT RULES
- display: one line, <= 72 chars, for a table cell. No hedging filler. No "mixed fulfillment".
- causes: 1–3 tags from the allowed list, most likely first.
- action: one concrete next step (re-jig line 1, re-jig line 2, add pickup warm-ups, swap card, verify address, leave alone). If address, name the line.
- If evidence is thin, use cause "insufficient_data" and say so in display.
- severity: low | med | high
- confidence: 0 to 1

Allowed causes: street_too_aggressive, street_type_combo, unit_line_unrecognized, name_too_aggressive, name_card_mismatch, geocodio_fail, master_mismatch, payment_or_card, email_flagged, no_warmup, sku_pattern, timing_cluster, insufficient_data

Return: { "display": "...", "severity": "low|med|high", "causes": ["..."], "confidence": 0.0, "action": "...", "notes": "..." }`;

export interface OrderAnalysisPayload {
  site: OrderRetailer;
  email: string;
  metrics: {
    successful: number;
    cancelled: number;
    stickRate: number | null;
    warmupPickups: number;
    successDollars: number;
    cancelledDollars: number;
  };
  profile: {
    name: string;
    line1: string;
    line2: string;
    lastLine: string;
    nameJig: string;
    addressJig: string;
    geocodio: string;
    masterMatch: boolean | null;
    card: string;
    brand: string;
  };
  orders: Array<{
    id: string;
    status: string;
    fulfillment: string;
    total: number | null;
    items: Array<{ name: string; qty: number }>;
    placedAt: string;
    cancelledAt: string | null;
  }>;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function orderAnalysisKey(site: OrderRetailer, email: string): string {
  return `${site}:${email.trim().toLowerCase()}`;
}

export function isValidAnalysisRecord(record: OrderAnalysisRecord | undefined | null): record is OrderAnalysisRecord {
  const display = record?.result?.display?.trim() ?? "";
  return Boolean(record && display);
}

export function analysisNeedsRun(record: OrderAnalysisRecord | undefined | null, cancelled: number): boolean {
  if (cancelled < 1) return false;
  if (!isValidAnalysisRecord(record)) return true;
  if ((record.promptVersion ?? 0) < ANALYSIS_PROMPT_VERSION) return true;
  return record.cancelledAtCount < cancelled;
}

export function buildOrderAnalysisPayload(
  account: AccountPerformance,
  orders: ParsedOrder[],
): OrderAnalysisPayload {
  const profile = account.profiles[0];
  const card = accountPaymentLines(account);
  const jigLines = accountJigLines(account);
  const lastLine = jigLines.length > 0 ? jigLines[jigLines.length - 1] : "";
  const emailKey = account.email.trim().toLowerCase();
  const deliveryOrders = orders.filter(
    (order) =>
      order.retailer === account.retailer &&
      orderEmailKey(order) === emailKey &&
      !isWarmupOrder(order),
  );
  const successful = deliveryOrders.filter(isSuccessfulOrder).length;
  const cancelled = deliveryOrders.length - successful;
  const successDollars = deliveryOrders
    .filter(isSuccessfulOrder)
    .reduce((sum, order) => sum + (order.total ?? 0), 0);
  const cancelledDollars = deliveryOrders
    .filter((order) => !isSuccessfulOrder(order))
    .reduce((sum, order) => sum + (order.total ?? 0), 0);
  return {
    site: account.retailer,
    email: account.email,
    metrics: {
      successful,
      cancelled,
      stickRate: deliveryOrders.length > 0 ? successful / deliveryOrders.length : null,
      warmupPickups: account.warmup,
      successDollars,
      cancelledDollars,
    },
    profile: {
      name: profile?.billingName || "",
      line1: profile?.line1 || "",
      line2: profile?.line2 || "",
      lastLine,
      nameJig: profile?.nameJigPresetName || "",
      addressJig: profile?.addressJigPresetName || "",
      geocodio: profile?.addressCheckStatus || "",
      masterMatch: profile?.addressMasterMatch ?? null,
      card: card.name,
      brand: card.brand,
    },
    orders: deliveryOrders.map((order) => {
      const cancelledEvent = order.events.find((event) => event.kind === "cancelled");
      return {
        id: order.orderId,
        status: order.status,
        fulfillment: order.fulfillment || (isWarmupOrder(order) ? "pickup" : "delivery"),
        total: order.total ?? null,
        items: (order.items ?? []).map((item) => ({ name: item.name, qty: item.quantity })),
        placedAt: order.placedAt,
        cancelledAt: cancelledEvent?.date || (!isSuccessfulOrder(order) ? order.updatedAt : null),
      };
    }),
  };
}

function parseSeverity(value: unknown): OrderAnalysisSeverity {
  if (value === "low" || value === "med" || value === "high") return value;
  return "med";
}

function parseCauses(value: unknown): OrderAnalysisCause[] {
  const raw = Array.isArray(value) ? value : [];
  const causes = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item): item is OrderAnalysisCause => CAUSE_SET.has(item));
  const unique = [...new Set(causes)].slice(0, 3);
  return unique.length > 0 ? unique : ["insufficient_data"];
}

export function parseOrderAnalysisResult(content: string): OrderAnalysisResult {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const display = String(parsed.display ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISPLAY_MAX);
  if (!display) throw new Error("OpenAI analysis missing display.");
  const action = String(parsed.action ?? "").replace(/\s+/g, " ").trim();
  const notes = String(parsed.notes ?? "").replace(/\s+/g, " ").trim();
  const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.5;
  return {
    display,
    severity: parseSeverity(parsed.severity),
    causes: parseCauses(parsed.causes),
    confidence,
    action: action || "Leave alone until more cancelled orders land.",
    notes: notes || undefined,
  };
}

function hasOpenAiKeyHint(error: unknown): boolean {
  return error instanceof Error && /OPENAI_API_KEY|401|403|api key/i.test(error.message);
}

async function callOpenAiChat(messages: ChatMessage[]): Promise<string> {
  const { getOpenAiSettings } = await import("./browserStorage");
  let apiKey = "";
  try {
    apiKey = (await getOpenAiSettings()).apiKey.trim();
  } catch {
    apiKey = "";
  }

  if (isTauriRuntime()) {
    return invoke<string>("openai_chat_completion", {
      messages,
      model: DEFAULT_MODEL,
      apiKey: apiKey || undefined,
    });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch("/openai/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail || response.statusText}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI returned an empty analysis response.");
  return content;
}

export async function hasOrderAnalysisCredentials(): Promise<boolean> {
  if (isOpenAiMisspellConfigured()) return true;
  try {
    const { getOpenAiSettings } = await import("./browserStorage");
    return Boolean((await getOpenAiSettings()).apiKey.trim());
  } catch {
    return false;
  }
}

export async function analyzeAccountCancellations(
  account: AccountPerformance,
  orders: ParsedOrder[],
): Promise<OrderAnalysisRecord> {
  const payload = buildOrderAnalysisPayload(account, orders);
  const messages: ChatMessage[] = [
    { role: "system", content: ORDER_ANALYSIS_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Analyze this account. Return the JSON object only.\n${JSON.stringify(payload)}`,
    },
  ];
  try {
    const content = await callOpenAiChat(messages);
    const result = parseOrderAnalysisResult(content);
    return {
      site: account.retailer,
      email: account.email.trim().toLowerCase(),
      cancelledAtCount: account.cancelled,
      analyzedAt: new Date().toISOString(),
      promptVersion: ANALYSIS_PROMPT_VERSION,
      result,
    };
  } catch (error) {
    if (hasOpenAiKeyHint(error)) {
      throw new Error("Set an OpenAI API key in Settings to fill Analysis.");
    }
    throw error;
  }
}

export function analysisTooltip(record: OrderAnalysisRecord | undefined): string | undefined {
  if (!isValidAnalysisRecord(record)) return undefined;
  const causes = record.result.causes.join(", ");
  return [record.result.action, causes ? `Causes: ${causes}` : "", record.result.notes]
    .filter(Boolean)
    .join("\n");
}
