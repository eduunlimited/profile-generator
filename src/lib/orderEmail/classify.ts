import type { ImapMessage, OrderEventKind, OrderRetailer } from "../types";
import { emailPlainText } from "./parse";

export const TARGET_SEARCH_SUBJECTS = [
  "Here's your order #",
  "Here\u2019s your order #",
  "are about to ship",
  "have arrived from order",
  "had to cancel order",
  "Your order arrives",
  "was picked up",
  "order ending in",
  "Hooray! Your order",
] as const;

const ORDER_ID = String.raw`(\d{10,20})`;
const TARGET_SHAPED_ID = /\b((?:10|91)\d{13})\b/g;

const TARGET_SUBJECT_RULES: { kind: OrderEventKind; pattern: RegExp }[] = [
  {
    kind: "placed",
    pattern: new RegExp(
      String.raw`thanks for shopping with us!\s*here['\u2019]s your order\s*#:?\s*${ORDER_ID}`,
      "i",
    ),
  },
  {
    kind: "shipped",
    pattern: new RegExp(String.raw`items from order\s*#:?\s*${ORDER_ID}\s*are about to ship`, "i"),
  },
  {
    kind: "delivered",
    pattern: new RegExp(String.raw`items have arrived from order\s*#:?\s*${ORDER_ID}`, "i"),
  },
  {
    kind: "cancelled",
    pattern: new RegExp(String.raw`sorry,\s*we had to cancel order\s*#:?\s*${ORDER_ID}`, "i"),
  },
  {
    kind: "in_transit",
    pattern: new RegExp(String.raw`your order arrives (?:tomorrow|today)!\s*order\s*#:?\s*${ORDER_ID}`, "i"),
  },
];

export interface ClassifiedOrderMessage {
  retailer: OrderRetailer;
  kind: OrderEventKind;
  orderId: string;
  accountId: string;
  message: Pick<
    ImapMessage,
    "uid" | "messageId" | "date" | "subject" | "recipients" | "body" | "htmlBody" | "snippet"
  >;
  dateMs: number;
}

export function extractTargetOrderId(subject: string): string | undefined {
  const match = subject.match(new RegExp(String.raw`order\s*#:?\s*${ORDER_ID}`, "i"));
  return match?.[1];
}

export function classifyTargetSubject(subject: string): { kind: OrderEventKind; orderId: string } | null {
  const trimmed = subject.trim();
  if (!trimmed) return null;
  for (const rule of TARGET_SUBJECT_RULES) {
    const match = trimmed.match(rule.pattern);
    if (match?.[1]) return { kind: rule.kind, orderId: match[1] };
  }
  return null;
}

export function extractTargetPickupLastFour(subject: string): string | undefined {
  const trimmed = subject.trim();
  const match =
    trimmed.match(/your order ending in\s*(\d{4})\s*was picked up/i) ??
    trimmed.match(/hooray!\s*your order ending in\s*(\d{4})/i);
  return match?.[1];
}

export function isTargetPickupConfirmationText(...parts: string[]): boolean {
  return /thanks for your pickup order/i.test(emailPlainText(parts.filter(Boolean).join("\n")));
}

export function extractTargetOrderIdsFromText(...parts: string[]): string[] {
  const text = emailPlainText(parts.filter(Boolean).join("\n"));
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };
  for (const match of text.matchAll(new RegExp(String.raw`order\s*#:?\s*${ORDER_ID}`, "gi"))) {
    add(match[1]);
  }
  for (const match of text.matchAll(new RegExp(String.raw`order\s*(?:number|no\.?)\s*:?\s*${ORDER_ID}`, "gi"))) {
    add(match[1]);
  }
  TARGET_SHAPED_ID.lastIndex = 0;
  for (const match of text.matchAll(TARGET_SHAPED_ID)) add(match[1]);
  return ids;
}

export function extractTargetOrderIdMatchingLastFour(lastFour: string, ...parts: string[]): string | undefined {
  return extractTargetOrderIdsFromText(...parts).find((id) => id.endsWith(lastFour));
}

export function resolveTargetOrderIdForLastFour(
  lastFour: string,
  knownOrderIds: Iterable<string>,
  ...parts: string[]
): string | undefined {
  const fromBody = extractTargetOrderIdMatchingLastFour(lastFour, ...parts);
  if (fromBody) return fromBody;
  const matches = [...new Set([...knownOrderIds].filter((id) => id.endsWith(lastFour)))];
  return matches.length === 1 ? matches[0] : undefined;
}

export function classifyTargetMessage(
  subject: string,
  ...parts: string[]
): { kind: OrderEventKind; orderId: string } | null {
  const fromSubject = classifyTargetSubject(subject);
  if (fromSubject) return fromSubject;
  const lastFour = extractTargetPickupLastFour(subject);
  if (!lastFour) return null;
  const orderId = extractTargetOrderIdMatchingLastFour(lastFour, subject, ...parts);
  if (!orderId) return null;
  return { kind: "picked_up", orderId };
}

export function orderRecordId(retailer: OrderRetailer, orderId: string): string {
  return `${retailer}:${orderId}`;
}
