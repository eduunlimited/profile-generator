import { invoke } from "@tauri-apps/api/core";
import { fetchImapMessage, listImapAccounts, saveOrders } from "../api";
import { isTauriRuntime } from "../env";
import { imapAccountToSettings } from "../imapInbox";
import type { ParsedOrder, ShipmentCarrier } from "../types";
import {
  allowedTrackingHost,
  carrierCandidates,
  detectCarrier,
  detectCarrierFromText,
  normalizeTracking,
  pageLooksInvalid,
  pageLooksTracked,
  parseCarrierPage,
  preferTracking,
  trackingUrl,
} from "./carrier";
import { isInTransitOrder } from "./dashboard";
import { finalizeParsedOrder } from "./merge";
import { shipmentHintsFromText } from "./parse";
import { parseSeventeenTrack, seventeenTrackUrl } from "./seventeenTrack";

const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_BODY = 250_000;

export interface TrackingFetchResult {
  status: number;
  text: string;
}

export interface TrackingEtaResult {
  tracking: string;
  carrier?: ShipmentCarrier;
  eta?: string;
  source?: "carrier" | "email" | "17track";
}

function isFresh(order: ParsedOrder): boolean {
  const stamped = Date.parse(order.expectedDeliveryAt ?? "");
  if (!Number.isFinite(stamped)) return false;
  const age = Date.now() - stamped;
  if (order.expectedDelivery) return age < CACHE_MS;
  return age < 10 * 60 * 1000;
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
  const tracking = preferTracking(patch.tracking, order.trackingNumber) ?? order.trackingNumber;
  const carrier = patch.carrier ?? detectCarrier(tracking) ?? order.carrier;
  const expectedDelivery = patch.expectedDelivery ?? order.expectedDelivery;
  const source = patch.expectedDelivery
    ? patch.source
    : order.expectedDeliverySource;
  return finalizeParsedOrder({
    ...order,
    trackingNumber: tracking,
    carrier,
    expectedDelivery,
    expectedDeliverySource: source,
    expectedDeliveryAt: patch.stamp ? new Date().toISOString() : order.expectedDeliveryAt,
  });
}

async function fetchTrackingPage(url: string, init?: { method?: string; json?: unknown }): Promise<TrackingFetchResult> {
  const parsed = new URL(url);
  if (!allowedTrackingHost(parsed.host)) {
    return { status: 0, text: "" };
  }
  if (isTauriRuntime()) {
    return invoke<TrackingFetchResult>("fetch_tracking_page", {
      request: {
        url,
        method: init?.method ?? "GET",
        body: init?.json != null ? JSON.stringify(init.json) : undefined,
      },
    });
  }
  const response = await fetch("/__track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      method: init?.method ?? "GET",
      json: init?.json,
    }),
  });
  const body = (await response.json().catch(() => null)) as TrackingFetchResult | null;
  return {
    status: body?.status ?? response.status,
    text: (body?.text ?? "").slice(0, MAX_BODY),
  };
}

async function lookupSeventeenTrack(tracking: string): Promise<TrackingEtaResult> {
  const id = normalizeTracking(tracking);
  try {
    const page = await fetchTrackingPage(seventeenTrackUrl(id));
    if (!page.text) return { tracking: id, carrier: detectCarrier(id) };
    const parsed = parseSeventeenTrack(page.text, id);
    return {
      tracking: id,
      carrier: parsed.carrier ?? detectCarrier(id),
      eta: parsed.eta,
      source: parsed.eta ? "17track" : undefined,
    };
  } catch {
    return { tracking: id, carrier: detectCarrier(id) };
  }
}

async function lookupCarrierEta(tracking: string): Promise<TrackingEtaResult> {
  const id = normalizeTracking(tracking);
  const from17 = await lookupSeventeenTrack(id);
  if (from17.eta) return from17;
  const detected = from17.carrier ?? detectCarrier(id);
  if (!isUsableId(id)) return { tracking: id, carrier: detected };

  for (const carrier of carrierCandidates(id)) {
    if (carrier === "ups") {
      const api = await fetchTrackingPage("https://www.ups.com/track/api/Track/GetStatus?loc=en_US", {
        method: "POST",
        json: { Locale: "en_US", TrackingNumber: [id] },
      });
      const eta = parseCarrierPage(api.text);
      if (eta) return { tracking: id, carrier, eta, source: "carrier" };
    }

    const page = await fetchTrackingPage(trackingUrl(carrier, id));
    if (!page.text || pageLooksInvalid(page.text)) continue;
    const eta = parseCarrierPage(page.text);
    if (eta || pageLooksTracked(page.text)) {
      return { tracking: id, carrier, eta, source: eta ? "carrier" : undefined };
    }
  }

  return { tracking: id, carrier: detected };
}

function isUsableId(id: string): boolean {
  return id.length >= 8 && id !== "—";
}

async function enrichFromShippedEmail(order: ParsedOrder): Promise<ParsedOrder> {
  const shipped = [...order.events].reverse().find((event) => event.kind === "shipped");
  if (!shipped) return order;
  const accounts = await listImapAccounts();
  const account = accounts.find((item) => item.id === shipped.accountId);
  if (!account) return order;
  try {
    const full = await fetchImapMessage(imapAccountToSettings(account), shipped.uid);
    const hints = shipmentHintsFromText(
      order.orderId,
      full.htmlBody ?? "",
      full.body ?? "",
      full.subject ?? "",
      full.snippet ?? "",
    );
    return applyShipmentFields(order, {
      tracking: hints.tracking,
      carrier: hints.carrier ?? detectCarrierFromText(
        [full.htmlBody ?? "", full.body ?? "", full.subject ?? ""].join("\n"),
        hints.tracking ?? order.trackingNumber,
      ),
      expectedDelivery: hints.expectedDelivery,
      source: hints.expectedDelivery ? "email" : undefined,
    });
  } catch {
    return order;
  }
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
  const targets = orders.filter(isInTransitOrder);
  if (targets.length === 0) return orders;
  if (targets.every((order) => isFresh(order) && order.carrier)) return orders;
  const key = targets.map((order) => `${order.id}:${order.trackingNumber ?? ""}`).join("|");
  if (inflight && inflightKey === key) return inflight;
  inflightKey = key;
  inflight = refreshIncomingDeliveryDatesInner(orders, targets).finally(() => {
    if (inflightKey === key) inflight = null;
  });
  return inflight;
}

async function refreshIncomingDeliveryDatesInner(
  orders: ParsedOrder[],
  targets: ParsedOrder[],
): Promise<ParsedOrder[]> {

  let changed = false;
  const next = [...orders];
  const byId = new Map(next.map((order, index) => [order.id, index]));

  for (const order of targets) {
    if (isFresh(order)) continue;
    let updated = order;
    if (!isFresh(order) || !order.expectedDelivery || trackingStrengthNeeded(order)) {
      updated = await enrichFromShippedEmail(updated);
    }
    const tracking = updated.trackingNumber;
    if (tracking && isUsableId(normalizeTracking(tracking))) {
      try {
        const lookup = await lookupCarrierEta(tracking);
        updated = applyShipmentFields(updated, {
          tracking: lookup.tracking,
          carrier: lookup.carrier,
          expectedDelivery: lookup.eta,
          source: lookup.eta ? "carrier" : updated.expectedDelivery ? updated.expectedDeliverySource : undefined,
          stamp: true,
        });
      } catch {
        updated = applyShipmentFields(updated, {
          carrier: updated.carrier ?? detectCarrier(tracking),
          stamp: true,
        });
      }
    } else {
      updated = applyShipmentFields(updated, {
        carrier: updated.carrier,
        stamp: true,
      });
    }
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

function trackingStrengthNeeded(order: ParsedOrder): boolean {
  const id = normalizeTracking(order.trackingNumber ?? "");
  return /^\d{12}$/.test(id);
}
