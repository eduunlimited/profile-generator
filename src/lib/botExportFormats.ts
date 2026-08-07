import type { Profile, ProfileAddress, ProfileName } from "./types";
import {
  exportProfileAddress,
  exportProfileName,
  exportShippingAddress,
  exportShippingName,
} from "./exportProfileFields";
import { resolveCardHolderName } from "./profileUtils";

const US_ABBR_TO_STATE: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const US_STATE_TO_ABBR = Object.fromEntries(
  Object.entries(US_ABBR_TO_STATE).map(([abbr, name]) => [name.toLowerCase(), abbr]),
);

function toStateAbbrev(state: string): string {
  const trimmed = state.trim();
  if (!trimmed) return "";
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return US_STATE_TO_ABBR[trimmed.toLowerCase()] ?? trimmed.slice(0, 2).toUpperCase();
}

function toStateFull(state: string): string {
  const trimmed = state.trim();
  if (!trimmed) return "";
  if (trimmed.length === 2) {
    return US_ABBR_TO_STATE[trimmed.toUpperCase()] ?? trimmed;
  }
  return trimmed;
}

function toAycdCountry(country: string, locale: Profile["locale"]): string {
  const value = country.trim();
  if (!value) {
    if (locale === "en_GB") return "United Kingdom";
    if (locale === "en_CA") return "Canada";
    return "United States";
  }
  if (value.length === 2) {
    if (value.toUpperCase() === "US") return "United States";
    if (value.toUpperCase() === "GB") return "United Kingdom";
    if (value.toUpperCase() === "CA") return "Canada";
  }
  return value;
}

function toStellarCountry(country: string, locale: Profile["locale"]): string {
  const value = country.trim();
  if (!value) {
    if (locale === "en_GB") return "GB";
    if (locale === "en_CA") return "CA";
    return "US";
  }
  const lower = value.toLowerCase();
  if (lower.includes("united states") || lower === "usa") return "US";
  if (lower.includes("united kingdom") || lower === "uk") return "GB";
  if (lower.includes("canada")) return "CA";
  if (value.length === 2) return value.toUpperCase();
  return "US";
}

function mapCardBrand(brand: string): string {
  const normalized = brand.trim().toLowerCase();
  if (normalized === "mastercard") return "MasterCard";
  if (normalized === "visa") return "Visa";
  if (normalized === "amex" || normalized === "american express") return "Amex";
  if (normalized === "discover") return "Discover";
  return brand;
}

function parseExpiry(expiry: string): { month: string; year2: string; year4: string } {
  const [rawMonth = "01", rawYear = "30"] = expiry.split("/");
  const month = rawMonth.padStart(2, "0");
  const yearDigits = rawYear.replace(/\D/g, "");
  const year2 = (yearDigits.length >= 2 ? yearDigits.slice(-2) : yearDigits.padStart(2, "0")).padStart(2, "0");
  const year4 = yearDigits.length === 4 ? yearDigits : `20${year2}`;
  return { month, year2, year4 };
}

function profileEmail(profile: Profile): string {
  return profile.email?.trim() || (profile.logins[0]?.email ?? "");
}

function profilePhone(profile: Profile): string {
  const stored = profile.phone?.trim();
  if (stored) return stored;
  const digits = profile.id.replace(/\D/g, "");
  let phone = "";
  for (let index = 0; index < 10; index += 1) {
    phone += String(parseInt(digits[index] ?? `${index}`, 16) % 10);
  }
  return phone;
}

function profileExportName(profile: Profile, index: number): string {
  const profileName = profile.profileName?.trim();
  if (profileName) return profileName;
  const full = profile.name.full.trim();
  if (full) return full;
  return `Profile-${index + 1}`;
}

function profileLabel(profile: Profile, index: number): string {
  const full = profile.name.full.trim();
  if (full) return full;
  return `Profile-${index + 1}`;
}

function aycdAddress(profile: Profile) {
  const name = exportProfileName(profile);
  const address = exportProfileAddress(profile);
  return {
    name: name.full,
    email: profileEmail(profile),
    phone: profilePhone(profile),
    line1: address.street,
    line2: address.unit ?? "",
    line3: "",
    postCode: address.postalCode,
    city: address.city,
    country: toAycdCountry(address.country, profile.locale),
    state: toStateFull(address.state),
  };
}

function stellarAddressParts(name: ProfileName, address: ProfileAddress, locale: Profile["locale"]) {
  return {
    firstName: name.first,
    lastName: name.last,
    country: toStellarCountry(address.country, locale),
    address: address.street,
    address2: address.unit ?? "",
    state: toStateAbbrev(address.state),
    city: address.city,
    zipcode: address.postalCode,
  };
}

function stellarBillingAddress(profile: Profile) {
  const name = exportProfileName(profile);
  const address = exportProfileAddress(profile);
  return stellarAddressParts(name, address, profile.locale);
}

function stellarShippingAddress(profile: Profile) {
  if (profile.billingSameAsShipping !== false) {
    return stellarBillingAddress(profile);
  }
  const name = exportShippingName(profile);
  const address = exportShippingAddress(profile);
  return stellarAddressParts(name, address, profile.locale);
}

export function toAycdProfile(profile: Profile, index: number) {
  const name = exportProfileName(profile);
  const payment = profile.payment;
  const expiry = parseExpiry(payment.expiry);
  const address = aycdAddress(profile);

  return {
    name: profileLabel(profile, index),
    notes: "",
    billingAddress: address,
    shippingAddress: address,
    paymentDetails: {
      nameOnCard: name.full,
      cardType: mapCardBrand(payment.brand),
      cardNumber: payment.number,
      cardExpMonth: expiry.month,
      cardExpYear: expiry.year4,
      cardCvv: payment.cvv,
    },
    sameBillingAndShippingAddress: true,
    onlyCheckoutOnce: true,
    matchNameOnCardAndAddress: true,
  };
}

export function toStellarAioProfile(profile: Profile, index: number) {
  const payment = profile.payment;
  const expiry = parseExpiry(payment.expiry);
  const billing = stellarBillingAddress(profile);
  const shipping = stellarShippingAddress(profile);
  const sameAsBilling = profile.billingSameAsShipping !== false;

  return {
    profileName: profileExportName(profile, index),
    email: profileEmail(profile),
    phone: profilePhone(profile),
    shipping,
    billing,
    billingAsShipping: sameAsBilling,
    oneCheckoutPerProfile: profile.oneCheckoutPerProfile !== false,
    payment: {
      cardName: resolveCardHolderName(profile),
      cardType: mapCardBrand(payment.brand),
      cardNumber: payment.number,
      cardMonth: expiry.month,
      cardYear: expiry.year2,
      cardCvv: payment.cvv,
    },
  };
}

export function exportAycdJson(profiles: Profile[]): string {
  return JSON.stringify(
    profiles.map((profile, index) => toAycdProfile(profile, index)),
    null,
    2,
  );
}

export function exportStellarAioJson(profiles: Profile[]): string {
  return JSON.stringify(
    profiles.map((profile, index) => toStellarAioProfile(profile, index)),
    null,
    2,
  );
}
