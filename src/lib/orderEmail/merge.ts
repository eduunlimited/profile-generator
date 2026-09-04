import { normalizeMailboxEmail } from "../imapInbox";
import type { OrderEvent, OrderFulfillment, OrderStatus, ParsedOrder } from "../types";
import {
  classifyTargetMessage,
  isTargetPickupConfirmationText,
  orderRecordId,
  type ClassifiedOrderMessage,
} from "./classify";
import { sortOrdersByPlaced } from "./dashboard";
import { extractOrderTotal, extractTrackingNumber } from "./parse";

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

export function finalizeParsedOrder(order: ParsedOrder): ParsedOrder {
  const hasPickupEvent = order.events.some((event) => event.kind === "picked_up");
  const fulfillment: OrderFulfillment | undefined =
    order.fulfillment === "pickup" || hasPickupEvent
      ? "pickup"
      : order.fulfillment === "delivery"
        ? "delivery"
        : undefined;
  const events =
    fulfillment === "pickup"
      ? order.events.map((event) => (event.kind === "delivered" ? { ...event, kind: "picked_up" as const } : event))
      : order.events;
  let status: OrderStatus = "placed";
  for (const event of events) status = strongerStatus(status, eventStatus(event.kind));
  return { ...order, fulfillment, events, status };
}

export function classifyStoredMessage(
  accountId: string,
  message: ClassifiedOrderMessage["message"] & { dateMs?: number },
): ClassifiedOrderMessage | null {
  const classified = classifyTargetMessage(
    message.subject ?? "",
    message.snippet ?? "",
    message.body ?? "",
    message.htmlBody ?? "",
  );
  if (!classified) return null;
  const parsed = Date.parse(message.date);
  const dateMs =
    Number.isFinite(message.dateMs) && (message.dateMs ?? 0) > 0
      ? message.dateMs!
      : Number.isFinite(parsed)
        ? parsed
        : 0;
  return {
    retailer: "target",
    kind: classified.kind,
    orderId: classified.orderId,
    accountId,
    message,
    dateMs,
  };
}

function eventKey(event: Pick<OrderEvent, "accountId" | "uid" | "messageId">): string {
  const messageId = event.messageId?.trim().toLowerCase();
  return messageId ? `${event.accountId}:id:${messageId}` : `${event.accountId}:uid:${event.uid}`;
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

function buildOrder(orderId: string, group: ClassifiedOrderMessage[]): ParsedOrder | null {
  const placed = group.filter((item) => item.kind === "placed").sort((a, b) => a.dateMs - b.dateMs);
  if (placed.length === 0) return null;
  const events = [...group]
    .sort((a, b) => a.dateMs - b.dateMs || a.message.uid - b.message.uid)
    .map(toEvent);
  const uniqueEvents = new Map<string, OrderEvent>();
  for (const event of events) uniqueEvents.set(eventKey(event), event);
  const orderedEvents = [...uniqueEvents.values()].sort((a, b) => a.dateMs - b.dateMs || a.uid - b.uid);
  const confirmation = placed[placed.length - 1];
  const shipped = group.filter((item) => item.kind === "shipped").sort((a, b) => b.dateMs - a.dateMs)[0];
  const total = extractOrderTotal(
    confirmation.message.subject,
    confirmation.message.snippet ?? "",
    confirmation.message.body ?? "",
    confirmation.message.htmlBody ?? "",
  );
  const trackingNumber = shipped
    ? extractTrackingNumber(
        orderId,
        shipped.message.subject,
        shipped.message.snippet ?? "",
        shipped.message.body ?? "",
        shipped.message.htmlBody ?? "",
      )
    : undefined;
  const withEmail = [...placed, ...group]
    .map((item) => orderRecipientEmail(item.message))
    .find(Boolean);
  const placedAt = new Date(placed[0].dateMs || Date.parse(placed[0].message.date) || Date.now()).toISOString();
  const updatedMs = Math.max(...orderedEvents.map((event) => event.dateMs), placed[0].dateMs);
  return finalizeParsedOrder({
    id: orderRecordId("target", orderId),
    retailer: "target",
    orderId,
    status: "placed",
    fulfillment: groupFulfillment(group),
    total,
    currency: total != null ? "USD" : undefined,
    trackingNumber,
    recipientEmail: withEmail,
    events: orderedEvents,
    placedAt,
    updatedAt: new Date(updatedMs || Date.now()).toISOString(),
  });
}

export function mergeClassifiedOrders(classified: ClassifiedOrderMessage[]): ParsedOrder[] {
  const groups = new Map<string, ClassifiedOrderMessage[]>();
  for (const item of classified) {
    const list = groups.get(item.orderId) ?? [];
    list.push(item);
    groups.set(item.orderId, list);
  }
  const orders: ParsedOrder[] = [];
  for (const [orderId, group] of groups) {
    const order = buildOrder(orderId, group);
    if (order) orders.push(order);
  }
  return sortOrdersByPlaced(orders);
}

export function upsertParsedOrders(existing: ParsedOrder[], incoming: ParsedOrder[]): ParsedOrder[] {
  const byId = new Map(existing.map((order) => [order.id, order]));
  for (const next of incoming) {
    const previous = byId.get(next.id);
    if (!previous) {
      byId.set(next.id, finalizeParsedOrder(next));
      continue;
    }
    const events = new Map<string, OrderEvent>();
    for (const event of previous.events) events.set(eventKey(event), event);
    for (const event of next.events) events.set(eventKey(event), event);
    const mergedEvents = [...events.values()].sort((a, b) => a.dateMs - b.dateMs || a.uid - b.uid);
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
        fulfillment: next.fulfillment ?? previous.fulfillment,
        total: next.total ?? previous.total,
        currency: next.total != null ? (next.currency ?? "USD") : previous.currency,
        trackingNumber: next.trackingNumber ?? previous.trackingNumber,
        items: next.items && next.items.length > 0 ? next.items : previous.items,
        recipientEmail: next.recipientEmail ?? previous.recipientEmail,
        events: mergedEvents,
        placedAt: previous.placedAt || next.placedAt,
        updatedAt: new Date(updatedMs || Date.now()).toISOString(),
      }),
    );
  }
  return sortOrdersByPlaced([...byId.values()].map(finalizeParsedOrder));
}

export function attachClassifiedEvents(
  orders: ParsedOrder[],
  classified: ClassifiedOrderMessage[],
): ParsedOrder[] {
  if (classified.length === 0) return orders.map(finalizeParsedOrder);
  const byOrderId = new Map(orders.map((order) => [order.orderId, order]));
  for (const item of classified) {
    const previous = byOrderId.get(item.orderId);
    if (!previous) continue;
    const event = toEvent(item);
    if (previous.events.some((existing) => eventKey(existing) === eventKey(event))) continue;
    const events = [...previous.events, event].sort((a, b) => a.dateMs - b.dateMs || a.uid - b.uid);
    const updatedMs = Math.max(Date.parse(previous.updatedAt) || 0, item.dateMs);
    byOrderId.set(
      item.orderId,
      finalizeParsedOrder({
        ...previous,
        fulfillment: item.kind === "picked_up" ? "pickup" : previous.fulfillment,
        events,
        updatedAt: new Date(updatedMs || Date.now()).toISOString(),
      }),
    );
  }
  return sortOrdersByPlaced([...byOrderId.values()].map(finalizeParsedOrder));
}
