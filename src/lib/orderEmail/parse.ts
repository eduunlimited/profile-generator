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
  const decoded = decodeEntities(htmlOrText);
  return decoded
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

function parseMoney(raw: string): number | undefined {
  const amount = Number(raw.replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

export function extractOrderTotal(...parts: string[]): number | undefined {
  const text = emailPlainText(parts.filter(Boolean).join("\n"));
  const labeled =
    text.match(/order\s*total[\s\S]{0,80}?\$([\d,]+\.\d{2})/i) ??
    text.match(/grand\s*total[\s\S]{0,80}?\$([\d,]+\.\d{2})/i) ??
    text.match(/\btotal[\s\S]{0,40}?\$([\d,]+\.\d{2})/i);
  return labeled?.[1] ? parseMoney(labeled[1]) : undefined;
}

function looksLikeTargetOrderId(value: string, orderId?: string): boolean {
  if (orderId && value === orderId) return true;
  return /^10\d{13}$/.test(value) || /^91\d{13}$/.test(value);
}

export function extractTrackingNumber(orderId: string | undefined, ...parts: string[]): string | undefined {
  const text = emailPlainText(parts.filter(Boolean).join("\n"));
  const labeled = text.match(/tracking(?:\s*(?:number|#))?[:\s]*([A-Z0-9]{8,32})/i)?.[1];
  if (labeled && !looksLikeTargetOrderId(labeled, orderId)) return labeled.toUpperCase();
  const fromUrl = text.match(/(?:trknbr|tracking(?:_?number)?|tracknum)=([A-Z0-9]{8,32})/i)?.[1];
  if (fromUrl && !looksLikeTargetOrderId(fromUrl, orderId)) return fromUrl.toUpperCase();
  const ups = text.match(/\b(1Z[A-Z0-9]{16})\b/i)?.[1];
  return ups ? ups.toUpperCase() : undefined;
}

const ITEM_SKIP =
  /^(qty|quantity|order|total|subtotal|shipping|tax|view|track|target|thanks|color|size|style|dcpi|item|price|promo|circle|guest|save|shop|http|write a review|visit order|bullseye|visa|mastercard|customer service)/i;

function cleanItemName(value: string): string | undefined {
  const name = decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 4 || name.length > 180) return undefined;
  if (ITEM_SKIP.test(name)) return undefined;
  if (/^\$[\d,.]+$/.test(name)) return undefined;
  if (/^\d+$/.test(name)) return undefined;
  if (/logo/i.test(name) && name.length < 40) return undefined;
  return name;
}

function addItem(items: Map<string, number>, name: string, quantity: number) {
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;
  items.set(name, Math.max(items.get(name) ?? 0, qty));
}

const QTY_PATTERN = /qty\.?\s*:?\s*(\d{1,3})/i;

function extractItemsFromHtml(html: string): Map<string, number> {
  const items = new Map<string, number>();

  // Target confirmation: product title link inside h2, then <p>Qty: N</p>
  const headingBlocks = html.matchAll(
    /<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h2>[\s\S]{0,700}?qty\.?\s*:?\s*(\d{1,3})/gi,
  );
  for (const match of headingBlocks) {
    const name = cleanItemName(match[1] ?? "");
    if (name) addItem(items, name, Number(match[2]));
  }

  if (items.size === 0) {
    const headingInner = html.matchAll(
      /<h2\b[^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>[\s\S]{0,700}?qty\.?\s*:?\s*(\d{1,3})/gi,
    );
    for (const match of headingInner) {
      const name = cleanItemName(match[1] ?? "");
      if (name) addItem(items, name, Number(match[2]));
    }
  }

  if (items.size === 0) {
    const altBlocks = html.matchAll(
      /<img\b[^>]*\balt="([^"]+)"[^>]*>[\s\S]{0,1200}?qty\.?\s*:?\s*(\d{1,3})/gi,
    );
    for (const match of altBlocks) {
      const name = cleanItemName(match[1] ?? "");
      if (name) addItem(items, name, Number(match[2]));
    }
  }

  if (items.size === 0) {
    const productLinks = html.matchAll(/<a\b[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,500})/gi);
    for (const match of productLinks) {
      const name = cleanItemName(match[1] ?? "");
      const rest = decodeEntities(match[2] ?? "").replace(/<[^>]+>/g, " ");
      const qtyMatch = rest.match(QTY_PATTERN);
      if (name && qtyMatch?.[1]) addItem(items, name, Number(qtyMatch[1]));
    }
  }

  return items;
}

function extractItemsFromText(text: string): Map<string, number> {
  const items = new Map<string, number>();
  const plain = emailPlainText(text);
  // Name on one line / block, then Qty: N (Target plain-text part)
  const namedQty = plain.matchAll(
    /([A-Za-z0-9][^\n]{3,160}?)\s+qty\.?\s*:?\s*(\d{1,3})(?=\s|$|\$)/gi,
  );
  for (const match of namedQty) {
    const name = cleanItemName(match[1] ?? "");
    if (name) addItem(items, name, Number(match[2]));
  }
  return items;
}

/** Prefer HTML when present so text+html are not double-counted. */
export function extractOrderItems(...parts: string[]): { name: string; quantity: number }[] {
  const joined = parts.filter(Boolean);
  if (joined.length === 0) return [];

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
