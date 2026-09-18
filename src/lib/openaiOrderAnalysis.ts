import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./env";
import { isSuccessfulOrder, orderEmailKey } from "./orderEmail/dashboard";
import { isManualCancelReason } from "./orderEmail/targetCancelReasons";
import { formatOrderAddress } from "./orderEmail/parse";
import { formatOrderCardDisplay } from "./orderEmail/payment";
import { accountJigLines, accountPaymentLabel, accountPaymentLines, isWarmupOrder } from "./orderEmail/performance";
import type { AccountPerformance } from "./orderEmail/performance";
import { isOpenAiMisspellConfigured } from "./openaiMisspell";
import type {
  CreditCard,
  OrderAnalysisCause,
  OrderAnalysisRecord,
  OrderAnalysisResult,
  OrderAnalysisSeverity,
  OrderRetailer,
  ParsedOrder,
  ProfileSummary,
} from "./types";

const DEFAULT_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini";
const DISPLAY_MAX = 72;
export const ANALYSIS_PROMPT_VERSION = 4;

export const ORDER_ANALYSIS_CAUSES: readonly OrderAnalysisCause[] = [
  "street_too_aggressive",
  "street_type_combo",
  "unit_line_unrecognized",
  "name_too_aggressive",
  "name_card_mismatch",
  "geocodio_fail",
  "master_mismatch",
  "payment_or_card",
  "virtual_card",
  "high_aov_cancel",
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
Explain why THIS EMAIL's delivery orders cancel more than they stick. Walk orders[] history FIRST (value, cardKind, ship-to), then jig profile.

FACTS YOU MUST ACCEPT
- City/state/ZIP (last line) are never jigged. Never blame last-line jigging. Never suggest changing city, state, or ZIP.
- Pickup / warm-up orders are ONLY a positive account-warm-up credit. They never explain cancellations. Do not mention mixed fulfillment or cancelled pickups.
- orders[] is the full succeeded+cancelled history for this email. Rows with fulfillment "pickup" or address "pickup" are warm-ups. warmupPickups is the pickup count — a good sign, not a cancel pattern.
- When an order includes cancelReason, that is Target's own cancel_reason_text. Treat it as ground truth. Cite it. Do not invent a different Target policy.
- If cancelReason is missing, do not claim a specific Target reason (fraud, OOS, address, payment). Prefer "likely" + evidence.
- One fat-finger name typo and light street variation are expected and usually fine.
- Aggressive line-1 noise (random letter blocks), odd line-2 unit labels (Room/Door/1K), suffix/direction expansion, Geocodio fail, or master mismatch are higher risk.
- Card/value history beats jig blame. Same ship-to on a success and a cancel → do not blame street and do not pick a re-jig address action.
- Same card last-4 or same email burning across many delivery cancels points to payment/account, not street.

HISTORY (must check before jig)
1. Value: cheap successes + expensive delivery cancels (see avgSuccessDollars vs avgCancelledDollars) is high_aov_cancel, not automatically street. Cite amounts.
2. Card: cardKind is virtual | physical | unknown. Virtual-only cancels with physical successes → virtual_card. Same last-4 on most delivery cancels → payment_or_card. Do not invent issuer policy.
3. Address: compare confirmation ship-tos to each other and to profile line 1/2. Pickup addresses never explain cancels.

ADDRESS LINES (be specific)
- Line 1 = street (house number + street name + suffix + direction). Culprits: random letter blocks, Ave/Avenue, SE/Southeast, misspell. Causes: street_too_aggressive, street_type_combo.
- Line 2 = unit (Apt/Suite/Room/Door/#/1K). Culprits: Room, Door, 1K, odd labels. Cause: unit_line_unrecognized.
- Last line = City, ST ZIP. Never the culprit. Never tell the user to fix it.
If you blame the address, display and action MUST name the line ("line 1" or "line 2") and the token.
If the issue is name, card, or value, say that — do not say "fix address."

HOW TO REASON (in order)
1. Volume: 1 delivery cancel is weak. Prefer patterns across 2+ delivery cancels or cancel rate >= 40%.
2. Warm-up credit: warmupPickups > 0 is positive. If warmupPickups is 0 and deliveries cancel, you may suggest a pickup (cause no_warmup).
3. History: value spike, virtual vs physical, same last-4, same ship-to on success vs cancel.
4. Jig: which line (1 vs 2), name vs cardholder, Geocodio, master match — only if history does not already explain cancels.
5. Basket: repeated SKU/qty on cancelled deliveries only.
6. Timing: delivery cancels clustered (site-side) vs spread out (profile/account).

VERDICT (display): one line, <= 72 chars. Winning factor only. No hedging filler. No "mixed fulfillment". No invented Target reason. Use "likely" for a pattern. Optional second clause only if it still fits ("; name misspell also noted"). Do not lead with address if card or value explains the cancels.
Use one of these templates (fill token / $ / last-4):
- "1 cancel only; need another delivery" (insufficient_data, low)
- "Same address stuck on other orders; not street" (low)
- "No pickup warm-up; deliveries cancelling" (no_warmup, med)
- "Cheap orders stick; high-AOV deliveries cancel" (high_aov_cancel, med)
- "Virtual/VCC cancels; physical card has successes" (virtual_card, high)
- "Same card last-4 on most delivery cancels" (payment_or_card, high)
- "Email burning across cards/addresses" (email_flagged, high)
- "Line 1 street (Ave) likely AVS" / "Line 1 letter-block likely too aggressive" (street_type_combo / street_too_aggressive, med)
- "Line 2 unit (Room) likely AVS" (unit_line_unrecognized, med)
- "Name jig too aggressive" / "Name vs cardholder mismatch" (name_too_aggressive / name_card_mismatch, med)
- "Geocodio fail on line 1" / "Ship-to does not match master" (geocodio_fail / master_mismatch, med)
- "Same SKU cancelling; other items stick" (sku_pattern, med)
- "Cancels clustered; likely site-side" (timing_cluster, low)

ACTION: exactly one next step, with a short token if needed. Allowed:
- Leave alone — 1 cancel, mixed success on same ship-to+card, timing cluster, or thin evidence.
- Add pickup warm-up — deliveries cancel and warmupPickups is 0.
- Retry lower value first — cheap successes/pickups stick, expensive deliveries cancel. Do not re-jig street for this alone.
- Swap off virtual card — cancels on VCC/virtual; physical or other last-4 has successes.
- Swap card — same last-4 burns across delivery cancels, not only virtual.
- Re-jig line 1 — name the token (letter block / Ave / SE).
- Re-jig line 2 — say Apt or Suite; leave line 1.
- Re-jig name — name too aggressive or vs cardholder. Do not say fix address.
- Verify address — Geocodio fail or master mismatch, and history does not already prove the ship-to sticks.
- Rotate email — email burning across cards/addresses.
- Skip this SKU on this email — cancelled deliveries share a SKU successes do not.

NOTES: required evidence. Cite order #s, $ amounts, cardKind, and address line that support display+action.

OUTPUT RULES
- causes: 1–3 tags from the allowed list, most likely first.
- If evidence is thin, cause "insufficient_data" and say so in display.
- severity: low | med | high
- confidence: 0 to 1

Allowed causes: street_too_aggressive, street_type_combo, unit_line_unrecognized, name_too_aggressive, name_card_mismatch, geocodio_fail, master_mismatch, payment_or_card, virtual_card, high_aov_cancel, email_flagged, no_warmup, sku_pattern, timing_cluster, insufficient_data

Return: { "display": "...", "severity": "low|med|high", "causes": ["..."], "confidence": 0.0, "action": "...", "notes": "..." }`;

export type OrderAnalysisCardKind = "virtual" | "physical" | "unknown";

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
    avgSuccessDollars: number | null;
    avgCancelledDollars: number | null;
    virtualCancelRate: number | null;
    physicalCancelRate: number | null;
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
    card: string;
    cardKind: OrderAnalysisCardKind;
    address: string;
    items: Array<{ name: string; qty: number }>;
    placedAt: string;
    cancelledAt: string | null;
    cancelReason: string | null;
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

const VIRTUAL_CARD = /virtual|\bvcc\b/i;
const BRAND_LAST4_ONLY = /^(visa|mastercard|amex|american express|discover)\s*\*\d{4}$/i;

function inferCardKind(...labels: Array<string | undefined>): OrderAnalysisCardKind {
  const hay = labels.filter((label) => label?.trim()).join(" ");
  if (VIRTUAL_CARD.test(hay)) return "virtual";
  const named = labels.find((label) => label?.trim() && !BRAND_LAST4_ONLY.test(label.trim()));
  if (named) return "physical";
  return "unknown";
}

function ratio(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return part / whole;
}

function average(total: number, count: number): number | null {
  if (count <= 0) return null;
  return total / count;
}

export function buildOrderAnalysisPayload(
  account: AccountPerformance,
  orders: ParsedOrder[],
  cards: CreditCard[] = [],
  profiles: ProfileSummary[] = [],
): OrderAnalysisPayload {
  const profile = account.profiles[0];
  const card = accountPaymentLines(account);
  const jigLines = accountJigLines(account);
  const lastLine = jigLines.length > 0 ? jigLines[jigLines.length - 1] : "";
  const emailKey = account.email.trim().toLowerCase();
  const fallbackCard = accountPaymentLabel(account) || card.name;
  const kindHay = [card.name, card.brand, fallbackCard, profile?.profileName, profile?.paymentLabel];
  const history = orders.filter(
    (order) => order.retailer === account.retailer && orderEmailKey(order) === emailKey,
  );
  const rows = history.map((order) => {
    const pickup = isWarmupOrder(order) || order.fulfillment === "pickup" || order.shippingAddress?.source === "pickup";
    const display = formatOrderCardDisplay(order, cards, profiles, fallbackCard);
    const cardLabel = [display.primary, display.secondary].filter(Boolean).join(" · ");
    const cancelledEvent = order.events.find((event) => event.kind === "cancelled");
    const address = pickup
      ? "pickup"
      : formatOrderAddress(order.shippingAddress).replace(/\n+/g, ", ").trim();
    return {
      id: order.orderId,
      status: order.status,
      fulfillment: pickup ? "pickup" : order.fulfillment || "delivery",
      total: order.total ?? null,
      card: cardLabel,
      cardKind: inferCardKind(cardLabel, ...kindHay),
      address,
      items: (order.items ?? []).map((item) => ({ name: item.name, qty: item.quantity })),
      placedAt: order.placedAt,
      cancelledAt: cancelledEvent?.date || (!isSuccessfulOrder(order) ? order.updatedAt : null),
      cancelReason: isManualCancelReason(order.cancelReason) ? null : order.cancelReason?.trim() || null,
      pickup,
      succeeded: isSuccessfulOrder(order),
    };
  });
  const delivery = rows.filter((row) => !row.pickup);
  const successful = delivery.filter((row) => row.succeeded).length;
  const cancelled = delivery.length - successful;
  const successDollars = delivery
    .filter((row) => row.succeeded)
    .reduce((sum, row) => sum + (row.total ?? 0), 0);
  const cancelledDollars = delivery
    .filter((row) => !row.succeeded)
    .reduce((sum, row) => sum + (row.total ?? 0), 0);
  const virtualDelivery = delivery.filter((row) => row.cardKind === "virtual");
  const physicalDelivery = delivery.filter((row) => row.cardKind === "physical");
  return {
    site: account.retailer,
    email: account.email,
    metrics: {
      successful,
      cancelled,
      stickRate: ratio(successful, delivery.length),
      warmupPickups: account.warmup,
      successDollars,
      cancelledDollars,
      avgSuccessDollars: average(successDollars, successful),
      avgCancelledDollars: average(cancelledDollars, cancelled),
      virtualCancelRate: ratio(virtualDelivery.filter((row) => !row.succeeded).length, virtualDelivery.length),
      physicalCancelRate: ratio(physicalDelivery.filter((row) => !row.succeeded).length, physicalDelivery.length),
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
    orders: rows.map(({ pickup: _pickup, succeeded: _succeeded, ...row }) => row),
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
  cards: CreditCard[] = [],
  profiles: ProfileSummary[] = [],
): Promise<OrderAnalysisRecord> {
  const payload = buildOrderAnalysisPayload(account, orders, cards, profiles);
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
