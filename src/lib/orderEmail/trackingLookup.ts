import { invoke } from "@tauri-apps/api/core";
import { saveOrders } from "../api";
import { isTauriRuntime } from "../env";
import type { ParsedOrder, ShipmentCarrier } from "../types";
import { allowedTrackingHost, detectCarrier, normalizeTracking } from "./carrier";
import { isInTransitOrder } from "./dashboard";
import { finalizeParsedOrder } from "./merge";
import {
  parseSeventeenTrackBatch,
  seventeenTrackCarrierFcs,
  seventeenTrackNumbers,
  seventeenTrackUrl,
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

function missingDateOrders(orders: ParsedOrder[]): ParsedOrder[] {
  return orders.filter((order) => {
    if (!isInTransitOrder(order) || order.expectedDelivery) return false;
    return isUsableId(normalizeTracking(order.trackingNumber ?? ""));
  });
}

function applyShipmentFields(
  order: ParsedOrder,
  patch: {
    tracking?: string;
    carrier?: ShipmentCarrier;
    expectedDelivery?: string;
    source?: "carrier" | "email" | "17track";
    stamp?: boolean;
  },
): ParsedOrder {
  const tracking = patch.tracking ?? order.trackingNumber;
  const carrier = patch.carrier ?? detectCarrier(tracking) ?? order.carrier;
  const expectedDelivery = patch.expectedDelivery ?? order.expectedDelivery;
  return finalizeParsedOrder({
    ...order,
    trackingNumber: tracking,
    carrier,
    expectedDelivery,
    expectedDeliverySource: patch.expectedDelivery ? patch.source : order.expectedDeliverySource,
    expectedDeliveryAt: patch.stamp ? new Date().toISOString() : order.expectedDeliveryAt,
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

async function lookupSeventeenTrackBatch(
  trackings: string[],
): Promise<Map<string, { eta?: string; carrier?: ShipmentCarrier }>> {
  const results = new Map<string, { eta?: string; carrier?: ShipmentCarrier }>();
  const ids = seventeenTrackNumbers(trackings);
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const chunk = ids.slice(index, index + BATCH_SIZE);
    try {
      const page = await fetchTrackingPage(seventeenTrackUrl(chunk));
      for (const [tracking, parsed] of parseSeventeenTrackBatch(page.text)) {
        results.set(tracking, parsed);
      }
    } catch {
      // Keep any numbers already parsed from earlier chunks.
    }
    const unresolved = chunk.filter((id) => !results.get(id)?.eta);
    for (const id of unresolved) {
      const fcs = seventeenTrackCarrierFcs(detectCarrier(id) ?? results.get(id)?.carrier);
      for (const fc of fcs) {
        if (results.get(id)?.eta) break;
        try {
          const page = await fetchTrackingPage(seventeenTrackUrl(id, fc));
          for (const [tracking, parsed] of parseSeventeenTrackBatch(page.text)) {
            const previous = results.get(tracking);
            results.set(tracking, {
              eta: parsed.eta ?? previous?.eta,
              carrier: parsed.carrier ?? previous?.carrier,
            });
          }
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
    previous.trackingNumber !== next.trackingNumber ||
    previous.carrier !== next.carrier ||
    previous.expectedDelivery !== next.expectedDelivery ||
    previous.expectedDeliveryAt !== next.expectedDeliveryAt ||
    previous.expectedDeliverySource !== next.expectedDeliverySource
  );
}

let inflight: Promise<ParsedOrder[]> | null = null;
let inflightKey = "";

export async function refreshIncomingDeliveryDates(orders: ParsedOrder[]): Promise<ParsedOrder[]> {
  const missing = missingDateOrders(orders);
  if (missing.length === 0) return orders;
  const key = seventeenTrackNumbers(missing.map((order) => order.trackingNumber ?? "")).join(",");
  if (!key) return orders;
  if (inflight && inflightKey === key) return inflight;
  inflightKey = key;
  inflight = refreshIncomingDeliveryDatesInner(orders, missing).finally(() => {
    if (inflightKey === key) inflight = null;
  });
  return inflight;
}

async function refreshIncomingDeliveryDatesInner(
  orders: ParsedOrder[],
  missing: ParsedOrder[],
): Promise<ParsedOrder[]> {
  const lookups = await lookupSeventeenTrackBatch(missing.map((order) => order.trackingNumber ?? ""));
  let changed = false;
  const next = [...orders];
  const byId = new Map(next.map((order, index) => [order.id, index]));

  for (const order of missing) {
    const tracking = normalizeTracking(order.trackingNumber ?? "");
    const lookup = lookups.get(tracking);
    const updated = applyShipmentFields(order, {
      tracking,
      carrier: lookup?.carrier ?? detectCarrier(tracking) ?? order.carrier,
      expectedDelivery: lookup?.eta,
      source: lookup?.eta ? "17track" : undefined,
      stamp: Boolean(lookup?.eta),
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
