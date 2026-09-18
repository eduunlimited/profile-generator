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
  latestStatus?: string;
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

function latestStatusFromShipment(value: unknown): string | undefined {
  const inner = shipmentInner(value);
  const latest = inner?.latest_status && typeof inner.latest_status === "object" ? (inner.latest_status as Record<string, unknown>) : undefined;
  const status = String(latest?.status ?? "").trim();
  return status || undefined;
}

function deliveredFromShipment(value: unknown): { delivered?: boolean; deliveredAt?: string } {
  const inner = shipmentInner(value);
  if (!inner) return {};
  const latest = inner.latest_status && typeof inner.latest_status === "object" ? (inner.latest_status as Record<string, unknown>) : undefined;
  const latestEvent = inner.latest_event && typeof inner.latest_event === "object" ? (inner.latest_event as Record<string, unknown>) : undefined;
  if (!/^delivered$/i.test(String(latest?.status ?? ""))) return {};
  const milestones = Array.isArray(inner.milestone) ? inner.milestone : [];
  const deliveredMilestone = milestones.find((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return String(row.key_stage ?? "") === "Delivered" && (row.time_iso || row.time_utc);
  }) as Record<string, unknown> | undefined;
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

export function mergeSeventeenTrack(
  previous: SeventeenTrackParsed | undefined,
  parsed: SeventeenTrackParsed,
): SeventeenTrackParsed {
  const latestStatus = parsed.latestStatus ?? previous?.latestStatus;
  const delivered = latestStatus && !/^delivered$/i.test(latestStatus)
    ? false
    : Boolean(parsed.delivered || previous?.delivered);
  return {
    eta: parsed.eta ?? previous?.eta,
    carrier: parsed.carrier ?? previous?.carrier,
    delivered: delivered || undefined,
    deliveredAt: delivered ? parsed.deliveredAt ?? previous?.deliveredAt : undefined,
    latestStatus,
  };
}

function pageTextWithoutNumsPrefix(text: string): string {
  return text.replace(/^\s*NUMS:[^\n]*\n/i, "");
}

function parsePageText(text: string): Map<string, SeventeenTrackParsed> {
  const results = new Map<string, SeventeenTrackParsed>();
  const body = pageTextWithoutNumsPrefix(text);
  const events: Array<{ pos: number; kind: "id" | "deliveredAt" | "eta"; value: string }> = [];
  for (const match of body.matchAll(/\b([A-Z0-9]{10,34})\b/gi)) {
    const id = match[1].replace(/[\s-]/g, "").toUpperCase();
    if (id.length < 10) continue;
    events.push({ pos: match.index ?? 0, kind: "id", value: id });
  }
  for (const match of body.matchAll(/time of delivery[:\s\-–]*(\d{4}-\d{2}-\d{2})/gi)) {
    events.push({ pos: match.index ?? 0, kind: "deliveredAt", value: match[1] });
  }
  for (const match of body.matchAll(/estimated(?:\s+delivery)?(?:\s+date)?[:\s\-–]*(\d{4}-\d{2}-\d{2})/gi)) {
    events.push({ pos: match.index ?? 0, kind: "eta", value: match[1] });
  }
  events.sort((left, right) => left.pos - right.pos);

  let current: string | undefined;
  for (const event of events) {
    if (event.kind === "id") {
      current = event.value;
      if (!results.has(current)) results.set(current, { carrier: detectCarrier(current) });
      continue;
    }
    if (!current) continue;
    const previous = results.get(current) ?? { carrier: detectCarrier(current) };
    if (event.kind === "deliveredAt") {
      results.set(current, {
        ...previous,
        delivered: true,
        deliveredAt: previous.deliveredAt ?? event.value,
        eta: previous.eta ?? event.value,
      });
    } else if (event.kind === "eta") {
      results.set(current, { ...previous, eta: previous.eta ?? event.value });
    }
  }
  return results;
}

function numsPrefixIds(text: string): string[] {
  const line = text.match(/^\s*NUMS:\s*([^\n]+)/i)?.[1];
  if (!line) return [];
  return seventeenTrackNumbers(line.split(/[,\s]+/));
}

function parseWholePageForId(text: string, tracking: string): SeventeenTrackParsed {
  const id = tracking.replace(/[\s-]/g, "").toUpperCase();
  const prefixIds = numsPrefixIds(text);
  if (prefixIds.length > 1) return {};
  const body = pageTextWithoutNumsPrefix(text);
  const otherIds = [...body.matchAll(/\b([A-Z0-9]{10,34})\b/gi)]
    .map((match) => match[1].replace(/[\s-]/g, "").toUpperCase())
    .filter((value) => value !== id && value.length >= 10);
  if (otherIds.length > 0) return {};
  const deliveredAt = body.match(/time of delivery[:\s\-–]*(\d{4}-\d{2}-\d{2})/i)?.[1];
  const eta = body.match(/estimated(?:\s+delivery)?(?:\s+date)?[:\s\-–]*(\d{4}-\d{2}-\d{2})/i)?.[1];
  const delivered = Boolean(deliveredAt);
  if (!eta && !deliveredAt) return {};
  return {
    eta: eta ?? deliveredAt,
    delivered: delivered || undefined,
    deliveredAt,
    carrier: carrierFromName(body) ?? detectCarrier(id),
  };
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
      const found: SeventeenTrackParsed = {
        eta: etaFromShipment(shipment),
        latestStatus: latestStatusFromShipment(shipment),
        ...deliveredFromShipment(shipment),
      };
      walkSeventeenTrack(shipment, found);
      if (!found.carrier) found.carrier = detectCarrier(number);
      results.set(number, mergeSeventeenTrack(results.get(number), found));
    }
  }
  for (const [tracking, parsed] of parsePageText(text)) {
    results.set(tracking, mergeSeventeenTrack(results.get(tracking), parsed));
  }
  return results;
}

export function parseSeventeenTrack(text: string, tracking: string): SeventeenTrackParsed {
  const id = tracking.replace(/[\s-]/g, "").toUpperCase();
  const found = mergeSeventeenTrack(parseSeventeenTrackBatch(text).get(id), parseWholePageForId(text, id));
  return { ...found, carrier: found.carrier ?? detectCarrier(id) };
}
