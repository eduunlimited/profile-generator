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

export function extractTrackingNumber(orderId: string | undefined, ...parts: string[]): string | undefined {
  const text = emailPlainText(parts.filter(Boolean).join("\n"));
  const labeled = text.match(/tracking(?:\s*(?:number|#))?[:\s]*([A-Z0-9]{8,32})/i)?.[1];
  if (labeled && !looksLikeKnownOrderId(labeled, orderId)) return labeled.toUpperCase();
  const fromUrl = text.match(/(?:trknbr|tracking(?:_?number)?|tracknum)=([A-Z0-9]{8,32})/i)?.[1];
  if (fromUrl && !looksLikeKnownOrderId(fromUrl, orderId)) return fromUrl.toUpperCase();
  const ups = text.match(/\b(1Z[A-Z0-9]{16})\b/i)?.[1];
  return ups ? ups.toUpperCase() : undefined;
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
