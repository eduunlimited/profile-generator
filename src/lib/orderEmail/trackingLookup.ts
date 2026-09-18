import { invoke } from "@tauri-apps/api/core";
import { saveOrders } from "../api";
import { isTauriRuntime } from "../env";
import type { ParsedOrder, ShipmentCarrier } from "../types";
import { allowedTrackingHost, detectCarrier, normalizeTracking } from "./carrier";
import { isCancelledOrder, isInTransitOrder } from "./dashboard";
import { finalizeParsedOrder } from "./merge";
import {
  mergeSeventeenTrack,
  parseSeventeenTrack,
  parseSeventeenTrackBatch,
  seventeenTrackCarrierFcs,
  seventeenTrackNumbers,
  seventeenTrackUrl,
  type SeventeenTrackParsed,
} from "./seventeenTrack";

const MAX_BODY = 250_000;
const BATCH_SIZE = 40;

export interface TrackingFetchResult {
  status: number;
  text: string;
}

function isUsableId(id: string): boolean {
  return id.length >= 8 && id !== "—";
}

function hasSeventeenTrackDelivered(order: ParsedOrder): boolean {
  return order.events.some((event) => event.messageId?.startsWith("17track:delivered:"));
}

function incomingTrackOrders(orders: ParsedOrder[]): ParsedOrder[] {
  return orders.filter((order) => {
    if (isCancelledOrder(order) || order.fulfillment === "pickup" || order.status === "picked_up") return false;
    if (!isUsableId(normalizeTracking(order.trackingNumber ?? ""))) return false;
    return isInTransitOrder(order) || hasSeventeenTrackDelivered(order);
  });
}

function syntheticUid(tracking: string): number {
  let hash = 0;
  for (const char of tracking) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 1_700_000_000 + (hash % 99_000_000);
}

function applyShipmentFields(
  order: ParsedOrder,
  patch: {
    tracking?: string;
    carrier?: ShipmentCarrier;
    expectedDelivery?: string;
    source?: "carrier" | "email" | "17track";
    stamp?: boolean;
    delivered?: boolean;
    deliveredAt?: string;
    clearSeventeenTrackDelivered?: boolean;
  },
): ParsedOrder {
  const tracking = patch.tracking ?? order.trackingNumber;
  const carrier = patch.carrier ?? detectCarrier(tracking) ?? order.carrier;
  const expectedDelivery = patch.expectedDelivery ?? order.expectedDelivery;
  let events = [...order.events];
  if (patch.clearSeventeenTrackDelivered) {
    events = events.filter((event) => !event.messageId?.startsWith("17track:delivered:"));
  }
  if (patch.delivered && !events.some((event) => event.kind === "delivered")) {
    const base = events.find((event) => event.accountId) ?? events[0];
    const when = patch.deliveredAt ? new Date(`${patch.deliveredAt}T12:00:00`) : new Date();
    events.push({
      kind: "delivered",
      accountId: base?.accountId || "17track",
      uid: syntheticUid(normalizeTracking(tracking ?? "")),
      messageId: `17track:delivered:${normalizeTracking(tracking ?? "")}`,
      subject: `Delivered · ${normalizeTracking(tracking ?? "")}`,
      date: Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString(),
      dateMs: Number.isNaN(when.getTime()) ? Date.now() : when.getTime(),
    });
  }
  return finalizeParsedOrder({
    ...order,
    trackingNumber: tracking,
    carrier,
    expectedDelivery,
    expectedDeliverySource: patch.expectedDelivery ? patch.source : order.expectedDeliverySource,
    expectedDeliveryAt: patch.stamp ? new Date().toISOString() : order.expectedDeliveryAt,
    updatedAt: patch.delivered || patch.clearSeventeenTrackDelivered ? new Date().toISOString() : order.updatedAt,
    events,
  });
}

async function fetchTrackingPage(url: string): Promise<TrackingFetchResult> {
  const parsed = new URL(url);
  if (!allowedTrackingHost(parsed.host)) {
    return { status: 0, text: "" };
  }
  if (isTauriRuntime()) {
    return invoke<TrackingFetchResult>("fetch_tracking_page", {
      request: { url, method: "GET" },
    });
  }
  const response = await fetch("/__track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, method: "GET" }),
  });
  const body = (await response.json().catch(() => null)) as TrackingFetchResult | null;
  return {
    status: body?.status ?? response.status,
    text: (body?.text ?? "").slice(0, MAX_BODY),
  };
}

function absorbPage(results: Map<string, SeventeenTrackParsed>, ids: string[], text: string) {
  for (const [tracking, parsed] of parseSeventeenTrackBatch(text)) {
    results.set(tracking, mergeSeventeenTrack(results.get(tracking), parsed));
  }
  for (const id of ids) {
    results.set(id, mergeSeventeenTrack(results.get(id), parseSeventeenTrack(text, id)));
  }
}

async function lookupSeventeenTrackBatch(trackings: string[]): Promise<Map<string, SeventeenTrackParsed>> {
  const results = new Map<string, SeventeenTrackParsed>();
  const ids = seventeenTrackNumbers(trackings);
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const chunk = ids.slice(index, index + BATCH_SIZE);
    try {
      const page = await fetchTrackingPage(seventeenTrackUrl(chunk));
      absorbPage(results, chunk, page.text);
    } catch {
      // Keep any numbers already parsed from earlier chunks.
    }
    const unresolved = chunk.filter((id) => !results.get(id)?.eta && !results.get(id)?.delivered);
    for (const id of unresolved) {
      const fcs = seventeenTrackCarrierFcs(detectCarrier(id) ?? results.get(id)?.carrier);
      for (const fc of fcs) {
        if (results.get(id)?.eta || results.get(id)?.delivered) break;
        try {
          const page = await fetchTrackingPage(seventeenTrackUrl(id, fc));
          absorbPage(results, [id], page.text);
        } catch {
          // Leave this number for a later pass.
        }
      }
    }
  }
  return results;
}

function orderChanged(previous: ParsedOrder, next: ParsedOrder): boolean {
  return (
    previous.status !== next.status ||
    previous.trackingNumber !== next.trackingNumber ||
    previous.carrier !== next.carrier ||
    previous.expectedDelivery !== next.expectedDelivery ||
    previous.expectedDeliveryAt !== next.expectedDeliveryAt ||
    previous.expectedDeliverySource !== next.expectedDeliverySource ||
    previous.events.length !== next.events.length
  );
}

let inflight: Promise<ParsedOrder[]> | null = null;
let inflightKey = "";

export async function stripUnconfirmedSeventeenTrackDelivered(orders: ParsedOrder[]): Promise<ParsedOrder[]> {
  let changed = false;
  const next = orders.map((order) => {
    if (!hasSeventeenTrackDelivered(order)) return order;
    const hasRetailerDelivered = order.events.some(
      (event) => event.kind === "delivered" && !event.messageId?.startsWith("17track:delivered:"),
    );
    if (hasRetailerDelivered) return order;
    changed = true;
    return finalizeParsedOrder({
      ...order,
      events: order.events.filter((event) => !event.messageId?.startsWith("17track:delivered:")),
      updatedAt: new Date().toISOString(),
    });
  });
  if (!changed) return orders;
  await saveOrders(next);
  return next;
}

export async function refreshIncomingDeliveryDates(orders: ParsedOrder[]): Promise<ParsedOrder[]> {
  const repaired = await stripUnconfirmedSeventeenTrackDelivered(orders);
  const incoming = incomingTrackOrders(repaired);
  if (incoming.length === 0) return repaired;
  const key = seventeenTrackNumbers(incoming.map((order) => order.trackingNumber ?? "")).join(",");
  if (!key) return repaired;
  if (inflight && inflightKey === key) return inflight;
  inflightKey = key;
  inflight = refreshIncomingDeliveryDatesInner(repaired, incoming).finally(() => {
    if (inflightKey === key) inflight = null;
  });
  return inflight;
}

async function refreshIncomingDeliveryDatesInner(
  orders: ParsedOrder[],
  incoming: ParsedOrder[],
): Promise<ParsedOrder[]> {
  const lookups = await lookupSeventeenTrackBatch(incoming.map((order) => order.trackingNumber ?? ""));
  let changed = false;
  const next = [...orders];
  const byId = new Map(next.map((order, index) => [order.id, index]));

  for (const order of incoming) {
    const tracking = normalizeTracking(order.trackingNumber ?? "");
    const lookup = lookups.get(tracking);
    const expectedDelivery = lookup?.eta ?? lookup?.deliveredAt;
    const updated = applyShipmentFields(order, {
      tracking,
      carrier: lookup?.carrier ?? detectCarrier(tracking) ?? order.carrier,
      expectedDelivery,
      source: expectedDelivery ? "17track" : undefined,
      stamp: Boolean(expectedDelivery),
      delivered: lookup?.delivered,
      deliveredAt: lookup?.deliveredAt,
      clearSeventeenTrackDelivered: Boolean(lookup && !lookup.delivered && (lookup.latestStatus || lookup.eta)),
    });
    if (!orderChanged(order, updated)) continue;
    const index = byId.get(order.id);
    if (index == null) continue;
    next[index] = updated;
    changed = true;
  }

  if (!changed) return orders;
  await saveOrders(next);
  return next;
}
