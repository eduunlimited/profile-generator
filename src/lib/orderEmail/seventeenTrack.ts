import type { ShipmentCarrier } from "../types";
import { detectCarrier, toIsoDate } from "./carrier";

const CARRIER_CODES: Record<string, ShipmentCarrier> = {
  "100002": "ups",
  "100003": "fedex",
  "100021": "fedex",
  "190008": "fedex",
  "21051": "usps",
};

export function seventeenTrackUrl(tracking: string): string {
  return `https://t.17track.net/en#nums=${encodeURIComponent(tracking)}`;
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

function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  const line = text.slice(start).split("\n")[0]?.trim() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

export function parseSeventeenTrack(
  text: string,
  tracking: string,
): { eta?: string; carrier?: ShipmentCarrier } {
  const found: { eta?: string; carrier?: ShipmentCarrier } = {};
  const json = firstJsonObject(text);
  if (json) walkSeventeenTrack(json, found);
  if (!found.carrier) found.carrier = detectCarrier(tracking);
  return found;
}
