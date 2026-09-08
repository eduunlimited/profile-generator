import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "./profileCategoryUtils";
import { parseCardNumberDigits } from "./creditCardUtils";
import { normalizeUsPhone } from "./phoneUtils";
import type { Profile, ProfileName } from "./types";

export const ACCOUNT_SITES = ["Target", "Walmart", "Pokemon Center"] as const;
export type AccountSite = (typeof ACCOUNT_SITES)[number];

export const DEFAULT_ACCOUNT_SITE: AccountSite = "Target";

function slugFromName(name: ProfileName): string {
  const source = (name.jig || name.full || `${name.first} ${name.last}`).trim();
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 28);
  return slug || "profile";
}

export function generateProfileEmail(name: ProfileName, token: string): string {
  return `${slugFromName(name)}.${token}@test.local`;
}

export function generateUniqueProfileEmail(name: ProfileName, usedEmails: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const token =
      attempt === 0
        ? crypto.randomUUID().slice(0, 8)
        : crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const email = generateProfileEmail(name, token);
    if (!usedEmails.has(email.toLowerCase())) {
      usedEmails.add(email.toLowerCase());
      return email;
    }
  }

  const fallback = generateProfileEmail(name, crypto.randomUUID().replace(/-/g, ""));
  usedEmails.add(fallback.toLowerCase());
  return fallback;
}

export function resolveProfileEmail(profile: Profile): string {
  return profile.email?.trim() || profile.logins[0]?.email?.trim() || "";
}

function stripOrphanProfilePayment(profile: Profile): Profile {
  const hasNumber = parseCardNumberDigits(profile.payment.number).length > 0;
  if (hasNumber || profile.creditCardId) {
    return profile;
  }
  const { number, expiry, cvv, brand } = profile.payment;
  if (!number && !expiry && !cvv && !brand) {
    return profile;
  }
  return {
    ...profile,
    creditCardId: undefined,
    payment: { number: "", expiry: "", cvv: "", brand: "" },
  };
}

export function normalizeProfile(profile: Profile): Profile {
  const email = resolveProfileEmail(profile);
  const phone = normalizeUsPhone(profile.phone ?? "");
  return stripOrphanProfilePayment({
    ...profile,
    email,
    phone,
    categoryId: profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: profile.accountStatus === "not_good" ? "not_good" : "good",
    notes: profile.notes ?? "",
    cardHolderName: profile.cardHolderName ?? "",
    cardHolderSameAsShipping: profile.cardHolderSameAsShipping ?? true,
    billingSameAsShipping: profile.billingSameAsShipping !== false,
    oneCheckoutPerProfile: profile.oneCheckoutPerProfile !== false,
    credentialIds: profile.credentialIds ?? [],
    logins: (profile.logins ?? []).map((login) => ({
      ...login,
      email: email || login.email,
      username: email || login.username,
    })),
  });
}

export function setProfileEmail(profile: Profile, email: string): Profile {
  const trimmed = email.trim();
  return {
    ...profile,
    email: trimmed,
    logins: profile.logins.map((login) => ({
      ...login,
      email: trimmed,
      username: trimmed,
    })),
  };
}
