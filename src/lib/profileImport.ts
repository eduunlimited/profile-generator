import { formatAddress } from "./jigEngine";
import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "./profileCategoryUtils";
import { formatCardExpiry, normalizeImportBrandLabel } from "./creditCardUtils";
import { normalizeUsPhone } from "./phoneUtils";
import type { Profile, ProfileAddress } from "./types";

export type ProfileImportFormat = "json" | "csv";

export interface StellarAddressImport {
  firstName: string;
  lastName: string;
  country: string;
  address: string;
  address2?: string;
  state: string;
  city: string;
  zipcode: string;
}

export interface StellarAioImportItem {
  profileName: string;
  email: string;
  phone: string;
  shipping: StellarAddressImport;
  billing: StellarAddressImport;
  billingAsShipping?: boolean;
  payment: {
    cardName: string;
    cardType: string;
    cardNumber: string;
    cardMonth: string;
    cardYear: string;
    cardCvv: string;
  };
  oneCheckoutPerProfile?: boolean;
}

export interface ProfileImportOptions {
  masterProfileId: string;
  categoryId?: string;
}

function fromStellarCountry(code: string): string {
  const value = code.trim();
  if (!value) return "United States";
  const upper = value.toUpperCase();
  if (upper === "US" || upper === "USA") return "United States";
  if (upper === "GB" || upper === "UK") return "United Kingdom";
  if (upper === "CA") return "Canada";
  return value;
}

function normalizeRecordKey(key: string): string {
  return key.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function buildRecord(headers: string[], cells: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[normalizeRecordKey(header)] = cells[index]?.trim() ?? "";
  });
  return record;
}

function recordValue(record: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[normalizeRecordKey(key)];
    if (value?.trim()) return value.trim();
  }
  return "";
}

function stellarAddressFromRecord(
  record: Record<string, string>,
  prefix: "SHIPPING" | "BILLING",
): StellarAddressImport {
  return {
    firstName: recordValue(record, `${prefix}_FIRST_NAME`),
    lastName: recordValue(record, `${prefix}_LAST_NAME`),
    country: recordValue(record, `${prefix}_COUNTRY`) || "US",
    address: recordValue(record, `${prefix}_ADDRESS`),
    address2: recordValue(record, `${prefix}_ADDRESS_2`) || undefined,
    city: recordValue(record, `${prefix}_CITY`),
    state: recordValue(record, `${prefix}_STATE`),
    zipcode: recordValue(record, `${prefix}_ZIP`, `${prefix}_POSTAL_CODE`),
  };
}

function csvRecordToStellarItem(record: Record<string, string>): StellarAioImportItem | null {
  const profileName = recordValue(record, "PROFILE_NAME");
  const email = recordValue(record, "EMAIL");
  if (!profileName && !email) return null;

  const billing = stellarAddressFromRecord(record, "BILLING");
  const shipping = stellarAddressFromRecord(record, "SHIPPING");
  const billingSame = recordValue(record, "BILLING_SAME_AS_SHIPPING").toUpperCase();

  return {
    profileName: profileName || email,
    email,
    phone: normalizeUsPhone(recordValue(record, "PHONE")),
    shipping: shipping.address ? shipping : billing,
    billing: billing.address ? billing : shipping,
    billingAsShipping: billingSame !== "FALSE" && billingSame !== "0" && billingSame !== "NO",
    payment: {
      cardName: recordValue(record, "CARD_HOLDER_NAME"),
      cardType: recordValue(record, "CARD_TYPE"),
      cardNumber: recordValue(record, "CARD_NUMBER"),
      cardMonth: recordValue(record, "CARD_MONTH"),
      cardYear: recordValue(record, "CARD_YEAR"),
      cardCvv: recordValue(record, "CARD_CVV"),
    },
    oneCheckoutPerProfile: recordValue(record, "ONE_CHECKOUT_PER_PROFILE").toUpperCase() === "TRUE",
  };
}

function normalizeStellarAddress(value: unknown): StellarAddressImport | null {
  if (!value || typeof value !== "object") return null;
  const address = value as Record<string, unknown>;
  const street = String(address.address ?? address.street ?? "").trim();
  if (!street) return null;
  return {
    firstName: String(address.firstName ?? address.first ?? "").trim(),
    lastName: String(address.lastName ?? address.last ?? "").trim(),
    country: String(address.country ?? "US").trim() || "US",
    address: street,
    address2: String(address.address2 ?? address.unit ?? "").trim() || undefined,
    city: String(address.city ?? "").trim(),
    state: String(address.state ?? "").trim(),
    zipcode: String(address.zipcode ?? address.postalCode ?? address.zip ?? "").trim(),
  };
}

function normalizeStellarItem(value: unknown): StellarAioImportItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const profileName = String(item.profileName ?? item.name ?? "").trim();
  const email = String(item.email ?? "").trim();
  if (!profileName && !email) return null;

  const billing = normalizeStellarAddress(item.billing);
  const shipping = normalizeStellarAddress(item.shipping);
  const resolvedBilling = billing ?? shipping;
  const resolvedShipping = shipping ?? billing;
  if (!resolvedBilling || !resolvedShipping) return null;

  const paymentRaw = item.payment && typeof item.payment === "object" ? (item.payment as Record<string, unknown>) : {};
  const paymentDetails =
    item.paymentDetails && typeof item.paymentDetails === "object"
      ? (item.paymentDetails as Record<string, unknown>)
      : {};

  return {
    profileName: profileName || email,
    email,
    phone: normalizeUsPhone(String(item.phone ?? "")),
    shipping: resolvedShipping,
    billing: resolvedBilling,
    billingAsShipping: item.billingAsShipping !== false,
    payment: {
      cardName: String(
        paymentRaw.cardName ?? paymentDetails.nameOnCard ?? `${resolvedBilling.firstName} ${resolvedBilling.lastName}`,
      ).trim(),
      cardType: String(paymentRaw.cardType ?? paymentDetails.cardType ?? "").trim(),
      cardNumber: String(paymentRaw.cardNumber ?? paymentDetails.cardNumber ?? "").trim(),
      cardMonth: String(paymentRaw.cardMonth ?? paymentDetails.cardExpMonth ?? "").trim(),
      cardYear: String(paymentRaw.cardYear ?? paymentDetails.cardExpYear ?? "").trim(),
      cardCvv: String(paymentRaw.cardCvv ?? paymentDetails.cardCvv ?? "").trim(),
    },
    oneCheckoutPerProfile: item.oneCheckoutPerProfile === true,
  };
}

export function detectProfileImportFormat(text: string): "empty" | ProfileImportFormat {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  return "csv";
}

function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  const semicolonCount = (headerLine.match(/;/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  if (semicolonCount >= commaCount && semicolonCount >= tabCount && semicolonCount > 0) return ";";
  if (tabCount > commaCount && tabCount > 0) return "\t";
  return ",";
}

export function parseDelimitedRow(line: string, delimiter: "," | ";" | "\t"): string[] {
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
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function getImportLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function parseStellarAioJson(text: string): { items: StellarAioImportItem[]; errors: string[] } {
  try {
    const parsed = JSON.parse(text) as unknown;
    const rawItems = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { profiles?: unknown }).profiles)
        ? (parsed as { profiles: unknown[] }).profiles
        : null;

    if (!rawItems) {
      return { items: [], errors: ["Import JSON must be an array of profiles or an object with a profiles array."] };
    }

    const items: StellarAioImportItem[] = [];
    const errors: string[] = [];
    rawItems.forEach((entry, index) => {
      const item = normalizeStellarItem(entry);
      if (item) {
        items.push(item);
        return;
      }
      errors.push(`Profile ${index + 1}: missing billing/shipping address or profile name.`);
    });

    if (items.length === 0 && errors.length === 0) {
      errors.push("No profiles found in JSON.");
    }

    return { items, errors };
  } catch {
    return { items: [], errors: ["Invalid JSON. Paste a Stellar AIO profile export array."] };
  }
}

export function parseStellarAioCsv(text: string): { items: StellarAioImportItem[]; errors: string[] } {
  const lines = getImportLines(text);
  if (lines.length === 0) {
    return { items: [], errors: ["CSV is empty."] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedRow(lines[0], delimiter);
  const items: StellarAioImportItem[] = [];
  const errors: string[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const cells = parseDelimitedRow(lines[index], delimiter);
    if (cells.every((cell) => !cell.trim())) continue;
    const record = buildRecord(headers, cells);
    const item = csvRecordToStellarItem(record);
    if (item) {
      items.push(item);
      continue;
    }
    errors.push(`Row ${index + 1}: missing profile name or email.`);
  }

  if (items.length === 0 && errors.length === 0) {
    errors.push("No profile rows found in CSV.");
  }

  return { items, errors };
}

export function parseProfileImportText(
  text: string,
  format: ProfileImportFormat,
): { items: StellarAioImportItem[]; errors: string[] } {
  if (!text.trim()) {
    return { items: [], errors: ["Paste JSON or CSV data, or upload a file."] };
  }
  return format === "json" ? parseStellarAioJson(text) : parseStellarAioCsv(text);
}

export async function readProfileImportFile(
  file: File,
): Promise<{ text: string; format: ProfileImportFormat; fileName: string } | { error: string }> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".json")) {
    return { text: await file.text(), format: "json", fileName: file.name };
  }
  if (lowerName.endsWith(".csv")) {
    return { text: await file.text(), format: "csv", fileName: file.name };
  }
  return { error: "Upload a .csv or .json file." };
}

function buildAddressFromStellar(address: StellarAddressImport): ProfileAddress {
  const next: ProfileAddress = {
    street: address.address,
    unit: address.address2 || undefined,
    city: address.city,
    state: address.state,
    postalCode: address.zipcode,
    country: fromStellarCountry(address.country),
  };
  const formatted = formatAddress(next);
  return {
    ...next,
    formatted,
    jig: formatted,
  };
}

export function buildImportedProfiles(
  items: StellarAioImportItem[],
  options: ProfileImportOptions,
): { profiles: Profile[]; errors: string[] } {
  const now = new Date().toISOString();
  const categoryId = options.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID;
  const masterProfileId = options.masterProfileId?.trim();
  if (!masterProfileId) {
    return { profiles: [], errors: ["A master profile is required to import jig profiles."] };
  }
  const profiles: Profile[] = [];
  const errors: string[] = [];

  items.forEach((item, index) => {
    if (!item.email.trim()) {
      errors.push(`Profile ${index + 1}: email is required.`);
      return;
    }

    const billing = item.billing;
    const billingSame = item.billingAsShipping !== false;
    const shipping = billingSame ? billing : item.shipping;
    const jigFullName =
      item.payment.cardName.trim() || `${billing.firstName} ${billing.lastName}`.trim() || item.profileName.trim();
    const shippingFullName = `${shipping.firstName} ${shipping.lastName}`.trim();

    profiles.push({
      id: crypto.randomUUID(),
      locale: "en_US",
      email: item.email.trim(),
      masterProfileId,
      generatedFromMaster: true,
      profileName: item.profileName.trim() || `Imported profile ${index + 1}`,
      phone: normalizeUsPhone(item.phone),
      categoryId,
      accountStatus: "good",
      notes: "",
      jigPresetName: "Imported (Stellar AIO)",
      name: {
        first: billing.firstName,
        last: billing.lastName,
        full: jigFullName,
        jig: jigFullName,
      },
      address: buildAddressFromStellar(billing),
      shippingName: billingSame
        ? undefined
        : {
            first: shipping.firstName,
            last: shipping.lastName,
            full: shippingFullName,
          },
      shippingAddress: billingSame ? undefined : buildAddressFromStellar(shipping),
      billingSameAsShipping: billingSame,
      cardHolderSameAsShipping: true,
      cardHolderName: shippingFullName || item.payment.cardName.trim(),
      oneCheckoutPerProfile: item.oneCheckoutPerProfile !== false,
      payment: {
        number: item.payment.cardNumber,
        expiry: formatCardExpiry(item.payment.cardMonth, item.payment.cardYear),
        cvv: item.payment.cardCvv,
        brand: normalizeImportBrandLabel(item.payment.cardType, item.payment.cardNumber),
      },
      credentialIds: [],
      logins: [],
      createdAt: now,
      updatedAt: now,
    });
  });

  return { profiles, errors };
}
