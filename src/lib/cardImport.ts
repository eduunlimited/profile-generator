import type { AccountReviewStatus, CardCategory } from "./types";
import { CARD_UNCATEGORIZED_CATEGORY_ID } from "./cardCategoryUtils";
import { formatCardExpiry, normalizeImportBrandLabel, normalizeCardExpiryString } from "./creditCardUtils";

export interface CardImportItem {
  profileName?: string;
  label?: string;
  number?: string;
  expiry?: string;
  expiryMonth?: string;
  expiryYear?: string;
  cvv?: string;
  brand?: string;
  cardType?: string;
  categoryId?: string;
  categoryName?: string;
  accountStatus?: AccountReviewStatus;
  notes?: string;
}

export type CardImportField =
  | "profileName"
  | "number"
  | "expiryMonth"
  | "expiryYear"
  | "expiry"
  | "cvv"
  | "brand"
  | "categoryId"
  | "accountStatus"
  | "notes";

export type CardImportFormat = "json" | "csv";

export type CardImportColumnMapping = Array<CardImportField | "">;

export const CARD_IMPORT_REQUIRED_FIELDS: CardImportField[] = ["number"];

export const CARD_IMPORT_FIELD_OPTIONS: Array<{ value: CardImportField; label: string; required?: boolean }> = [
  { value: "profileName", label: "Card name" },
  { value: "number", label: "Number", required: true },
  { value: "expiryMonth", label: "Expiration month" },
  { value: "expiryYear", label: "Expiration year" },
  { value: "expiry", label: "Expiration (MM/YYYY)" },
  { value: "cvv", label: "CVV" },
  { value: "brand", label: "Card type" },
  { value: "categoryId", label: "Category" },
  { value: "accountStatus", label: "Status" },
  { value: "notes", label: "Notes" },
];

const HEADER_ALIASES: Record<string, CardImportField> = {
  profilename: "profileName",
  name: "profileName",
  cardname: "profileName",
  "card name": "profileName",
  label: "profileName",
  number: "number",
  cardnumber: "number",
  "card number": "number",
  expmonth: "expiryMonth",
  "exp month": "expiryMonth",
  expirationmonth: "expiryMonth",
  "expiration month": "expiryMonth",
  month: "expiryMonth",
  expyear: "expiryYear",
  "exp year": "expiryYear",
  expirationyear: "expiryYear",
  "expiration year": "expiryYear",
  year: "expiryYear",
  expiry: "expiry",
  exp: "expiry",
  expiration: "expiry",
  cvv: "cvv",
  cvc: "cvv",
  brand: "brand",
  cardtype: "brand",
  "card type": "brand",
  type: "brand",
  network: "brand",
  "card network": "brand",
  "card brand": "brand",
  category: "categoryId",
  categoryid: "categoryId",
  categoryname: "categoryId",
  "category name": "categoryId",
  status: "accountStatus",
  accountstatus: "accountStatus",
  notes: "notes",
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function normalizeImportStatus(value: string | undefined): AccountReviewStatus | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "notgood" || normalized === "bad" || normalized === "no") {
    return "not_good";
  }
  if (normalized === "good" || normalized === "yes" || normalized === "ok") {
    return "good";
  }
  return undefined;
}

function parseJsonItems(value: unknown): CardImportItem[] {
  if (Array.isArray(value)) {
    return value as CardImportItem[];
  }
  if (value && typeof value === "object" && Array.isArray((value as { cards?: unknown }).cards)) {
    return (value as { cards: CardImportItem[] }).cards;
  }
  throw new Error("Import JSON must be an array of cards or an object with a cards array.");
}

export function detectCardImportFormat(text: string): "empty" | "json" | "csv" {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  return "csv";
}

export function parseCardImportJson(text: string): { items: CardImportItem[]; errors: string[] } {
  try {
    const parsed = JSON.parse(text) as unknown;
    return { items: parseJsonItems(parsed), errors: [] };
  } catch {
    return { items: [], errors: ["Invalid JSON. Paste an array of card objects."] };
  }
}

export function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function getCsvLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function getCsvHeaders(text: string): string[] | null {
  const rows = getCsvLines(text);
  if (rows.length === 0) return null;
  return parseCsvRow(rows[0]);
}

export async function readCsvImportFile(
  file: File,
): Promise<{ text: string; headers: string[]; fileName: string } | { error: string }> {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { error: "Upload a .csv file." };
  }

  const text = await file.text();
  const headers = getCsvHeaders(text);
  if (!headers?.length) {
    return { error: "CSV must include a header row." };
  }

  return { text, headers, fileName: file.name };
}

export function guessCardImportColumnMapping(headers: string[]): CardImportColumnMapping {
  const used = new Set<CardImportField>();

  return headers.map((header) => {
    const mapped = HEADER_ALIASES[normalizeHeader(header)];
    if (!mapped || used.has(mapped)) {
      return "";
    }
    used.add(mapped);
    return mapped;
  });
}

function mapCsvRow(mapping: CardImportColumnMapping, cells: string[]): CardImportItem {
  const item: CardImportItem = {};

  mapping.forEach((field, index) => {
    if (!field) return;
    const value = cells[index]?.trim() ?? "";
    if (!value) return;

    if (field === "accountStatus") {
      item.accountStatus = normalizeImportStatus(value);
      return;
    }

    if (field === "categoryId") {
      item.categoryName = value;
      return;
    }

    item[field] = value;
  });

  return item;
}

function mappingFromHeaders(headers: string[]): CardImportColumnMapping {
  return headers.map((header) => HEADER_ALIASES[normalizeHeader(header)] ?? "");
}

export function parseCardImportCsv(
  text: string,
  columnMapping?: CardImportColumnMapping,
): { items: CardImportItem[]; errors: string[] } {
  const errors: string[] = [];
  const rows = getCsvLines(text);

  if (rows.length === 0) {
    return { items: [], errors: ["CSV is empty."] };
  }

  const headerCells = parseCsvRow(rows[0]);
  const mapping = columnMapping ?? mappingFromHeaders(headerCells);

  if (mapping.length !== headerCells.length) {
    errors.push("Column mapping does not match CSV headers.");
    return { items: [], errors };
  }

  if (!mapping.some((field) => field === "number")) {
    errors.push('Map at least one CSV column to "Number".');
  }

  const items: CardImportItem[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = parseCsvRow(rows[index]);
    if (cells.every((cell) => !cell.trim())) {
      continue;
    }
    const item = mapCsvRow(mapping, cells);
    if (!item.number?.trim()) {
      errors.push(`Row ${index + 1}: number is required.`);
      continue;
    }
    items.push(item);
  }

  if (items.length === 0 && errors.length === 0) {
    errors.push("No card rows found in CSV.");
  }

  return { items, errors };
}

export function parseCardImportText(
  text: string,
  columnMapping?: CardImportColumnMapping,
): { items: CardImportItem[]; errors: string[] } {
  const format = detectCardImportFormat(text);
  if (format === "empty") {
    return { items: [], errors: ["Paste JSON or CSV data to import."] };
  }
  if (format === "json") {
    return parseCardImportJson(text);
  }
  return parseCardImportCsv(text, columnMapping);
}

function buildImportExpiry(item: CardImportItem): string {
  if (item.expiryMonth || item.expiryYear) {
    return formatCardExpiry(String(item.expiryMonth ?? ""), String(item.expiryYear ?? ""));
  }
  if (item.expiry?.trim()) {
    return normalizeCardExpiryString(item.expiry);
  }
  return "";
}

export type ImportCategoryLookup = Map<string, string>;

export function buildImportCategoryLookup(categories: CardCategory[]): ImportCategoryLookup {
  const lookup: ImportCategoryLookup = new Map();
  lookup.set("uncategorized", CARD_UNCATEGORIZED_CATEGORY_ID);

  for (const category of categories) {
    lookup.set(category.name.toLowerCase(), category.id);
    lookup.set(category.id, category.id);
  }

  return lookup;
}

export async function ensureImportCategories(
  items: CardImportItem[],
  categories: CardCategory[],
  createCategory: (name: string) => Promise<CardCategory>,
): Promise<ImportCategoryLookup> {
  const lookup = buildImportCategoryLookup(categories);
  const pendingNames = new Map<string, string>();

  for (const item of items) {
    const rawValue = item.categoryId?.trim() || item.categoryName?.trim();
    if (!rawValue) continue;

    const normalized = rawValue.toLowerCase();
    if (normalized === "uncategorized") continue;
    if (lookup.has(normalized)) continue;
    if (categories.some((category) => category.id === rawValue)) {
      lookup.set(normalized, rawValue);
      continue;
    }

    if (!pendingNames.has(normalized)) {
      pendingNames.set(normalized, rawValue);
    }
  }

  for (const name of pendingNames.values()) {
    const created = await createCategory(name);
    lookup.set(name.toLowerCase(), created.id);
    lookup.set(created.id, created.id);
  }

  return lookup;
}

function resolveImportCategoryId(
  item: CardImportItem,
  categoryLookup: ImportCategoryLookup,
  fallbackCategoryId: string,
): string {
  const rawValue = item.categoryId?.trim() || item.categoryName?.trim();
  if (!rawValue) {
    return fallbackCategoryId;
  }

  const normalized = rawValue.toLowerCase();
  if (normalized === "uncategorized") {
    return CARD_UNCATEGORIZED_CATEGORY_ID;
  }

  return categoryLookup.get(normalized) ?? categoryLookup.get(rawValue) ?? fallbackCategoryId;
}

export function buildImportedCreditCards(
  items: CardImportItem[],
  categoryLookup: ImportCategoryLookup,
  fallbackCategoryId: string,
): { cards: import("./types").CreditCard[]; errors: string[] } {
  const now = new Date().toISOString();
  const errors: string[] = [];
  const cards: import("./types").CreditCard[] = [];

  items.forEach((item, index) => {
    if (!item.number?.trim()) {
      errors.push(`Row ${index + 1}: number is required.`);
      return;
    }

    cards.push({
      id: crypto.randomUUID(),
      profileName: item.profileName?.trim() || item.label?.trim() || `Card profile ${index + 1}`,
      number: item.number ?? "",
      expiry: buildImportExpiry(item),
      cvv: item.cvv ?? "",
      brand: normalizeImportBrandLabel(item.brand ?? item.cardType, item.number),
      categoryId: resolveImportCategoryId(item, categoryLookup, fallbackCategoryId),
      accountStatus: item.accountStatus === "not_good" ? "not_good" : "good",
      notes: item.notes?.trim() ?? "",
      createdAt: now,
    });
  });

  return { cards, errors };
}
