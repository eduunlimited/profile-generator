import { normalizeCardBrand, parseCardNumberDigits } from "../creditCardUtils";
import type { CreditCard, OrderPayment, ParsedOrder, ProfileSummary } from "../types";
import { profileMatchesRetailer } from "./performance";

export interface OrderCardDisplay {
  primary: string;
  secondary?: string;
}

function lastFour(value: string | undefined): string {
  const digits = parseCardNumberDigits(value ?? "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function uniqueNames(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
}

export function matchOrderCardName(
  payment: OrderPayment | undefined,
  cards: CreditCard[],
  profiles: ProfileSummary[] = [],
): string | undefined {
  const last4 = payment?.last4?.trim() ?? "";
  if (!/^\d{4}$/.test(last4)) return undefined;
  const brand = payment?.brand ? normalizeCardBrand(payment.brand) : "unknown";

  const pool = cards.filter((card) => lastFour(card.number) === last4);
  const branded = brand === "unknown" ? pool : pool.filter((card) => normalizeCardBrand(card.brand) === brand);
  const brandedNames = uniqueNames(branded.map((card) => card.profileName));
  if (brandedNames.length === 1) return brandedNames[0];
  const poolNames = uniqueNames(pool.map((card) => card.profileName));
  if (poolNames.length === 1) return poolNames[0];

  const fromProfiles = profiles.filter(
    (profile) => lastFour(profile.paymentNumber ?? profile.cardNumberMasked) === last4,
  );
  const brandedProfiles =
    brand === "unknown"
      ? fromProfiles
      : fromProfiles.filter((profile) => normalizeCardBrand(profile.cardBrand) === brand);
  const brandedProfileNames = uniqueNames(brandedProfiles.map((profile) => profile.creditCardLabel));
  if (brandedProfileNames.length === 1) return brandedProfileNames[0];
  const profileNames = uniqueNames(fromProfiles.map((profile) => profile.creditCardLabel));
  if (profileNames.length === 1) return profileNames[0];
  return undefined;
}

export function formatOrderCardDisplay(
  order: ParsedOrder,
  cards: CreditCard[],
  profiles: ProfileSummary[] = [],
  fallback = "",
): OrderCardDisplay {
  if (order.retailer === "target") {
    const emailLabel = order.payment?.raw?.trim() ?? "";
    if (!emailLabel) return { primary: fallback.trim() };
    const matched = matchOrderCardName(order.payment, cards, profiles);
    if (matched && emailLabel && matched.toLowerCase() !== emailLabel.toLowerCase()) {
      return { primary: matched, secondary: emailLabel };
    }
    return { primary: matched || emailLabel };
  }
  return { primary: fallback.trim() };
}

export function formatOrderCardCompact(
  order: ParsedOrder,
  cards: CreditCard[],
  profiles: ProfileSummary[] = [],
  fallback = "",
): string {
  const siteProfiles = profiles.filter((profile) => profileMatchesRetailer(profile, order.retailer));
  const cardName = matchOrderCardName(order.payment, cards, siteProfiles)?.trim() || "";
  const brand = order.payment?.brand?.trim() || "";
  const last4 = order.payment?.last4?.trim() || "";
  const parts = [cardName, brand, last4].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return formatOrderCardDisplay(order, cards, siteProfiles, fallback).primary || fallback.trim() || "—";
}

export function orderCardSearchText(
  order: ParsedOrder,
  cards: CreditCard[],
  profiles: ProfileSummary[] = [],
  fallback = "",
): string {
  const display = formatOrderCardDisplay(order, cards, profiles, fallback);
  return [display.primary, display.secondary].filter(Boolean).join(" ");
}
