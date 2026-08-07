import {
  detectCardBrand,
  formatCardExpiry,
  parseCardExpiry,
  parseCardNumberDigits,
} from "./creditCardUtils";
import { profileMatchesCredential } from "./linkCredentialsByEmail";
import { DEFAULT_ACCOUNT_SITE, resolveProfileEmail } from "./profileEmailUtils";
import { billingSameAsShipping, updateProfileField, updateProfilePaymentField } from "./profileUtils";
import type {
  AccountReviewStatus,
  Credential,
  CreditCard,
  MassDistributeField,
  MassDistributeOptions,
  Profile,
} from "./types";

export interface MassDistributeFieldMeta {
  value: MassDistributeField;
  label: string;
  hint: string;
  group: "Profile" | "Payment" | "Shipping" | "Billing" | "Account";
  placeholder: string;
}

export const MASS_DISTRIBUTE_FIELDS: MassDistributeFieldMeta[] = [
  { value: "profileName", label: "Profile name", hint: "Table label for each jig profile", group: "Profile", placeholder: "Jig-01\nJig-02" },
  { value: "email", label: "Email", hint: "Also updates linked login emails; may link account when email + site match", group: "Profile", placeholder: "user1@example.com\nuser2@example.com" },
  { value: "phone", label: "Phone", hint: "Stored as digits; dashes optional in pasted lines", group: "Profile", placeholder: "555-123-4567\n5559876543" },
  { value: "accountStatus", label: "Status", hint: "good or not good (per line)", group: "Profile", placeholder: "good\nnot good" },
  { value: "notes", label: "Notes", hint: "Free text notes", group: "Profile", placeholder: "Note 1\nNote 2" },
  {
    value: "accountSite",
    label: "Account site",
    hint: "Target, Walmart, or a custom site; blank line clears the link",
    group: "Profile",
    placeholder: "Target\nWalmart",
  },
  { value: "cardHolderName", label: "Cardholder name", hint: "Sets a custom cardholder name (does not toggle same-as-shipping)", group: "Payment", placeholder: "John Smith\nJane Doe" },
  { value: "cardBrand", label: "Card type", hint: "Visa, Mastercard, Amex, or Discover", group: "Payment", placeholder: "Visa\nMastercard" },
  { value: "cardNumber", label: "Card number", hint: "Clears pool card link when changed", group: "Payment", placeholder: "4111...\n5500..." },
  { value: "cardExpiry", label: "Card expiry", hint: "MM/YY or MM/YYYY", group: "Payment", placeholder: "12/28\n01/2029" },
  { value: "cardCvv", label: "Card CVV", hint: "3 or 4 digit security code", group: "Payment", placeholder: "123\n456" },
  { value: "shippingFirstName", label: "Shipping first name", hint: "Uses billing name fields when billing same as shipping", group: "Shipping", placeholder: "John\nJane" },
  { value: "shippingLastName", label: "Shipping last name", hint: "Uses billing name fields when billing same as shipping", group: "Shipping", placeholder: "Smith\nDoe" },
  { value: "shippingStreet", label: "Shipping address line 1", hint: "Street address", group: "Shipping", placeholder: "123 Main St\n456 Oak Ave" },
  { value: "shippingUnit", label: "Shipping address line 2", hint: "Apt, unit, suite", group: "Shipping", placeholder: "Apt 4B\nUnit 2" },
  { value: "shippingCity", label: "Shipping city", hint: "City", group: "Shipping", placeholder: "New York\nLos Angeles" },
  { value: "shippingState", label: "Shipping state", hint: "State or province", group: "Shipping", placeholder: "NY\nCA" },
  { value: "shippingPostalCode", label: "Shipping zip code", hint: "Postal / ZIP code", group: "Shipping", placeholder: "10001\n90001" },
  { value: "shippingCountry", label: "Shipping country", hint: "Country", group: "Shipping", placeholder: "United States\nUnited States" },
  { value: "billingFirstName", label: "Billing first name", hint: "Billing name (always on billing fields)", group: "Billing", placeholder: "John\nJane" },
  { value: "billingLastName", label: "Billing last name", hint: "Billing name (always on billing fields)", group: "Billing", placeholder: "Smith\nDoe" },
  { value: "billingStreet", label: "Billing address line 1", hint: "Billing street", group: "Billing", placeholder: "123 Main St\n456 Oak Ave" },
  { value: "billingUnit", label: "Billing address line 2", hint: "Billing apt / unit", group: "Billing", placeholder: "Apt 4B\nSuite 100" },
  { value: "billingCity", label: "Billing city", hint: "Billing city", group: "Billing", placeholder: "New York\nChicago" },
  { value: "billingState", label: "Billing state", hint: "Billing state", group: "Billing", placeholder: "NY\nIL" },
  { value: "billingPostalCode", label: "Billing zip code", hint: "Billing postal code", group: "Billing", placeholder: "10001\n60601" },
  { value: "billingCountry", label: "Billing country", hint: "Billing country", group: "Billing", placeholder: "United States\nUnited States" },
  {
    value: "accountPassword",
    label: "Account password",
    hint: "Updates matching pool account (by email + site) and profile login",
    group: "Account",
    placeholder: "pass1\npass2",
  },
];

export function massDistributeFieldMeta(field: MassDistributeField): MassDistributeFieldMeta {
  return MASS_DISTRIBUTE_FIELDS.find((item) => item.value === field) ?? MASS_DISTRIBUTE_FIELDS[0];
}

export function parseDistributeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeAccountStatus(value: string): AccountReviewStatus {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "not_good" || normalized === "bad" || normalized === "not") {
    return "not_good";
  }
  return "good";
}

function normalizeCardBrandValue(value: string): string {
  const trimmed = value.trim();
  const brands = ["Visa", "Mastercard", "Amex", "Discover"] as const;
  const match = brands.find((brand) => brand.toLowerCase() === trimmed.toLowerCase());
  return match ?? detectCardBrand(trimmed);
}

function shippingFieldPath(profile: Profile, part: "first" | "last"): string {
  return billingSameAsShipping(profile) ? `name.${part}` : `shippingName.${part}`;
}

function shippingAddressPath(profile: Profile, part: keyof Profile["address"]): string {
  return billingSameAsShipping(profile) ? `address.${part}` : `shippingAddress.${part}`;
}

function billingAddressPath(part: keyof Profile["address"]): string {
  return `address.${part}`;
}

function ensureShippingFields(profile: Profile): Profile {
  if (billingSameAsShipping(profile)) {
    return profile;
  }
  return {
    ...profile,
    shippingName: profile.shippingName ?? structuredClone(profile.name),
    shippingAddress: profile.shippingAddress ?? structuredClone(profile.address),
  };
}

function applyAccountPassword(
  profile: Profile,
  site: string,
  password: string,
  credentials: Credential[],
  now: string,
): { profile: Profile; updatedCredentials: Credential[] } {
  const updatedCredentials: Credential[] = [];
  for (const credential of credentials) {
    if (profileMatchesCredential(profile, credential) && credential.site === site) {
      updatedCredentials.push({ ...credential, password });
    }
  }

  const email = resolveProfileEmail(profile);
  const existing = profile.logins.find((login) => login.label === site);
  const login = {
    id: existing?.id ?? crypto.randomUUID(),
    label: site,
    email,
    username: email,
    password,
  };
  const otherLogins = profile.logins.filter((item) => item.label !== site);

  return {
    profile: {
      ...profile,
      email,
      logins: [...otherLogins, login],
      updatedAt: now,
    },
    updatedCredentials,
  };
}

export function distributeLinesToProfile(
  profile: Profile,
  line: string,
  field: MassDistributeField,
  creditCards: CreditCard[],
  credentials: Credential[],
  accountSite: string,
): { profile: Profile; updatedCredentials: Credential[] } {
  const now = new Date().toISOString();
  const value = line.trim();
  let next = profile;
  let updatedCredentials: Credential[] = [];

  if (field.startsWith("shipping")) {
    next = ensureShippingFields(profile);
  }

  switch (field) {
    case "profileName":
      next = updateProfileField(profile, "profileName", value);
      break;
    case "email":
      next = updateProfileField(profile, "email", value);
      break;
    case "phone":
      next = updateProfileField(profile, "phone", value);
      break;
    case "accountStatus":
      next = { ...profile, accountStatus: normalizeAccountStatus(value), updatedAt: now };
      break;
    case "notes":
      next = { ...profile, notes: value, updatedAt: now };
      break;
    case "accountSite":
      next = updateProfileField(profile, "accountSite", value);
      break;
    case "cardHolderName":
      next = {
        ...updateProfileField(profile, "cardHolderName", value),
        cardHolderSameAsShipping: false,
      };
      break;
    case "cardBrand":
      next = updateProfilePaymentField(profile, "payment.brand", normalizeCardBrandValue(value), creditCards);
      break;
    case "cardNumber": {
      const digits = parseCardNumberDigits(value);
      next = updateProfilePaymentField(profile, "payment.number", digits, creditCards);
      if (digits) {
        next = updateProfilePaymentField(next, "payment.brand", detectCardBrand(digits), creditCards);
      }
      break;
    }
    case "cardCvv":
      next = updateProfilePaymentField(profile, "payment.cvv", value.replace(/\D/g, ""), creditCards);
      break;
    case "cardExpiry": {
      const parts = parseCardExpiry(value);
      next = updateProfilePaymentField(
        profile,
        "payment.expiry",
        formatCardExpiry(parts.month, parts.year),
        creditCards,
      );
      break;
    }
    case "shippingFirstName":
      next = updateProfileField(next, shippingFieldPath(next, "first"), value);
      break;
    case "shippingLastName":
      next = updateProfileField(next, shippingFieldPath(next, "last"), value);
      break;
    case "shippingStreet":
      next = updateProfileField(next, shippingAddressPath(next, "street"), value);
      break;
    case "shippingUnit":
      next = updateProfileField(next, shippingAddressPath(next, "unit"), value);
      break;
    case "shippingCity":
      next = updateProfileField(next, shippingAddressPath(next, "city"), value);
      break;
    case "shippingState":
      next = updateProfileField(next, shippingAddressPath(next, "state"), value);
      break;
    case "shippingPostalCode":
      next = updateProfileField(next, shippingAddressPath(next, "postalCode"), value);
      break;
    case "shippingCountry":
      next = updateProfileField(next, shippingAddressPath(next, "country"), value);
      break;
    case "billingFirstName":
      next = updateProfileField(profile, "name.first", value);
      break;
    case "billingLastName":
      next = updateProfileField(profile, "name.last", value);
      break;
    case "billingStreet":
      next = updateProfileField(profile, billingAddressPath("street"), value);
      break;
    case "billingUnit":
      next = updateProfileField(profile, billingAddressPath("unit"), value);
      break;
    case "billingCity":
      next = updateProfileField(profile, billingAddressPath("city"), value);
      break;
    case "billingState":
      next = updateProfileField(profile, billingAddressPath("state"), value);
      break;
    case "billingPostalCode":
      next = updateProfileField(profile, billingAddressPath("postalCode"), value);
      break;
    case "billingCountry":
      next = updateProfileField(profile, billingAddressPath("country"), value);
      break;
    case "accountPassword": {
      const site = profile.accountSite?.trim() || accountSite || DEFAULT_ACCOUNT_SITE;
      const result = applyAccountPassword(profile, site, value, credentials, now);
      next = result.profile;
      updatedCredentials = result.updatedCredentials;
      break;
    }
    default:
      next = profile;
  }

  if (field !== "accountPassword") {
    next = { ...next, updatedAt: now };
  }

  return { profile: next, updatedCredentials };
}

export function massDistributeToProfiles(
  profilesInOrder: Profile[],
  lines: string[],
  options: Pick<MassDistributeOptions, "field" | "accountSite">,
  creditCards: CreditCard[] = [],
  credentials: Credential[] = [],
): {
  updated: Profile[];
  updatedCredentials: Credential[];
  appliedCount: number;
  skippedLines: number;
  skippedProfiles: number;
} {
  const count = Math.min(profilesInOrder.length, lines.length);
  const updated: Profile[] = [];
  const credentialMap = new Map(credentials.map((credential) => [credential.id, credential]));

  for (let index = 0; index < count; index += 1) {
    const result = distributeLinesToProfile(
      profilesInOrder[index],
      lines[index],
      options.field,
      creditCards,
      [...credentialMap.values()],
      options.accountSite ?? DEFAULT_ACCOUNT_SITE,
    );
    updated.push(result.profile);
    for (const credential of result.updatedCredentials) {
      credentialMap.set(credential.id, credential);
    }
  }

  return {
    updated,
    updatedCredentials: [...credentialMap.values()].filter(
      (credential) => credentials.find((item) => item.id === credential.id)?.password !== credential.password,
    ),
    appliedCount: count,
    skippedLines: Math.max(0, lines.length - count),
    skippedProfiles: Math.max(0, profilesInOrder.length - count),
  };
}

export function massDistributeSummary(result: {
  appliedCount: number;
  skippedLines: number;
  skippedProfiles: number;
  updatedCredentialCount?: number;
}): string {
  const parts = [`Distributed ${result.appliedCount} line(s) to ${result.appliedCount} profile(s).`];
  if (result.updatedCredentialCount && result.updatedCredentialCount > 0) {
    parts.push(`Updated ${result.updatedCredentialCount} pool account password(s).`);
  }
  if (result.skippedLines > 0) {
    parts.push(`${result.skippedLines} extra line(s) were not used.`);
  }
  if (result.skippedProfiles > 0) {
    parts.push(`${result.skippedProfiles} selected profile(s) had no matching line.`);
  }
  return parts.join(" ");
}
