import type { AccountReviewStatus, CardAssignmentScope, CreditCard, Profile, ProfilePayment, ProfileSummary } from "./types";
import { CARD_UNCATEGORIZED_CATEGORY_ID } from "./cardCategoryUtils";

export type CardBrandKind = "visa" | "mastercard" | "amex" | "discover" | "unknown";

export function normalizeCardBrand(brand: string): CardBrandKind {
  const value = brand.trim().toLowerCase();
  if (value.includes("visa")) return "visa";
  if (value.includes("master")) return "mastercard";
  if (value.includes("amex") || value.includes("american express")) return "amex";
  if (value.includes("discover")) return "discover";
  return "unknown";
}

export function parseCardNumberDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function profileHasPaymentCard(
  profile: Pick<Profile, "creditCardId" | "payment">,
): boolean {
  if (profile.creditCardId) {
    return true;
  }
  return parseCardNumberDigits(profile.payment.number).length > 0;
}

export function profileSummaryHasPaymentCard(
  profile: Pick<ProfileSummary, "creditCardId" | "paymentNumber" | "creditCardLabel">,
): boolean {
  if (profile.creditCardId) {
    return true;
  }
  if (profile.paymentNumber && profile.paymentNumber.length > 0) {
    return true;
  }
  return Boolean(profile.creditCardLabel?.trim());
}

function isAmexNumber(value: string, brand?: string): boolean {
  if (brand && normalizeCardBrand(brand) === "amex") {
    return true;
  }
  return /^3[47]/.test(parseCardNumberDigits(value));
}

function formatAmexNumberGroups(digits: string): string {
  if (!digits) return "";
  const parts = [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean);
  return parts.join(" ");
}

function formatStandardNumberGroups(digits: string): string {
  if (!digits) return "";
  return digits.match(/.{1,4}/g)?.join(" ") ?? digits;
}

/** Display card number with brand-specific spacing. */
export function formatCardNumberDisplay(value: string, brand?: string): string {
  const digits = parseCardNumberDigits(value);
  if (!digits) return "";
  return isAmexNumber(value, brand) ? formatAmexNumberGroups(digits) : formatStandardNumberGroups(digits);
}

/** Mask card number, showing only the last 4 digits. */
export function maskCardNumberDisplay(value: string, brand?: string): string {
  const digits = parseCardNumberDigits(value);
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  const masked = `${"X".repeat(digits.length - 4)}${digits.slice(-4)}`;
  return isAmexNumber(value, brand) ? formatAmexNumberGroups(masked) : formatStandardNumberGroups(masked);
}

/** Format user input as they type using brand-specific grouping. */
export function formatCardNumberInput(value: string, brand?: string): string {
  const digits = parseCardNumberDigits(value);
  const resolvedBrand = brand ?? detectCardBrand(digits);
  const maxLength = normalizeCardBrand(resolvedBrand) === "amex" ? 15 : 19;
  const trimmed = digits.slice(0, maxLength);
  return formatCardNumberDisplay(trimmed, resolvedBrand);
}

export function detectCardBrand(number: string): string {
  const digits = parseCardNumberDigits(number);
  if (/^4/.test(digits)) return "Visa";
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (/^6(?:011|5)/.test(digits)) return "Discover";
  return "Visa";
}

export function expandExpiryYearToFourDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 4) return digits.slice(0, 4);
  if (digits.length === 2) return `20${digits.padStart(2, "0")}`;
  return digits;
}

function expiryDigitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function isValidMonthDigits(digits: string): boolean {
  if (!digits || digits.length > 2) return false;
  const month = Number(digits);
  return month >= 1 && month <= 12;
}

export function parseCardExpiry(expiry: string): { month: string; year: string } {
  const trimmed = expiry.trim();
  if (!trimmed) {
    return { month: "", year: "" };
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\s*\/\s*(\d{1,4})$/);
  if (slashMatch) {
    const monthRaw = slashMatch[1];
    return {
      month: monthRaw.length === 1 ? monthRaw : normalizeExpiryMonth(monthRaw),
      year: normalizeExpiryYear(slashMatch[2]),
    };
  }

  const digits = expiryDigitsOnly(trimmed);
  if (!digits) {
    return { month: "", year: "" };
  }

  if (digits.length >= 5) {
    return {
      month: normalizeExpiryMonth(digits.slice(0, 2)),
      year: normalizeExpiryYear(digits.slice(2)),
    };
  }

  if (digits.length === 4) {
    const monthPart = digits.slice(0, 2);
    if (isValidMonthDigits(monthPart)) {
      return {
        month: normalizeExpiryMonth(monthPart),
        year: normalizeExpiryYear(digits.slice(2)),
      };
    }
    return { month: "", year: normalizeExpiryYear(digits) };
  }

  if (digits.length === 3) {
    const monthPart = digits.slice(0, 2);
    if (isValidMonthDigits(monthPart)) {
      return {
        month: normalizeExpiryMonth(monthPart),
        year: normalizeExpiryYear(digits.slice(2)),
      };
    }
    return { month: "", year: normalizeExpiryYear(digits) };
  }

  if (digits.length === 2) {
    if (isValidMonthDigits(digits)) {
      return { month: normalizeExpiryMonth(digits), year: "" };
    }
    return { month: "", year: normalizeExpiryYear(digits) };
  }

  return { month: digits, year: "" };
}

export function normalizeExpiryMonth(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 2);
  if (!digits) return "";
  const month = Number(digits);
  if (month < 1) return digits.padStart(2, "0");
  if (month > 12) return "12";
  return String(month).padStart(2, "0");
}

export function normalizeExpiryYear(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function formatCardExpiry(month: string, year: string): string {
  const normalizedMonth = month.length === 1 && !year ? month : month ? normalizeExpiryMonth(month) : "";
  const yearDigits = normalizeExpiryYear(year);
  if (!normalizedMonth && !yearDigits) return "";
  if (!normalizedMonth) return yearDigits;
  if (!yearDigits) return normalizedMonth;
  return `${normalizedMonth}/${yearDigits}`;
}

/** Live MM/YY input: digits only, never prefix a leading slash. */
export function formatExpiryInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** Profile expiry field display as MM/YY, including leftover `/1129` values. */
export function formatExpiryDisplay(expiry: string): string {
  const trimmed = expiry.trim();
  if (!trimmed) return "";
  const parts = parseCardExpiry(trimmed);
  if (parts.month && parts.year) {
    const month = parts.month.length === 1 ? parts.month : normalizeExpiryMonth(parts.month);
    return `${month}/${parts.year.slice(-2)}`;
  }
  if (parts.month) return parts.month;
  if (parts.year) return parts.year;
  return formatExpiryInput(trimmed);
}

/** Normalize any expiry value to MM/YYYY, upgrading 2-digit years on import or load. */
export function normalizeCardExpiryString(expiry: string): string {
  const trimmed = expiry.trim();
  if (!trimmed) return "";
  const parts = parseCardExpiry(trimmed);
  if (!parts.month && !parts.year) return "";
  const year = parts.year ? expandExpiryYearToFourDigits(parts.year) : "";
  if (!parts.month) return year;
  if (!year) return parts.month;
  return `${parts.month}/${year}`;
}

export function formatExpiryMonthInput(value: string): string {
  return normalizeExpiryMonth(value);
}

export function formatExpiryYearInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

const IMPORT_BRAND_LABELS = ["Visa", "Mastercard", "Amex", "Discover"] as const;

export function normalizeImportBrandLabel(value: string | undefined, cardNumber?: string): string {
  if (!value?.trim()) {
    return cardNumber ? detectCardBrand(cardNumber) : "Visa";
  }

  switch (normalizeCardBrand(value)) {
    case "visa":
      return "Visa";
    case "mastercard":
      return "Mastercard";
    case "amex":
      return "Amex";
    case "discover":
      return "Discover";
    default: {
      const trimmed = value.trim();
      const exactMatch = IMPORT_BRAND_LABELS.find((brand) => brand.toLowerCase() === trimmed.toLowerCase());
      if (exactMatch) return exactMatch;
      return cardNumber ? detectCardBrand(cardNumber) : "Visa";
    }
  }
}

export function cardNumbersMatch(left: string, right: string): boolean {
  const leftDigits = parseCardNumberDigits(left);
  const rightDigits = parseCardNumberDigits(right);
  return leftDigits.length > 0 && leftDigits === rightDigits;
}

export function normalizeCardCvv(value: string): string {
  return value.trim();
}

/** Stable import duplicate key: number + normalized MM/YYYY expiry + CVV. */
export function cardImportFingerprint(number: string, expiry: string, cvv: string): string {
  const digits = parseCardNumberDigits(number);
  const normalizedExpiry = normalizeCardExpiryString(expiry);
  const normalizedCvv = normalizeCardCvv(cvv);
  return `${digits}|${normalizedExpiry}|${normalizedCvv}`;
}

export function findPoolCardByPayment(
  payment: Pick<ProfilePayment, "number">,
  cards: CreditCard[],
): CreditCard | undefined {
  const digits = parseCardNumberDigits(payment.number);
  if (!digits) return undefined;
  return cards.find((card) => cardNumbersMatch(card.number, payment.number));
}

export function resolveCreditCardProfileLabel(
  profile: Pick<Profile, "creditCardId" | "payment">,
  cards: CreditCard[],
): string | undefined {
  const linked = profile.creditCardId ? cards.find((card) => card.id === profile.creditCardId) : undefined;
  if (linked && cardNumbersMatch(linked.number, profile.payment.number)) {
    return linked.profileName;
  }

  const matched = findPoolCardByPayment(profile.payment, cards);
  if (matched) {
    return matched.profileName;
  }

  const digits = parseCardNumberDigits(profile.payment.number);
  if (digits.length >= 4) {
    return `ending in ${digits.slice(-4)}`;
  }

  return undefined;
}

export type StoredCreditCard = {
  id: string;
  profileName?: string;
  label?: string;
  number: string;
  numberLast4?: string;
  expiry: string;
  cvv: string;
  brand: string;
  categoryId?: string;
  accountStatus?: AccountReviewStatus;
  assignmentScope?: CardAssignmentScope;
  notes?: string;
  createdAt: string;
};

function normalizeCardReviewStatus(value: unknown): AccountReviewStatus {
  return value === "not_good" ? "not_good" : "good";
}

/** Pool cards marked "Not good" cannot be assigned to profiles. */
export function isAssignablePoolCard(card: Pick<CreditCard, "accountStatus">): boolean {
  return card.accountStatus !== "not_good";
}

export function filterAssignablePoolCards(cards: CreditCard[]): CreditCard[] {
  return cards.filter(isAssignablePoolCard);
}

function normalizeCardAssignmentScope(value: unknown): CardAssignmentScope {
  return value === "single_profile" ? "single_profile" : "account_group";
}

export function normalizeCreditCard(card: StoredCreditCard): CreditCard {
  const number = typeof card.number === "string" ? parseCardNumberDigits(card.number) : "";
  const storedLast4 =
    typeof card.numberLast4 === "string" ? card.numberLast4.replace(/\D/g, "").slice(-4) : "";
  const cvv = typeof card.cvv === "string" ? card.cvv : "";
  return {
    id: card.id,
    profileName: card.profileName?.trim() || card.label?.trim() || "",
    number,
    numberLast4: storedLast4 || (number.length >= 4 ? number.slice(-4) : ""),
    expiry: normalizeCardExpiryString(card.expiry ?? ""),
    cvv,
    brand: card.brand || detectCardBrand(number),
    categoryId: card.categoryId?.trim() || CARD_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: normalizeCardReviewStatus(card.accountStatus),
    assignmentScope: normalizeCardAssignmentScope(card.assignmentScope),
    notes: card.notes?.trim() ?? "",
    createdAt: card.createdAt,
  };
}

export function creditCardProfileLabel(card: Pick<CreditCard, "profileName">): string {
  return card.profileName.trim();
}

export function profilesMatchingCard(card: CreditCard, profiles: ProfileSummary[]): ProfileSummary[] {
  return profiles.filter((profile) => {
    if (profile.creditCardId === card.id) {
      return true;
    }
    if (profile.paymentNumber && cardNumbersMatch(profile.paymentNumber, card.number)) {
      return true;
    }
    return false;
  });
}

export function profileNamesMatchingCard(card: CreditCard, profiles: ProfileSummary[]): string[] {
  return profilesMatchingCard(card, profiles).map((profile) => profile.name);
}
