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

export const POKEMON_CENTER_SEARCH_SUBJECTS = [
  "Thank you for shopping at PokemonCenter.com",
  "Your order has been canceled",
  "Your order has been cancelled",
  "Your Pokémon Center order is on its way",
  "Your Pokemon Center order is on its way",
  "order is on its way",
  "Your package has been delivered",
] as const;

export const ORDER_SEARCH_SUBJECTS = [...TARGET_SEARCH_SUBJECTS, ...POKEMON_CENTER_SEARCH_SUBJECTS];

const ORDER_ID = String.raw`(\d{10,20})`;
const TARGET_SHAPED_ID = /\b((?:10|90|91)\d{13})\b/g;

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

export function isTargetPickupSubject(subject: string): boolean {
  return Boolean(extractTargetPickupLastFour(subject));
}

export function extractTargetPickupLastFour(subject: string): string | undefined {
  const trimmed = subject.trim();
  const match =
    trimmed.match(/your order ending in\s*(\d{4})\s*was picked up/i) ??
    trimmed.match(/hooray!\s*your order ending in\s*(\d{4})/i) ??
    trimmed.match(/order ending in\s*(\d{4}).*picked up/i);
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
  for (const match of text.matchAll(new RegExp(String.raw`order\s*(?:number|no\.?|id)\s*:?\s*${ORDER_ID}`, "gi"))) {
    add(match[1]);
  }
  for (const match of text.matchAll(new RegExp(String.raw`/orders?/${ORDER_ID}`, "gi"))) {
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

export function isPokemonCenterConfirmationSubject(subject: string): boolean {
  return /thank you for shopping at pokemoncenter\.com/i.test(subject.trim());
}

export function isPokemonCenterCancelledSubject(subject: string): boolean {
  return /your order has been cancel+ed/i.test(subject.trim());
}

export function isPokemonCenterShippedSubject(subject: string): boolean {
  return /(?:pok[eé]mon center )?order is on its way/i.test(subject.trim());
}

export function isPokemonCenterDeliveredSubject(subject: string): boolean {
  return /your package has been delivered/i.test(subject.trim());
}

export function isPokemonCenterOrderSubject(subject: string): boolean {
  return (
    isPokemonCenterConfirmationSubject(subject) ||
    isPokemonCenterCancelledSubject(subject) ||
    isPokemonCenterShippedSubject(subject) ||
    isPokemonCenterDeliveredSubject(subject)
  );
}

export function extractPokemonCenterOrderId(...parts: string[]): string | undefined {
  const text = emailPlainText(parts.filter(Boolean).join("\n")).replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  const labeled = text.match(/order\s*(?:number|no\.?|id|#)[\s\S]{0,240}?(P\s*\d{8,14})/i);
  const bare = text.match(/\b(P\s*\d{8,14})\b/i);
  const raw = labeled?.[1] ?? bare?.[1];
  return raw ? raw.replace(/\s+/g, "").toUpperCase() : undefined;
}

export function classifyPokemonCenterMessage(
  subject: string,
  ...parts: string[]
): { kind: OrderEventKind; orderId: string } | null {
  const orderId = extractPokemonCenterOrderId(subject, ...parts);
  if (!orderId) return null;
  if (isPokemonCenterCancelledSubject(subject)) return { kind: "cancelled", orderId };
  if (isPokemonCenterDeliveredSubject(subject)) return { kind: "delivered", orderId };
  if (isPokemonCenterShippedSubject(subject)) return { kind: "shipped", orderId };
  if (isPokemonCenterConfirmationSubject(subject)) return { kind: "placed", orderId };
  return null;
}

const ORDER_ID_PREFIX = /^(target|walmart|pokemon-center):/i;

export function canonicalizeOrderId(orderId: string): string {
  let value = orderId.trim();
  while (ORDER_ID_PREFIX.test(value)) {
    value = value.replace(ORDER_ID_PREFIX, "");
  }
  return value;
}

export function orderRecordId(retailer: OrderRetailer, orderId: string): string {
  return `${retailer}:${canonicalizeOrderId(orderId)}`;
}
