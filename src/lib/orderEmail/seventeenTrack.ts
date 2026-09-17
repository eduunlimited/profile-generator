import type { ShipmentCarrier } from "../types";
import { detectCarrier, toIsoDate } from "./carrier";

const CARRIER_CODES: Record<string, ShipmentCarrier> = {
  "100002": "ups",
  "100003": "fedex",
  "100021": "fedex",
  "190008": "fedex",
  "21051": "usps",
};

export function seventeenTrackNumbers(values: string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = value.replace(/[\s-]/g, "").toUpperCase();
    if (id.length < 8 || id === "—" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function seventeenTrackCarrierFcs(carrier?: ShipmentCarrier): string[] {
  if (carrier === "fedex") return ["100003", "100021", "190008"];
  if (carrier === "ups") return ["100002"];
  if (carrier === "usps") return ["21051"];
  return ["100003", "100002", "21051"];
}

export function seventeenTrackCarrierFc(carrier?: ShipmentCarrier): string | undefined {
  return seventeenTrackCarrierFcs(carrier)[0];
}

export function seventeenTrackUrl(trackings: string | string[], carrierFc?: string): string {
  const ids = seventeenTrackNumbers(Array.isArray(trackings) ? trackings : [trackings]);
  const fc = carrierFc?.trim() ? `&fc=${encodeURIComponent(carrierFc.trim())}` : "";
  return `https://t.17track.net/en#nums=${ids.map((id) => encodeURIComponent(id)).join(",")}${fc}`;
}

function carrierFromName(value: string): ShipmentCarrier | undefined {
  if (/\bfedex\b/i.test(value)) return "fedex";
  if (/\bups\b/i.test(value)) return "ups";
  if (/\busps\b/i.test(value)) return "usps";
  return undefined;
}

function isoFromUnknown(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : toIsoDate(date);
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
}

export interface SeventeenTrackParsed {
  eta?: string;
  carrier?: ShipmentCarrier;
  delivered?: boolean;
  deliveredAt?: string;
}

function walkSeventeenTrack(
  value: unknown,
  found: SeventeenTrackParsed,
  depth = 0,
) {
  if (!value || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) walkSeventeenTrack(item, found, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (!found.eta && lower.includes("estimated_delivery") && nested && typeof nested === "object" && !Array.isArray(nested)) {
      const window = nested as Record<string, unknown>;
      found.eta = isoFromUnknown(window.from) ?? isoFromUnknown(window.to);
    }
    if (!found.eta && /est.*(deliv|arriva)|deliv.*(date|time)|time_from|time_to/.test(lower)) {
      found.eta = isoFromUnknown(nested);
    }
    if (!found.delivered && lower === "status" && typeof nested === "string" && /^delivered$/i.test(nested)) {
      found.delivered = true;
    }
    if (!found.carrier && (lower === "carrier" || lower === "name" || lower === "alias")) {
      if (typeof nested === "number" || typeof nested === "string") {
        found.carrier = CARRIER_CODES[String(nested)] ?? carrierFromName(String(nested));
      }
    }
    walkSeventeenTrack(nested, found, depth + 1);
  }
}

function tryParseJson(raw: string, objects: unknown[]) {
  try {
    objects.push(JSON.parse(raw));
  } catch {
    // Keep scanning other captured restapi bodies.
  }
}

function jsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  for (const block of text.split(/\n(?=\{)/)) {
    const start = block.indexOf("{");
    const end = block.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    tryParseJson(block.slice(start, end + 1).trim(), objects);
  }
  if (objects.length === 0) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) tryParseJson(text.slice(start, end + 1), objects);
  }
  return objects;
}

function shipmentInner(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const inner = record.shipment && typeof record.shipment === "object" ? (record.shipment as Record<string, unknown>) : record;
  return inner;
}

function etaFromShipment(value: unknown): string | undefined {
  const inner = shipmentInner(value);
  const metrics = inner?.time_metrics && typeof inner.time_metrics === "object" ? (inner.time_metrics as Record<string, unknown>) : undefined;
  const window =
    metrics?.estimated_delivery_date && typeof metrics.estimated_delivery_date === "object"
      ? (metrics.estimated_delivery_date as Record<string, unknown>)
      : undefined;
  return isoFromUnknown(window?.from) ?? isoFromUnknown(window?.to);
}

function deliveredFromShipment(value: unknown): { delivered?: boolean; deliveredAt?: string } {
  const inner = shipmentInner(value);
  if (!inner) return {};
  const latest = inner.latest_status && typeof inner.latest_status === "object" ? (inner.latest_status as Record<string, unknown>) : undefined;
  const latestEvent = inner.latest_event && typeof inner.latest_event === "object" ? (inner.latest_event as Record<string, unknown>) : undefined;
  const milestones = Array.isArray(inner.milestone) ? inner.milestone : [];
  const deliveredMilestone = milestones.find((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return String(row.key_stage ?? "") === "Delivered" && (row.time_iso || row.time_utc);
  }) as Record<string, unknown> | undefined;
  const delivered = /^delivered$/i.test(String(latest?.status ?? "")) || Boolean(deliveredMilestone);
  if (!delivered) return {};
  return {
    delivered: true,
    deliveredAt:
      isoFromUnknown(deliveredMilestone?.time_iso) ??
      isoFromUnknown(deliveredMilestone?.time_utc) ??
      isoFromUnknown(latestEvent?.time_iso) ??
      isoFromUnknown(latestEvent?.time_utc),
  };
}

function shipmentNumber(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const raw = record.number ?? record.num ?? record.tracking ?? record.no;
  return typeof raw === "string" || typeof raw === "number" ? String(raw).replace(/[\s-]/g, "").toUpperCase() : undefined;
}

export function parseSeventeenTrackBatch(text: string): Map<string, SeventeenTrackParsed> {
  const results = new Map<string, SeventeenTrackParsed>();
  for (const json of jsonObjects(text)) {
    if (!json || typeof json !== "object") continue;
    const record = json as Record<string, unknown>;
    const shipments = Array.isArray(record.shipments) ? record.shipments : [json];
    for (const shipment of shipments) {
      const number = shipmentNumber(shipment);
      if (!number) continue;
      const found: SeventeenTrackParsed = { eta: etaFromShipment(shipment), ...deliveredFromShipment(shipment) };
      walkSeventeenTrack(shipment, found);
      if (!found.carrier) found.carrier = detectCarrier(number);
      const previous = results.get(number);
      results.set(number, {
        eta: found.eta ?? previous?.eta,
        carrier: found.carrier ?? previous?.carrier,
        delivered: found.delivered || previous?.delivered,
        deliveredAt: found.deliveredAt ?? previous?.deliveredAt,
      });
    }
  }
  return results;
}

export function parseSeventeenTrack(text: string, tracking: string): SeventeenTrackParsed {
  const id = tracking.replace(/[\s-]/g, "").toUpperCase();
  return parseSeventeenTrackBatch(text).get(id) ?? { carrier: detectCarrier(id) };
}
