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

export function seventeenTrackUrl(trackings: string | string[]): string {
  const ids = seventeenTrackNumbers(Array.isArray(trackings) ? trackings : [trackings]);
  return `https://t.17track.net/en#nums=${ids.map((id) => encodeURIComponent(id)).join(",")}`;
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

function walkSeventeenTrack(
  value: unknown,
  found: { eta?: string; carrier?: ShipmentCarrier },
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
    if (!found.carrier && (lower === "carrier" || lower === "name" || lower === "alias")) {
      if (typeof nested === "number" || typeof nested === "string") {
        found.carrier = CARRIER_CODES[String(nested)] ?? carrierFromName(String(nested));
      }
    }
    walkSeventeenTrack(nested, found, depth + 1);
  }
}

function jsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  for (const line of text.split("\n")) {
    const start = line.indexOf("{");
    if (start < 0) continue;
    try {
      objects.push(JSON.parse(line.slice(start).trim()));
    } catch {
      // Keep scanning other captured restapi bodies.
    }
  }
  return objects;
}

function shipmentNumber(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const raw = record.number ?? record.num ?? record.tracking ?? record.no;
  return typeof raw === "string" || typeof raw === "number" ? String(raw).replace(/[\s-]/g, "").toUpperCase() : undefined;
}

export function parseSeventeenTrackBatch(
  text: string,
): Map<string, { eta?: string; carrier?: ShipmentCarrier }> {
  const results = new Map<string, { eta?: string; carrier?: ShipmentCarrier }>();
  for (const json of jsonObjects(text)) {
    if (!json || typeof json !== "object") continue;
    const record = json as Record<string, unknown>;
    const shipments = Array.isArray(record.shipments) ? record.shipments : [json];
    for (const shipment of shipments) {
      const number = shipmentNumber(shipment);
      if (!number) continue;
      const found: { eta?: string; carrier?: ShipmentCarrier } = {};
      walkSeventeenTrack(shipment, found);
      if (!found.carrier) found.carrier = detectCarrier(number);
      const previous = results.get(number);
      results.set(number, {
        eta: found.eta ?? previous?.eta,
        carrier: found.carrier ?? previous?.carrier,
      });
    }
  }
  return results;
}

export function parseSeventeenTrack(
  text: string,
  tracking: string,
): { eta?: string; carrier?: ShipmentCarrier } {
  const id = tracking.replace(/[\s-]/g, "").toUpperCase();
  return parseSeventeenTrackBatch(text).get(id) ?? { carrier: detectCarrier(id) };
}
