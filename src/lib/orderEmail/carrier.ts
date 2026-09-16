import type { ShipmentCarrier } from "../types";

export type { ShipmentCarrier };

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const DATE_TOKEN =
  "(?:[A-Za-z]+day,?\\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+\\d{1,2}(?:(?:st|nd|rd|th))?(?:,?\\s+\\d{4})?|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{4}-\\d{2}-\\d{2}";

const CONTEXT_PATTERNS = [
  new RegExp(
    `(?:scheduled|estimated|expected|anticipated)\\s+delivery(?:\\s+(?:date|day|by))?\\s*[:\\-–]?\\s*(${DATE_TOKEN})`,
    "i",
  ),
  new RegExp(`(?:arriving|arrives|arrive)\\s+(?:by|on)\\s+(${DATE_TOKEN})`, "i"),
  new RegExp(`delivered(?:\\s+(?:on|by))?\\s*[:\\-–]?\\s*(${DATE_TOKEN})`, "i"),
  new RegExp(`delivery date\\s*[:\\-–]?\\s*(${DATE_TOKEN})`, "i"),
  new RegExp(
    `your package has been delivered[\\s\\S]{0,240}?(${DATE_TOKEN})`,
    "i",
  ),
];

const JSON_DATE_KEY =
  /"(?:displayEstDeliveryDt|estDeliveryDt|scheduledDeliveryDate|scheduledDeliveryDay|expectedDeliveryDate|expectedDelivery|deliveryDate|deliveredDate|deliveredOn)"\s*:\s*"([^"]+)"/gi;

const INVALID_PAGE =
  /we can['’]t find|cannot find that tracking|could not find|invalid tracking|no record of|not able to locate|tracking number not found|we'?re sorry,? we cannot|does not match our records/i;

const FOUND_PAGE =
  /scheduled delivery|estimated delivery|expected delivery|out for delivery|on the way|in transit|delivered|arriving|we have your package/i;

export function normalizeTracking(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function isUsableTracking(value?: string): boolean {
  const id = normalizeTracking(value ?? "");
  return id.length >= 8 && id !== "—" && !/^P\d{8,14}$/.test(id);
}

export function detectCarrier(tracking?: string): ShipmentCarrier | undefined {
  const id = normalizeTracking(tracking ?? "");
  if (!isUsableTracking(id)) return undefined;
  if (/^1Z[A-Z0-9]{16}$/.test(id)) return "ups";
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(id)) return "usps";
  if (/^9[1-5]\d{18,32}$/.test(id) && id.length >= 20) return "usps";
  if (/^96\d{18,22}$/.test(id)) return "fedex";
  if (/^\d{15}$/.test(id)) return "fedex";
  if (/^\d{12}$/.test(id)) return "fedex";
  if (/^\d{20}$/.test(id)) return /^9[1-5]/.test(id) ? "usps" : "fedex";
  if (/^\d{22}$/.test(id)) {
    if (/^96/.test(id)) return "fedex";
    return "usps";
  }
  if (/^\d{26,34}$/.test(id)) return "usps";
  return undefined;
}

export function carrierCandidates(tracking?: string): ShipmentCarrier[] {
  const all: ShipmentCarrier[] = ["fedex", "ups", "usps"];
  const detected = detectCarrier(tracking);
  return detected ? [detected, ...all.filter((carrier) => carrier !== detected)] : all;
}

export function carrierLabel(carrier?: ShipmentCarrier): string {
  if (carrier === "fedex") return "FedEx";
  if (carrier === "ups") return "UPS";
  if (carrier === "usps") return "USPS";
  return "";
}

export function detectCarrierFromText(text: string, tracking?: string): ShipmentCarrier | undefined {
  if (/fedex\.com|fedextrack/i.test(text)) return "fedex";
  if (/ups\.com/i.test(text)) return "ups";
  if (/usps\.com/i.test(text)) return "usps";
  return detectCarrier(tracking);
}

export function trackingStrength(tracking?: string): number {
  const id = normalizeTracking(tracking ?? "");
  if (!isUsableTracking(id)) return 0;
  if (/^1Z[A-Z0-9]{16}$/.test(id)) return 6;
  if (id.length >= 20 && detectCarrier(id)) return 5;
  if (/^\d{15}$/.test(id)) return 4;
  if (detectCarrier(id)) return 3;
  return 1;
}

export function preferTracking(...values: Array<string | undefined>): string | undefined {
  let best: string | undefined;
  let bestScore = 0;
  for (const value of values) {
    const id = normalizeTracking(value ?? "");
    const score = trackingStrength(id);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

export function trackingUrl(carrier: ShipmentCarrier, tracking: string): string {
  const id = encodeURIComponent(normalizeTracking(tracking));
  if (carrier === "ups") return `https://www.ups.com/track?tracknum=${id}&loc=en_US`;
  if (carrier === "usps") {
    return `https://tools.usps.com/go/TrackConfirmAction?tRef=fullpage&tLc=2&text28777=&tLabels=${id}`;
  }
  return `https://www.fedex.com/fedextrack/?trknbr=${id}`;
}

export function allowedTrackingHost(host: string): boolean {
  return (
    host === "www.fedex.com" ||
    host === "www.ups.com" ||
    host === "webapis.ups.com" ||
    host === "wwwapps.ups.com" ||
    host === "tools.usps.com" ||
    host === "www.usps.com"
  );
}

export function formatEtaLabel(iso?: string): string {
  if (!iso) return "—";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLooseDate(raw: string, now = new Date()): Date | undefined {
  const value = raw.replace(/\s+/g, " ").replace(/(\d+)(?:st|nd|rd|th)/i, "$1").trim();
  if (!value || /billed|shipped|label created|order date/i.test(value)) return undefined;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    const date = new Date(year, Number(slash[1]) - 1, Number(slash[2]));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const named = value.match(
    /(?:[A-Za-z]+day,?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/,
  );
  if (!named) return undefined;
  const month = MONTHS[named[1].toLowerCase()];
  if (month == null) return undefined;
  const day = Number(named[2]);
  let year = named[3] ? Number(named[3]) : now.getFullYear();
  const date = new Date(year, month, day);
  if (Number.isNaN(date.getTime())) return undefined;
  if (!named[3]) {
    const delta = date.getTime() - now.getTime();
    if (delta < -45 * 24 * 60 * 60 * 1000) date.setFullYear(year + 1);
  }
  return date;
}

export function parseDeliveryDate(text: string, now = new Date()): string | undefined {
  if (!text.trim()) return undefined;
  const compact = text.replace(/\s+/g, " ");
  for (const pattern of CONTEXT_PATTERNS) {
    const match = compact.match(pattern);
    const parsed = match?.[1] ? parseLooseDate(match[1], now) : undefined;
    if (parsed) return toIsoDate(parsed);
  }
  for (const match of text.matchAll(JSON_DATE_KEY)) {
    const parsed = parseLooseDate(match[1] ?? "", now);
    if (parsed) return toIsoDate(parsed);
  }
  return undefined;
}

export function pageLooksInvalid(text: string): boolean {
  return INVALID_PAGE.test(text);
}

export function pageLooksTracked(text: string): boolean {
  return FOUND_PAGE.test(text) && !pageLooksInvalid(text);
}

export function parseCarrierPage(text: string, now = new Date()): string | undefined {
  return parseDeliveryDate(text, now);
}
