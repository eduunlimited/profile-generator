import { normalizeMailboxEmail } from "../imapInbox";
import type { OrderEvent, OrderFulfillment, OrderStatus, ParsedOrder } from "../types";
import {
  canonicalizeOrderId,
  classifyPokemonCenterMessage,
  classifyTargetMessage,
  isTargetPickupConfirmationText,
  orderRecordId,
  type ClassifiedOrderMessage,
} from "./classify";
import { sortOrdersByPlaced } from "./dashboard";
import { detectCarrier, preferTracking } from "./carrier";
import {
  extractOrderItems,
  extractOrderTotal,
  extractOrderShippingAddress,
  extractTargetOrderPayment,
  shipmentHintsFromText,
  mergeOrderAddress,
  mergeOrderItems,
  mergeOrderPayment,
} from "./parse";

const STATUS_RANK: Record<OrderStatus, number> = {
  placed: 1,
  shipped: 2,
  delivered: 3,
  picked_up: 3,
  cancelled: 4,
};

export function eventStatus(kind: ClassifiedOrderMessage["kind"]): OrderStatus {
  if (kind === "cancelled") return "cancelled";
  if (kind === "picked_up") return "picked_up";
  if (kind === "delivered") return "delivered";
  if (kind === "shipped" || kind === "in_transit") return "shipped";
  return "placed";
}

export function strongerStatus(current: OrderStatus, next: OrderStatus): OrderStatus {
  if (
    (current === "picked_up" && next === "delivered") ||
    (current === "delivered" && next === "picked_up")
  ) {
    return "picked_up";
  }
  return STATUS_RANK[next] >= STATUS_RANK[current] ? next : current;
}

function looksLikePickupConfirmation(message: ClassifiedOrderMessage["message"]): boolean {
  return isTargetPickupConfirmationText(
    message.subject ?? "",
    message.snippet ?? "",
    message.body ?? "",
    message.htmlBody ?? "",
  );
}

function eventAliasKeys(event: Pick<OrderEvent, "accountId" | "uid" | "messageId">): string[] {
  const keys: string[] = [];
  if (event.uid) keys.push(`${event.accountId}:uid:${event.uid}`);
  const messageId = event.messageId?.trim().toLowerCase();
  if (messageId) keys.push(`${event.accountId}:id:${messageId}`);
  return keys;
}

function normalizeEventSubject(subject: string): string {
  return subject.trim().toLowerCase().replace(/\s+/g, " ");
}

function fuzzyEventKey(event: OrderEvent): string {
  const bucket = Number.isFinite(event.dateMs) ? Math.round(event.dateMs / 2000) : 0;
  return `${event.accountId}:${event.kind}:${normalizeEventSubject(event.subject)}:${bucket}`;
}

function preferEvent(current: OrderEvent, incoming: OrderEvent): OrderEvent {
  const incomingRank = STATUS_RANK[eventStatus(incoming.kind)];
  const currentRank = STATUS_RANK[eventStatus(current.kind)];
  const kind = incomingRank >= currentRank ? incoming.kind : current.kind;
  const incomingSubject = incoming.subject.trim();
  const currentSubject = current.subject.trim();
  return {
    ...current,
    ...incoming,
    kind,
    uid: incoming.uid || current.uid,
    messageId: incoming.messageId?.trim() || current.messageId,
    subject: incomingSubject.length >= currentSubject.length ? incoming.subject : current.subject,
    date: incoming.dateMs > 0 ? incoming.date : current.date,
    dateMs: incoming.dateMs > 0 ? incoming.dateMs : current.dateMs,
  };
}

function findIndexedEvent(index: Map<string, OrderEvent>, event: OrderEvent): OrderEvent | undefined {
  for (const key of eventAliasKeys(event)) {
    const hit = index.get(key);
    if (hit) return hit;
  }
  const fuzzyHit = index.get(`fuzzy:${fuzzyEventKey(event)}`);
  if (fuzzyHit) return fuzzyHit;
  const bucket = Number.isFinite(event.dateMs) ? Math.round(event.dateMs / 2000) : 0;
  for (const delta of [-1, 1]) {
    const neighbor = index.get(
      `fuzzy:${event.accountId}:${event.kind}:${normalizeEventSubject(event.subject)}:${bucket + delta}`,
    );
    if (neighbor && Math.abs((neighbor.dateMs || 0) - (event.dateMs || 0)) <= 2000) return neighbor;
  }
  return undefined;
}

function indexEvent(index: Map<string, OrderEvent>, event: OrderEvent): void {
  for (const key of eventAliasKeys(event)) index.set(key, event);
  index.set(`fuzzy:${fuzzyEventKey(event)}`, event);
}

function unindexEvent(index: Map<string, OrderEvent>, event: OrderEvent): void {
  for (const key of eventAliasKeys(event)) {
    if (index.get(key) === event) index.delete(key);
  }
  const fuzzy = `fuzzy:${fuzzyEventKey(event)}`;
  if (index.get(fuzzy) === event) index.delete(fuzzy);
}

function dedupeOrderEvents(events: OrderEvent[]): OrderEvent[] {
  const index = new Map<string, OrderEvent>();
  for (const event of events) {
    const previous = findIndexedEvent(index, event);
    if (previous) unindexEvent(index, previous);
    indexEvent(index, previous ? preferEvent(previous, event) : event);
  }
  return [...new Set(index.values())].sort((a, b) => a.dateMs - b.dateMs || a.uid - b.uid);
}

function remapPickupEvents(events: OrderEvent[], fulfillment: OrderFulfillment | undefined): OrderEvent[] {
  if (fulfillment !== "pickup") return events;
  const hasPickupEvent = events.some((event) => event.kind === "picked_up");
  if (hasPickupEvent) return events.filter((event) => event.kind !== "delivered");
  return events.map((event) => (event.kind === "delivered" ? { ...event, kind: "picked_up" as const } : event));
}

export function finalizeParsedOrder(order: ParsedOrder): ParsedOrder {
  const hasPickupEvent = order.events.some((event) => event.kind === "picked_up");
  const fulfillment: OrderFulfillment | undefined =
    order.fulfillment === "pickup" || hasPickupEvent
      ? "pickup"
      : order.fulfillment === "delivery"
        ? "delivery"
        : undefined;
  const events = dedupeOrderEvents(remapPickupEvents(order.events, fulfillment));
  let status: OrderStatus = "placed";
  for (const event of events) status = strongerStatus(status, eventStatus(event.kind));
  return { ...order, fulfillment, events, status };
}

export function classifyStoredMessage(
  accountId: string,
  message: ClassifiedOrderMessage["message"] & { dateMs?: number },
): ClassifiedOrderMessage | null {
  const parts = [message.snippet ?? "", message.body ?? "", message.htmlBody ?? ""];
  const target = classifyTargetMessage(message.subject ?? "", ...parts);
  const pokemon = target ? null : classifyPokemonCenterMessage(message.subject ?? "", ...parts);
  const classified = target
    ? { ...target, retailer: "target" as const }
    : pokemon
      ? { ...pokemon, retailer: "pokemon-center" as const }
      : null;
  if (!classified) return null;
  const parsed = Date.parse(message.date);
  const dateMs =
    Number.isFinite(message.dateMs) && (message.dateMs ?? 0) > 0
      ? message.dateMs!
      : Number.isFinite(parsed)
        ? parsed
        : 0;
  return {
    retailer: classified.retailer,
    kind: classified.kind,
    orderId: canonicalizeOrderId(classified.orderId),
    accountId,
    message,
    dateMs,
  };
}

function toEvent(classified: ClassifiedOrderMessage): OrderEvent {
  return {
    kind: classified.kind,
    accountId: classified.accountId,
    uid: classified.message.uid,
    messageId: classified.message.messageId?.trim() || undefined,
    subject: classified.message.subject.trim(),
    date: classified.message.date,
    dateMs: classified.dateMs,
  };
}

function emailsFromHeader(value: string): string[] {
  return [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) =>
    normalizeMailboxEmail(match[0]),
  );
}

export function orderRecipientEmail(
  message: { recipients?: string[]; to?: string },
  fallback?: string,
): string | undefined {
  const fromRecipients = (message.recipients ?? []).map(normalizeMailboxEmail).find(Boolean);
  if (fromRecipients) return fromRecipients;
  const fromTo = emailsFromHeader(message.to ?? "").find(Boolean);
  if (fromTo) return fromTo;
  const account = fallback ? normalizeMailboxEmail(fallback) : "";
  return account.includes("@") ? account : undefined;
}

function groupFulfillment(group: ClassifiedOrderMessage[]): OrderFulfillment | undefined {
  if (
    group.some((item) => item.kind === "picked_up") ||
    group.some((item) => item.kind === "placed" && looksLikePickupConfirmation(item.message))
  ) {
    return "pickup";
  }
  return undefined;
}

function withCanonicalIds(order: ParsedOrder): ParsedOrder {
  const orderId = canonicalizeOrderId(order.orderId);
  return { ...order, orderId, id: orderRecordId(order.retailer, orderId) };
}

function buildOrder(orderId: string, group: ClassifiedOrderMessage[]): ParsedOrder | null {
  const retailer = group.find((item) => item.kind === "placed")?.retailer ?? group[0]?.retailer;
  if (!retailer) return null;
  orderId = canonicalizeOrderId(orderId);
  const placed = group.filter((item) => item.kind === "placed").sort((a, b) => a.dateMs - b.dateMs);
  if (placed.length === 0) return null;
  const orderedEvents = dedupeOrderEvents(
    [...group]
      .sort((a, b) => a.dateMs - b.dateMs || a.message.uid - b.message.uid)
      .map(toEvent),
  );
  const confirmation = placed[placed.length - 1];
  const shipped = group.filter((item) => item.kind === "shipped").sort((a, b) => b.dateMs - a.dateMs)[0];
  const total = extractOrderTotal(
    confirmation.message.subject,
    confirmation.message.snippet ?? "",
    confirmation.message.body ?? "",
    confirmation.message.htmlBody ?? "",
  );
  const shipmentHints = shipped
    ? shipmentHintsFromText(
        orderId,
        shipped.message.subject,
        shipped.message.snippet ?? "",
        shipped.message.body ?? "",
        shipped.message.htmlBody ?? "",
      )
    : undefined;
  const trackingNumber = shipmentHints?.tracking;
  const items = group.reduce(
    (current, item) =>
      mergeOrderItems(
        current,
        extractOrderItems(item.message.htmlBody ?? "", item.message.body ?? "", item.message.snippet ?? ""),
      ),
    undefined as { name: string; quantity: number }[] | undefined,
  );
  const withEmail = [...placed, ...group]
    .map((item) => orderRecipientEmail(item.message))
    .find(Boolean);
  const confirmationParts = [
    confirmation.message.htmlBody ?? "",
    confirmation.message.body ?? "",
    confirmation.message.snippet ?? "",
  ];
  const shippingAddress = extractOrderShippingAddress(retailer, ...confirmationParts);
  const payment = retailer === "target" ? extractTargetOrderPayment(...confirmationParts) : undefined;
  const placedAt = new Date(placed[0].dateMs || Date.parse(placed[0].message.date) || Date.now()).toISOString();
  const updatedMs = Math.max(...orderedEvents.map((event) => event.dateMs), placed[0].dateMs);
  return finalizeParsedOrder({
    id: orderRecordId(retailer, orderId),
    retailer,
    orderId,
    status: "placed",
    fulfillment: groupFulfillment(group),
    total,
    currency: total != null ? "USD" : undefined,
    trackingNumber,
    carrier: shipmentHints?.carrier ?? detectCarrier(trackingNumber),
    expectedDelivery: shipmentHints?.expectedDelivery,
    expectedDeliverySource: shipmentHints?.expectedDelivery ? "email" : undefined,
    items,
    recipientEmail: withEmail,
    shippingAddress,
    payment,
    events: orderedEvents,
    placedAt,
    updatedAt: new Date(updatedMs || Date.now()).toISOString(),
  });
}

export function mergeClassifiedOrders(classified: ClassifiedOrderMessage[]): ParsedOrder[] {
  const groups = new Map<string, ClassifiedOrderMessage[]>();
  for (const item of classified) {
    const key = orderRecordId(item.retailer, item.orderId);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const orders: ParsedOrder[] = [];
  for (const group of groups.values()) {
    const order = buildOrder(canonicalizeOrderId(group[0].orderId), group);
    if (order) orders.push(order);
  }
  return sortOrdersByPlaced(orders);
}

export function upsertParsedOrders(existing: ParsedOrder[], incoming: ParsedOrder[]): ParsedOrder[] {
  const byId = new Map<string, ParsedOrder>();
  const fold = (raw: ParsedOrder) => {
    const next = withCanonicalIds(raw);
    const previous = byId.get(next.id);
    if (!previous) {
      byId.set(next.id, finalizeParsedOrder(next));
      return;
    }
    const mergedEvents = dedupeOrderEvents([...previous.events, ...next.events]);
    const updatedMs = Math.max(
      Date.parse(previous.updatedAt) || 0,
      Date.parse(next.updatedAt) || 0,
      ...mergedEvents.map((event) => event.dateMs),
    );
    byId.set(
      next.id,
      finalizeParsedOrder({
        ...previous,
        ...next,
        id: next.id,
        orderId: next.orderId,
        fulfillment: next.fulfillment ?? previous.fulfillment,
        total: next.total ?? previous.total,
        currency: next.total != null ? (next.currency ?? "USD") : previous.currency,
        trackingNumber: preferTracking(next.trackingNumber, previous.trackingNumber),
        carrier: next.carrier ?? (next.trackingNumber && previous.trackingNumber && next.trackingNumber !== previous.trackingNumber
          ? detectCarrier(next.trackingNumber)
          : previous.carrier),
        expectedDelivery:
          next.expectedDelivery ??
          (next.trackingNumber && previous.trackingNumber && next.trackingNumber !== previous.trackingNumber
            ? undefined
            : previous.expectedDelivery),
        expectedDeliveryAt: next.expectedDeliveryAt ?? previous.expectedDeliveryAt,
        expectedDeliverySource: next.expectedDeliverySource ?? previous.expectedDeliverySource,
        items: mergeOrderItems(previous.items, next.items ?? []) ?? next.items ?? previous.items,
        recipientEmail: next.recipientEmail ?? previous.recipientEmail,
        shippingAddress: mergeOrderAddress(next.shippingAddress, previous.shippingAddress),
        payment: mergeOrderPayment(next.payment, previous.payment),
        cancelReason: next.cancelReason ?? previous.cancelReason,
        events: mergedEvents,
        placedAt: previous.placedAt || next.placedAt,
        updatedAt: new Date(updatedMs || Date.now()).toISOString(),
      }),
    );
  };
  for (const order of existing) fold(order);
  for (const order of incoming) fold(order);
  return sortOrdersByPlaced([...byId.values()].map(finalizeParsedOrder));
}

export function attachClassifiedEvents(
  orders: ParsedOrder[],
  classified: ClassifiedOrderMessage[],
): ParsedOrder[] {
  if (classified.length === 0) return orders.map(finalizeParsedOrder);
  const byOrderId = new Map(orders.map((order) => [order.id, order]));
  for (const item of classified) {
    const previous = byOrderId.get(orderRecordId(item.retailer, item.orderId));
    if (!previous) continue;
    const events = dedupeOrderEvents([...previous.events, toEvent(item)]);
    const updatedMs = Math.max(Date.parse(previous.updatedAt) || 0, item.dateMs);
    const hints =
      item.kind === "shipped" || item.kind === "delivered"
        ? shipmentHintsFromText(
            item.orderId,
            item.message.subject,
            item.message.snippet ?? "",
            item.message.body ?? "",
            item.message.htmlBody ?? "",
          )
        : undefined;
    const trackingNumber = preferTracking(hints?.tracking, previous.trackingNumber);
    byOrderId.set(
      previous.id,
      finalizeParsedOrder({
        ...previous,
        fulfillment: item.kind === "picked_up" ? "pickup" : previous.fulfillment ?? "delivery",
        trackingNumber,
        carrier: hints?.carrier ?? detectCarrier(trackingNumber) ?? previous.carrier,
        expectedDelivery: hints?.expectedDelivery ?? previous.expectedDelivery,
        expectedDeliverySource: hints?.expectedDelivery
          ? "email"
          : previous.expectedDeliverySource,
        events,
        updatedAt: new Date(updatedMs || Date.now()).toISOString(),
      }),
    );
  }
  return sortOrdersByPlaced([...byOrderId.values()].map(finalizeParsedOrder));
}
