import type { OrderAddress, OrderPayment, ShipmentCarrier } from "../types";
import { detectCarrierFromText, parseDeliveryDate, preferTracking } from "./carrier";

/** Windows-1252 / Latin-1 code units so UTF-8 mojibake (PokÃ©mon, â€”) can be reversed. */
const WINDOWS_1252_FROM_CHAR = new Map<number, number>([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

function windows1252Byte(char: string): number | undefined {
  const code = char.charCodeAt(0);
  const mapped = WINDOWS_1252_FROM_CHAR.get(code);
  if (mapped != null) return mapped;
  if (code <= 0xff) return code;
  return undefined;
}

function looksLikeMojibake(value: string): boolean {
  return /Ã.|Â.|â€.|â€™|â€œ|â€˜|â€“|â€”/.test(value);
}

/** Repair UTF-8 text that was decoded as Windows-1252 (PokÃ©mon → Pokémon, â€” → —). */
export function repairUtf8Mojibake(value: string): string {
  let current = value;
  for (let attempt = 0; attempt < 3 && looksLikeMojibake(current); attempt += 1) {
    const bytes: number[] = [];
    let encodable = true;
    for (const char of current) {
      const byte = windows1252Byte(char);
      if (byte == null) {
        encodable = false;
        break;
      }
      bytes.push(byte);
    }
    if (!encodable) break;
    try {
      const next = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current
    .replace(/Ã©/g, "\u00e9")
    .replace(/Ã‰/g, "\u00c9")
    .replace(/â€”/g, "\u2014")
    .replace(/â€“/g, "\u2013")
    .replace(/â€™/g, "\u2019")
    .replace(/â€œ/g, "\u201c")
    .replace(/â€\u009d/g, "\u201d");
}

function decodeEntities(value: string): string {
  return repairUtf8Mojibake(
    value
      .replace(/&nbsp;/gi, " ")
      .replace(/&#36;/g, "$")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&eacute;/gi, "\u00e9")
      .replace(/&Eacute;/gi, "\u00c9")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCharCode(code) : "";
      })
      .replace(/&#(\d+);/g, (_, dec) => {
        const code = Number(dec);
        return Number.isFinite(code) && code > 31 ? String.fromCharCode(code) : " ";
      }),
  );
}

export function emailPlainText(htmlOrText: string): string {
  const decoded = decodeEntities(maybeDecodeQuotedPrintable(htmlOrText));
  return decoded
    .replace(/\r\n?/g, "\n")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function maybeDecodeQuotedPrintable(value: string): string {
  if (!/=3C/i.test(value) && !/=\r?\n/.test(value)) return value;
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function parseMoney(raw: string): number | undefined {
  const amount = Number(raw.replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

const SHIPPING_ADDRESS_LABEL =
  /^(?:shipping\s+address|delivers?\s+to|delivering\s+to|delivery\s+address|ship(?:ping)?\s+to)\s*:?\s*$/i;
const SHIPPING_ADDRESS_INLINE =
  /^(?:shipping\s+address|delivers?\s+to|delivering\s+to|delivery\s+address|ship(?:ping)?\s+to)\s*:\s*(.+)$/i;
const PICKUP_ADDRESS_LABEL = /^(?:pickup\s+location|pick-?up\s+location|picking\s+up\s+at)\s*:?\s*$/i;
const ADDRESS_HARD_STOP =
  /^(?:order\s+summary|qty\.?|quantity|items?|subtotal|order\s+total|estimated(?:\s+arrival)?|perfect pairings|need\s+help|questions)/i;
const ADDRESS_SKIP_LINE =
  /^(?:payment(?:\s+method)?|billing(?:\s+address)?|visa\b|mastercard|amex|american express|discover|redcard|ending in|\*{2,}\d{4}|gift(?:\s+message)?|track(?:ing)?|view\s+order|promo|circle|shop|http|www\.|target\.com|write a review|visit|thanks|color|size|style|dcpi|sku|new releases|customer service)/i;
const CITY_STATE_ZIP = /^(.+?),?\s+([A-Za-z]{2}),?\s+(\d{5}(?:-\d{4})?)$/;
const COUNTRY_LINE = /^(?:united states|usa|u\.s\.a\.?)$/i;
const US_STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

function parseCityStateZip(line: string): { city: string; state: string; postalCode: string } | undefined {
  const trimmed = line.replace(/\s+/g, " ").trim();
  const abbr = trimmed.match(CITY_STATE_ZIP);
  if (abbr?.[1] && abbr[2] && abbr[3]) {
    const city = abbr[1].replace(/,+$/, "").trim();
    if (city) return { city, state: abbr[2].toUpperCase(), postalCode: abbr[3] };
  }
  const named = trimmed.match(/^(.+?),?\s+([A-Za-z][A-Za-z\s]+?),?\s+(\d{5}(?:-\d{4})?)$/);
  if (!named?.[1] || !named[2] || !named[3]) return undefined;
  const state = US_STATE_NAME_TO_ABBR[named[2].trim().toLowerCase().replace(/\s+/g, " ")];
  const city = named[1].replace(/,+$/, "").trim();
  if (!state || !city) return undefined;
  return { city, state, postalCode: named[3] };
}

function isPhoneAddressLine(line: string): boolean {
  return (
    /^(?:t|tel|telephone|phone|p)\s*[.:]/i.test(line) ||
    /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(line)
  );
}

function isAddressLabelLine(line: string): boolean {
  return SHIPPING_ADDRESS_LABEL.test(line) || PICKUP_ADDRESS_LABEL.test(line);
}

function collectLabeledAddressLines(text: string, kind: "shipping" | "pickup"): string[] | undefined {
  const lines = emailPlainText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const isLabel = kind === "shipping" ? SHIPPING_ADDRESS_LABEL : PICKUP_ADDRESS_LABEL;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inline = kind === "shipping" ? line.match(SHIPPING_ADDRESS_INLINE) : null;
    const labeled = isLabel.test(line);
    if (!labeled && !inline) continue;
    const collected: string[] = [];
    if (inline?.[1]?.trim()) collected.push(inline[1].trim());
    for (let next = index + 1; next < lines.length && collected.length < 6; next += 1) {
      const value = lines[next];
      if (isAddressLabelLine(value) || ADDRESS_HARD_STOP.test(value)) break;
      if (COUNTRY_LINE.test(value) || ADDRESS_SKIP_LINE.test(value) || isPhoneAddressLine(value)) continue;
      collected.push(value);
      if (parseCityStateZip(value) && collected.length >= 2) break;
      if (collected.length === 1 && parseCommaSeparatedAddress(value, kind)) break;
    }
    if (collected.length >= 2) return collected;
    if (collected.length === 1 && parseCommaSeparatedAddress(collected[0], kind)) return collected;
  }
  return undefined;
}

function extractShippingLinesFromHtml(html: string): string[] | undefined {
  const scoped = scopedOrderContent(html);
  const shipClass = scoped.match(
    /class=["'][^"']*ship-address[^"']*["'][^>]*>([\s\S]{0,600}?)<\/h[1-6]>/i,
  );
  if (shipClass?.[1]) {
    const text = emailPlainText(shipClass[1])
      .replace(/^delivers?\s+to:?\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length >= 10) return [text];
  }
  const delivers = scoped.match(
    /delivers?\s+to:?\s*(?:<br\s*\/?>\s*)?(?:<span[^>]*>)?\s*([^<]{10,240})/i,
  );
  if (delivers?.[1]) {
    const text = decodeEntities(delivers[1]).replace(/\s+/g, " ").trim();
    if (text.length >= 10) return [text];
  }
  const match = scoped.match(
    /(?:shipping\s+address|delivers?\s+to|delivering\s+to|delivery\s+address|ship(?:ping)?\s+to)[\s\S]{0,160}?(?:<\/(?:h[1-6]|strong|b|span|p|td|th)>)([\s\S]{0,800}?)(?:payment(?:\s+method)?|billing(?:\s+address)?|order\s+summary|qty\.?|estimated|track(?:ing)?\s+order)/i,
  );
  if (!match?.[1]) return undefined;
  const lines = emailPlainText(match[1])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COUNTRY_LINE.test(line) && !isAddressLabelLine(line));
  return lines.length > 0 ? lines.slice(0, 6) : undefined;
}

function parseCommaSeparatedAddress(value: string, source: "shipping" | "pickup"): OrderAddress | undefined {
  const line = decodeEntities(value).replace(/\s+/g, " ").trim();
  const abbr = line.match(/^(.*),\s*([A-Za-z]{2}),?\s+(\d{5}(?:-\d{4})?)$/);
  if (abbr?.[1] && abbr[2] && abbr[3]) {
    return addressFromCommaHead(abbr[1], abbr[2].toUpperCase(), abbr[3], source);
  }
  const named = line.match(/^(.*),\s*([A-Za-z][A-Za-z\s]+),\s*(\d{5}(?:-\d{4})?)$/);
  if (named?.[1] && named[2] && named[3]) {
    const state = US_STATE_NAME_TO_ABBR[named[2].trim().toLowerCase().replace(/\s+/g, " ")];
    if (state) return addressFromCommaHead(named[1], state, named[3], source);
  }
  return undefined;
}

function addressFromCommaHead(
  head: string,
  state: string,
  postalCode: string,
  source: "shipping" | "pickup",
): OrderAddress | undefined {
  const parts = head
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;
  const city = parts[parts.length - 1];
  const before = parts.slice(0, -1);
  let name: string | undefined;
  let street = before;
  if (!/^\d/.test(before[0] ?? "") && before.length >= 2) {
    name = before[0];
    street = before.slice(1);
  }
  const line1 = street[0];
  const line2 = street.slice(1).join(", ").trim() || undefined;
  if (!line1 || !city) return undefined;
  return {
    name,
    line1,
    line2,
    city,
    state,
    postalCode,
    source,
    raw: [name, line1, line2, `${city}, ${state} ${postalCode}`].filter(Boolean).join("\n"),
  };
}

function parseAddressLines(lines: string[], source: "shipping" | "pickup"): OrderAddress | undefined {
  const cleaned = lines
    .map((line) => decodeEntities(line).replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !COUNTRY_LINE.test(line));
  if (cleaned.length === 1) return parseCommaSeparatedAddress(cleaned[0], source);
  const fromComma = cleaned[0] ? parseCommaSeparatedAddress(cleaned[0], source) : undefined;
  if (fromComma) return fromComma;
  if (cleaned.length < 2) return undefined;

  let city: string | undefined;
  let state: string | undefined;
  let postalCode: string | undefined;
  let cityIndex = -1;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    const match = parseCityStateZip(cleaned[index]);
    if (!match) continue;
    city = match.city;
    state = match.state;
    postalCode = match.postalCode;
    cityIndex = index;
    break;
  }
  const before = cityIndex >= 0 ? cleaned.slice(0, cityIndex) : cleaned;
  if (before.length === 0 && !city) return undefined;

  let name: string | undefined;
  let street = before;
  const firstIsStreet = /^\d/.test(before[0] ?? "");
  if (!firstIsStreet && before.length >= 1 && (before.length >= 2 || city)) {
    name = before[0];
    street = before.slice(1);
  }
  const line1 = street[0];
  const line2 = street.slice(1).join(" ").trim() || undefined;
  const lastLine = city && state && postalCode ? `${city}, ${state} ${postalCode}` : cleaned[cityIndex];
  const raw = [name, ...street, lastLine].filter(Boolean).join("\n");
  if (!raw) return undefined;
  return { name, line1, line2, city, state, postalCode, source, raw };
}

export function formatOrderAddress(address?: OrderAddress): string {
  if (!address) return "";
  if (address.raw.trim()) return address.raw.trim();
  const lastLine = [address.city, address.state].filter(Boolean).join(", ");
  return [address.name, address.line1, address.line2, [lastLine, address.postalCode].filter(Boolean).join(" ")]
    .filter((line) => line?.trim())
    .join("\n");
}

export function mergeOrderAddress(incoming?: OrderAddress, current?: OrderAddress): OrderAddress | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  const score = (value?: OrderAddress) =>
    [value?.line1, value?.city, value?.postalCode, value?.name].filter((part) => part?.trim()).length;
  return score(incoming) >= score(current) ? incoming : current;
}

const PAYMENT_BRAND =
  /visa|mastercard|master\s*card|american\s*express|amex|discover|redcard|red\s*card|target(?:\s+circle)?(?:\s+red)?(?:\s+card)?/i;

function parsePaymentLabel(value: string): OrderPayment | undefined {
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return undefined;
  const branded = text.match(
    new RegExp(
      `^(${PAYMENT_BRAND.source})(?:\\s+(?:card|debit|credit))*\\s*(?:\\*{1,8}|x{1,8}|ending\\s+in\\s*\\*?)\\s*(\\d{4})$`,
      "i",
    ),
  );
  if (branded?.[1] && branded[2]) {
    return { brand: branded[1].replace(/\s+/g, " ").trim(), last4: branded[2], raw: text };
  }
  const last4Only = text.match(/^(?:\*{1,8}|x{1,8}|ending\s+in)\s*(\d{4})$/i);
  if (last4Only?.[1]) return { last4: last4Only[1], raw: text };
  return undefined;
}

export function mergeOrderPayment(incoming?: OrderPayment, current?: OrderPayment): OrderPayment | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming.last4 && !current.last4) return incoming;
  if (current.last4 && !incoming.last4) return current;
  return incoming.raw.length >= current.raw.length ? incoming : current;
}

export function extractTargetOrderPayment(...parts: string[]): OrderPayment | undefined {
  const joined = parts.filter(Boolean).map(maybeDecodeQuotedPrintable);
  if (joined.length === 0) return undefined;

  for (const html of joined.filter((part) => /<[a-z][\s\S]*>/i.test(part))) {
    const scoped = scopedOrderContent(html);
    const classBlock = scoped.match(
      /class=["'][^"']*payment[^"']*["'][^>]*>([\s\S]{0,400}?)<\/(?:p|td|div|span|h[1-6]|li)>/i,
    );
    if (classBlock?.[1]) {
      const parsed = parsePaymentLabel(emailPlainText(classBlock[1]));
      if (parsed) return parsed;
    }
    const afterLabel = scoped.match(
      /payment(?:\s+method)?\s*[:\-]?\s*(?:<\/[^>]+>\s*){0,8}([^<]{3,80})/i,
    );
    if (afterLabel?.[1]) {
      const parsed = parsePaymentLabel(decodeEntities(afterLabel[1]));
      if (parsed) return parsed;
    }
  }

  const text = emailPlainText(joined.join("\n"));
  const labeled =
    text.match(/payment(?:\s+method)?\s*[:\-]?\s*([^\n]{3,80})/i) ??
    text.match(/payment(?:\s+method)?\s*[:\-]?\s*\n\s*([^\n]{3,80})/i);
  if (labeled?.[1]) {
    const parsed = parsePaymentLabel(labeled[1]);
    if (parsed) return parsed;
  }

  const standalone = text.match(
    new RegExp(
      `\\b(${PAYMENT_BRAND.source})(?:\\s+(?:card|debit|credit))*\\s*(?:\\*{1,8}|x{1,8}|ending\\s+in\\s*\\*?)\\s*(\\d{4})\\b`,
      "i",
    ),
  );
  if (standalone?.[1] && standalone[2]) {
    return parsePaymentLabel(`${standalone[1]} *${standalone[2]}`) ?? {
      brand: standalone[1].replace(/\s+/g, " ").trim(),
      last4: standalone[2],
      raw: `${standalone[1].replace(/\s+/g, " ").trim()} *${standalone[2]}`,
    };
  }
  return undefined;
}

export function extractTargetOrderAddress(...parts: string[]): OrderAddress | undefined {
  const joined = parts.filter(Boolean).map(maybeDecodeQuotedPrintable);
  if (joined.length === 0) return undefined;
  const htmlParts = joined.filter((part) => /<[a-z][\s\S]*>/i.test(part));
  for (const html of htmlParts) {
    const fromHtml = extractShippingLinesFromHtml(html);
    const parsed = fromHtml ? parseAddressLines(fromHtml, "shipping") : undefined;
    if (parsed) return parsed;
  }
  const text = joined.join("\n");
  const shipping = collectLabeledAddressLines(text, "shipping");
  const fromShipping = shipping ? parseAddressLines(shipping, "shipping") : undefined;
  if (fromShipping) return fromShipping;
  const pickup = collectLabeledAddressLines(text, "pickup");
  const fromPickup = pickup ? parseAddressLines(pickup, "pickup") : undefined;
  if (fromPickup) return fromPickup;
  const store = emailPlainText(text).match(
    /prepping your order\s+(.+?)\s+(\d+[^,\n]*,\s*[^,\n]+,\s*[A-Za-z]{2}\s+\d{5}(?:-\d{4})?)/i,
  );
  if (store?.[1] && store[2]) {
    const parsed = parseCommaSeparatedAddress(`${store[1].trim()}, ${store[2].trim()}`, "pickup");
    if (parsed) return parsed;
  }
  return undefined;
}

const POKEMON_CENTER_ADDRESS_STOP =
  /\bbilling\s+address\b|\bshipping\s+method\b|\bpayment\s+method\b|\border\s+summary\b|\bsku\s*#|\bsales\s+tax\b|\border\s+subtotal\b/i;

function isolatePaymentAndShipping(value: string): string {
  const match = value.match(/payment\s*(?:&amp;|&|and)\s*shipping[\s\S]*/i);
  return match?.[0] ?? value;
}

function sliceAfterShippingAddressLabel(value: string): string | undefined {
  const match = value.match(/\bshipping\s+address\b([\s\S]*)/i);
  if (!match?.[1]) return undefined;
  return match[1].split(POKEMON_CENTER_ADDRESS_STOP)[0] ?? "";
}

function pokemonCenterAddressLines(text: string): string[] {
  return emailPlainText(text)
    .split("\n")
    .map((line) => line.replace(/^[:\-\s]+/, "").trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !COUNTRY_LINE.test(line) &&
        !isPhoneAddressLine(line) &&
        !isAddressLabelLine(line) &&
        !/^(?:change|edit|update)$/i.test(line),
    );
}

export function extractPokemonCenterOrderAddress(...parts: string[]): OrderAddress | undefined {
  const joined = parts.filter(Boolean).map(maybeDecodeQuotedPrintable);
  if (joined.length === 0) return undefined;
  for (const part of joined) {
    const section = isolatePaymentAndShipping(part);
    const afterLabel = sliceAfterShippingAddressLabel(section);
    if (!afterLabel?.trim()) continue;
    const parsed = parseAddressLines(pokemonCenterAddressLines(afterLabel).slice(0, 8), "shipping");
    if (parsed) return parsed;
  }
  return undefined;
}

export function extractOrderShippingAddress(retailer: string, ...parts: string[]): OrderAddress | undefined {
  if (retailer === "pokemon-center") return extractPokemonCenterOrderAddress(...parts);
  if (retailer === "target") return extractTargetOrderAddress(...parts);
  return undefined;
}

export function extractOrderTotal(...parts: string[]): number | undefined {
  const text = emailPlainText(parts.filter(Boolean).join("\n"));
  const labeled =
    text.match(/order\s*total[\s\S]{0,80}?\$([\d,]+\.\d{2})/i) ??
    text.match(/grand\s*total[\s\S]{0,80}?\$([\d,]+\.\d{2})/i) ??
    text.match(/\btotal[\s\S]{0,40}?\$([\d,]+\.\d{2})/i);
  return labeled?.[1] ? parseMoney(labeled[1]) : undefined;
}

function looksLikeKnownOrderId(value: string, orderId?: string): boolean {
  if (orderId && value === orderId) return true;
  return /^10\d{13}$/.test(value) || /^91\d{13}$/.test(value) || /^P\d{8,14}$/i.test(value);
}

export function shipmentHintsFromText(
  orderId: string | undefined,
  ...parts: string[]
): {
  tracking?: string;
  carrier?: ShipmentCarrier;
  expectedDelivery?: string;
} {
  const joined = parts.filter(Boolean).join("\n");
  const text = emailPlainText(joined);
  const candidates: string[] = [];
  const add = (value?: string) => {
    const id = value?.replace(/[\s-]/g, "").toUpperCase();
    if (!id || looksLikeKnownOrderId(id, orderId) || id.length < 8 || id.length > 34) return;
    candidates.push(id);
  };

  for (const match of joined.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    add(match[0].match(/(?:trknbr|tracknumbers?|tracking(?:_?number)?|tracknum|tLabels)=([A-Z0-9-]+)/i)?.[1]);
  }
  add(text.match(/\b(1Z[A-Z0-9]{16})\b/i)?.[1]);
  for (const match of text.matchAll(/\b(9[1-5]\d{19,32})\b/g)) add(match[1]);
  for (const match of text.matchAll(/\b(96\d{18,22})\b/g)) add(match[1]);
  add(text.match(/\b(\d{15})\b/)?.[1]);
  add(text.match(/\b(\d{12})\b/)?.[1]);
  add(text.match(/tracking(?:\s*(?:number|#))?[:\s]*([A-Z0-9]{8,34})/i)?.[1]);
  add(text.match(/(?:trknbr|tracknum)=([A-Z0-9]{8,34})/i)?.[1]);

  const tracking = preferTracking(...candidates);
  return {
    tracking,
    carrier: detectCarrierFromText(joined, tracking),
    expectedDelivery: parseDeliveryDate(text),
  };
}

export function extractTrackingNumber(orderId: string | undefined, ...parts: string[]): string | undefined {
  return shipmentHintsFromText(orderId, ...parts).tracking;
}

const ITEM_SKIP =
  /^(qty|quantity|order|total|subtotal|shipping|tax|view|track|target|thanks|color|size|style|dcpi|item|price|promo|circle|guest|save|shop|http|write a review|visit order|bullseye|visa|mastercard|customer service|product image|przproduct|survey|sku|new releases)/i;

function cleanItemName(value: string): string | undefined {
  const name = decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+(?:order summary|perfect pairings).*$/i, "")
    .trim();
  if (name.length < 4 || name.length > 180) return undefined;
  if (ITEM_SKIP.test(name)) return undefined;
  if (/illustration/i.test(name) && name.length < 50) return undefined;
  if (/^\$[\d,.]+$/.test(name)) return undefined;
  if (/^\d+$/.test(name)) return undefined;
  if (/logo/i.test(name) && name.length < 40) return undefined;
  return name;
}

function addItem(items: Map<string, number>, name: string, quantity: number) {
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;
  items.set(name, Math.max(items.get(name) ?? 0, qty));
}

const QTY_PATTERN = /(?:quantity|qty\.?)\s*:?\s*(\d{1,3})/i;

function scopedOrderContent(value: string): string {
  return value.split(/perfect pairings for your order/i)[0] ?? value;
}

function inferSubtotalQuantity(text: string): number | undefined {
  const match = emailPlainText(text).match(/subtotal\s*\((\d+)\s*items?\)/i);
  const qty = match ? Number(match[1]) : NaN;
  return Number.isFinite(qty) && qty > 0 ? qty : undefined;
}

function lastProductName(html: string): string | undefined {
  const fromLinks = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => cleanItemName(match[1] ?? ""))
    .filter((name): name is string => Boolean(name));
  if (fromLinks.length > 0) return fromLinks[fromLinks.length - 1];
  const fromAlts = [...html.matchAll(/\balt="([^"]+)"/gi)]
    .map((match) => cleanItemName(match[1] ?? ""))
    .filter((name): name is string => Boolean(name));
  return fromAlts[fromAlts.length - 1];
}

function extractItemsFromHtml(html: string): Map<string, number> {
  const scoped = scopedOrderContent(html);
  const items = new Map<string, number>();

  // Target confirmation: product title link inside h2, then <p>Qty: N</p>
  const headingBlocks = scoped.matchAll(
    /<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h2>[\s\S]{0,700}?(?:quantity|qty\.?)\s*:?\s*(\d{1,3})/gi,
  );
  for (const match of headingBlocks) {
    const name = cleanItemName(match[1] ?? "");
    if (name) addItem(items, name, Number(match[2]));
  }

  if (items.size === 0) {
    const headingInner = scoped.matchAll(
      /<h2\b[^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>[\s\S]{0,700}?(?:quantity|qty\.?)\s*:?\s*(\d{1,3})/gi,
    );
    for (const match of headingInner) {
      const name = cleanItemName(match[1] ?? "");
      if (name) addItem(items, name, Number(match[2]));
    }
  }

  if (items.size === 0) {
    const altBlocks = scoped.matchAll(
      /<img\b[^>]*\balt="([^"]+)"[^>]*>[\s\S]{0,1200}?(?:quantity|qty\.?)\s*:?\s*(\d{1,3})/gi,
    );
    for (const match of altBlocks) {
      const name = cleanItemName(match[1] ?? "");
      if (name) addItem(items, name, Number(match[2]));
    }
  }

  if (items.size === 0) {
    const productLinks = scoped.matchAll(/<a\b[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,500})/gi);
    for (const match of productLinks) {
      const name = cleanItemName(match[1] ?? "");
      const rest = decodeEntities(match[2] ?? "").replace(/<[^>]+>/g, " ");
      const qtyMatch = rest.match(QTY_PATTERN);
      if (name && qtyMatch?.[1]) addItem(items, name, Number(qtyMatch[1]));
    }
  }

  if (items.size === 0) {
    const titledQty = scoped.matchAll(
      /<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/p>\s*<p\b[^>]*>\s*(?:quantity|qty\.?)\s*:?\s*(\d{1,3})/gi,
    );
    for (const match of titledQty) {
      const name = cleanItemName(match[1] ?? "");
      if (name) addItem(items, name, Number(match[2]));
    }
  }

  if (items.size === 0) {
    const blocks = scoped.matchAll(
      /PRODUCT BLOCK[\s\S]{0,80}-->([\s\S]*?)(?:<!--\s*END[\s\S]{0,40}PRODUCT BLOCK|$)/gi,
    );
    for (const match of blocks) {
      const block = match[1] ?? "";
      const name = lastProductName(block);
      const qty = Number(block.match(QTY_PATTERN)?.[1] ?? 0);
      if (name) addItem(items, name, qty || inferSubtotalQuantity(scoped) || 1);
    }
  }

  if (items.size === 0) {
    const section = scoped.split(/order summary/i)[0] ?? scoped;
    const name = lastProductName(section);
    if (name) addItem(items, name, inferSubtotalQuantity(scoped) ?? 1);
  }

  return items;
}

function extractItemsFromText(text: string): Map<string, number> {
  const items = new Map<string, number>();
  const plain = emailPlainText(scopedOrderContent(text));
  const namedQty = plain.matchAll(
    /([A-Za-z0-9][^\n]{3,160}?)\s+(?:quantity|qty\.?)\s*:?\s*(\d{1,3})(?=\s|$|\$|order summary|perfect pairings)/gi,
  );
  for (const match of namedQty) {
    const name = cleanItemName(match[1] ?? "");
    if (name) addItem(items, name, Number(match[2]));
  }
  if (items.size === 0) {
    const truncated = plain.matchAll(
      /(?:^|[\s>])([A-Z][A-Za-z0-9][^|\n]{6,90}?\.\.\.)(?:\s+(?:quantity|qty\.?)\s*:?\s*(\d{1,3}))?(?=\s+(?:order summary|perfect pairings))/gi,
    );
    for (const match of truncated) {
      const name = cleanItemName(match[1] ?? "");
      const labeled = match[2] ? Number(match[2]) : 0;
      if (name) addItem(items, name, labeled || inferSubtotalQuantity(plain) || 1);
    }
  }
  return items;
}

export function extractPokemonCenterItems(...parts: string[]): { name: string; quantity: number; price?: number }[] {
  const plain = emailPlainText(parts.filter(Boolean).map(maybeDecodeQuotedPrintable).join("\n"));
  if (!/sku\s*#/i.test(plain)) return [];
  let scoped = plain;
  const start = plain.search(/order summary/i);
  if (start >= 0) scoped = plain.slice(start);
  const end = scoped.search(/\border subtotal\b|\bsales tax\b|\bnew releases\b/i);
  if (end > 0) scoped = scoped.slice(0, end);
  scoped = scoped.replace(/^order summary\s*/i, "").trim();

  const items: { name: string; quantity: number; price?: number }[] = [];
  const skuLine =
    /SKU\s*#?\s*:?\s*[\d][\d-]{4,18}\s+Qty\s*:?\s*\d{1,3}(?:\s+Price\s*:?\s*\$[\d,.]+)?/gi;
  let cursor = 0;
  for (const match of scoped.matchAll(skuLine)) {
    const index = match.index ?? 0;
    const name = cleanItemName(scoped.slice(cursor, index));
    cursor = index + match[0].length;
    const qty = Number(match[0].match(/Qty\s*:?\s*(\d{1,3})/i)?.[1] ?? 0);
    const priceRaw = match[0].match(/Price\s*:?\s*\$([\d,.]+)/i)?.[1];
    const price = priceRaw ? Number(priceRaw.replace(/,/g, "")) : undefined;
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    items.push({
      name,
      quantity: qty,
      price: price != null && Number.isFinite(price) ? price : undefined,
    });
  }
  return items;
}

/** Prefer HTML when present so text+html are not double-counted. */
export function extractOrderItems(...parts: string[]): { name: string; quantity: number; price?: number }[] {
  const joined = parts.filter(Boolean).map(maybeDecodeQuotedPrintable);
  if (joined.length === 0) return [];
  const pokemon = extractPokemonCenterItems(...joined);
  if (pokemon.length > 0) return pokemon;

  const htmlParts = joined.filter((part) => /<[a-z][\s\S]*>/i.test(part));
  const textParts = joined.filter((part) => !/<[a-z][\s\S]*>/i.test(part));

  let items = new Map<string, number>();
  if (htmlParts.length > 0) {
    items = extractItemsFromHtml(htmlParts.join("\n"));
  }
  if (items.size === 0 && textParts.length > 0) {
    items = extractItemsFromText(textParts.join("\n"));
  }
  if (items.size === 0 && htmlParts.length > 0) {
    items = extractItemsFromText(htmlParts.join("\n"));
  }

  return [...items.entries()].map(([name, quantity]) => ({ name, quantity }));
}

function itemNameKey(name: string): string {
  return name.replace(/\.\.\.\s*$/, "").trim().toLowerCase();
}

export function itemsLookIncomplete(items?: { name: string; quantity: number }[]): boolean {
  if (!items?.length) return true;
  return items.some((item) => /\.\.\.\s*$/.test(item.name));
}

export function mergeOrderItems(
  current: { name: string; quantity: number; price?: number }[] | undefined,
  incoming: { name: string; quantity: number; price?: number }[],
): { name: string; quantity: number; price?: number }[] | undefined {
  if (incoming.length === 0) return current && current.length > 0 ? current : undefined;
  if (!current?.length) return incoming;
  const next = current.map((item) => ({ ...item }));
  for (const item of incoming) {
    const incomingKey = itemNameKey(item.name);
    const index = next.findIndex((existing) => {
      const existingKey = itemNameKey(existing.name);
      return existingKey.startsWith(incomingKey) || incomingKey.startsWith(existingKey);
    });
    if (index < 0) {
      next.push({ ...item });
      continue;
    }
    const existing = next[index];
    next[index] = {
      name: item.name.length > existing.name.length ? item.name : existing.name,
      quantity: Math.max(existing.quantity, item.quantity),
      price: item.price ?? existing.price,
    };
  }
  return next;
}

export function orderTableItem(order: {
  retailer?: string;
  items?: { name: string; quantity: number; price?: number }[];
}): { name: string; quantity: number } | undefined {
  const items = order.items ?? [];
  if (items.length === 0) return undefined;
  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
  if (order.retailer !== "pokemon-center" || items.length === 1) {
    return items.length === 1 ? { name: items[0].name, quantity: items[0].quantity } : undefined;
  }
  const ranked = [...items].sort((left, right) => {
    const leftPrice = left.price ?? 0;
    const rightPrice = right.price ?? 0;
    if (rightPrice !== leftPrice) return rightPrice - leftPrice;
    return rightPrice * right.quantity - leftPrice * left.quantity;
  });
  return { name: ranked[0].name, quantity: totalQty };
}
