import { loginFromCredential } from "./credentialUtils";
import { resolveProfileEmail, setProfileEmail, generateUniqueProfileEmail } from "./profileEmailUtils";
import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "./profileCategoryUtils";
import type { Credential, CreditCard, Profile, ProfileLogin, ProfileName, ProfilePayment } from "./types";
import { cardNumbersMatch, findPoolCardByPayment } from "./creditCardUtils";
import { generateProfile } from "./generator";
import { normalizeUsPhone } from "./phoneUtils";
export function syncProfileName(profile: Profile): Profile {
  const full = `${profile.name.first} ${profile.name.last}`.trim();
  return {
    ...profile,
    name: {
      ...profile.name,
      full,
    },
  };
}

export function syncShippingName(profile: Profile): Profile {
  if (!profile.shippingName) return profile;
  const full = `${profile.shippingName.first} ${profile.shippingName.last}`.trim();
  return {
    ...profile,
    shippingName: {
      ...profile.shippingName,
      full,
    },
  };
}

export function billingSameAsShipping(profile: Profile): boolean {
  return profile.billingSameAsShipping !== false;
}

export function oneCheckoutPerProfile(profile: Profile): boolean {
  return profile.oneCheckoutPerProfile !== false;
}

export function cardHolderSameAsShipping(profile: Profile): boolean {
  return profile.cardHolderSameAsShipping ?? true;
}

export function resolveShippingNameParts(profile: Profile): ProfileName {
  if (billingSameAsShipping(profile)) {
    return profile.name;
  }
  return profile.shippingName ?? profile.name;
}

export function shippingFullName(profile: Profile): string {
  const parts = resolveShippingNameParts(profile);
  return `${parts.first} ${parts.last}`.trim() || parts.full.trim();
}

export function syncCardHolderFromShipping(profile: Profile): Profile {
  if (!cardHolderSameAsShipping(profile)) {
    return profile;
  }
  return { ...profile, cardHolderName: shippingFullName(profile) };
}

export function setCardHolderSameAsShipping(profile: Profile, value: boolean): Profile {
  const next = structuredClone(profile);
  next.cardHolderSameAsShipping = value;
  if (value) {
    return syncCardHolderFromShipping(next);
  }
  return next;
}

export function resolveCardHolderName(profile: Profile): string {
  if (cardHolderSameAsShipping(profile)) {
    const fromShipping = shippingFullName(profile);
    if (fromShipping) return fromShipping;
  }
  return (
    profile.cardHolderName?.trim() ||
    profile.name.full.trim() ||
    `${profile.name.first} ${profile.name.last}`.trim()
  );
}

export function emptyProfileName(): Profile["name"] {
  return { first: "", last: "", full: "" };
}

export function emptyProfileAddress(): Profile["address"] {
  return {
    street: "",
    city: "",
    state: "",
    postalCode: "",
    country: "United States",
  };
}

export function ensureProfileEditorFields(profile: Profile): Profile {
  const sameAsBilling = billingSameAsShipping(profile);
  return syncCardHolderFromShipping({
    ...profile,
    cardHolderName: profile.cardHolderName ?? "",
    cardHolderSameAsShipping: profile.cardHolderSameAsShipping ?? true,
    billingSameAsShipping: sameAsBilling,
    oneCheckoutPerProfile: oneCheckoutPerProfile(profile),
    shippingName: sameAsBilling ? profile.shippingName : (profile.shippingName ?? emptyProfileName()),
    shippingAddress: sameAsBilling ? profile.shippingAddress : (profile.shippingAddress ?? emptyProfileAddress()),
  });
}

export function setBillingSameAsShipping(profile: Profile, value: boolean): Profile {
  const next = structuredClone(profile);
  next.billingSameAsShipping = value;
  if (value) {
    if (next.shippingName && next.shippingAddress) {
      next.name = structuredClone(next.shippingName);
      next.address = structuredClone(next.shippingAddress);
      next.shippingName = undefined;
      next.shippingAddress = undefined;
    }
    return syncProfileName(syncCardHolderFromShipping(next));
  }
  next.shippingName = next.shippingName ?? structuredClone(next.name);
  next.shippingAddress = next.shippingAddress ?? structuredClone(next.address);
  return syncCardHolderFromShipping(syncShippingName(next));
}

export function updateProfileField(
  profile: Profile,
  path: string,
  value: string,
): Profile {
  const next = structuredClone(profile);
  const parts = path.split(".");
  let cursor: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;

  if (path.startsWith("name.first") || path.startsWith("name.last")) {
    return syncProfileName(syncCardHolderFromShipping(next));
  }

  if (path.startsWith("shippingName.first") || path.startsWith("shippingName.last")) {
    return syncCardHolderFromShipping(syncShippingName(next));
  }

  if (path === "email") {
    return setProfileEmail(next, value);
  }

  if (path === "profileName" || path === "cardHolderName") {
    cursor[parts[parts.length - 1]] = value;
  }

  if (path === "phone") {
    next.phone = normalizeUsPhone(value);
  }

  if (path === "accountSite") {
    next.accountSite = value.trim();
  }

  return next;
}

export function syncProfileCreditCardLink(profile: Profile, cards: CreditCard[]): Profile {
  if (profile.creditCardId) {
    const linked = cards.find((card) => card.id === profile.creditCardId);
    if (linked && cardNumbersMatch(linked.number, profile.payment.number)) {
      return profile;
    }
    return { ...profile, creditCardId: undefined };
  }

  const matched = findPoolCardByPayment(profile.payment, cards);
  if (!matched) {
    return profile;
  }

  return { ...profile, creditCardId: matched.id };
}

export function syncAllProfileCreditCardLinks(profiles: Profile[], cards: CreditCard[]): Profile[] {
  return profiles.map((profile) => syncProfileCreditCardLink(profile, cards));
}

export function creditCardLinkChanged(before: Profile, after: Profile): boolean {
  return before.creditCardId !== after.creditCardId;
}

export function updateProfilePaymentField(
  profile: Profile,
  path: string,
  value: string,
  cards: CreditCard[],
): Profile {
  const next = updateProfileField(profile, path, value);
  return syncProfileCreditCardLink(next, cards);
}

export function regeneratePayment(_profile: Profile): ProfilePayment {
  return generateProfile().payment;
}

export function regenerateLogin(profile: Profile, loginIndex: number): ProfileLogin {
  const slug = `${profile.name.first}.${profile.name.last}`
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
  const suffix = loginIndex === 0 ? "" : loginIndex.toString();
  const generated = generateProfile({ locale: profile.locale, loginCount: 1 });
  const login = generated.logins[0];
  return {
    ...login,
    id: profile.logins[loginIndex]?.id ?? crypto.randomUUID(),
    label: profile.logins[loginIndex]?.label ?? (loginIndex === 0 ? "default" : `account-${loginIndex + 1}`),
    username: `${slug}${suffix}`,
    email: `${slug}${suffix}@test.local`,
  };
}

export function updateLoginField(
  profile: Profile,
  loginIndex: number,
  field: keyof Profile["logins"][number],
  value: string,
): Profile {
  const next = structuredClone(profile);
  if (!next.logins[loginIndex]) return next;
  next.logins[loginIndex] = {
    ...next.logins[loginIndex],
    [field]: value,
  };
  return next;
}

export function applyCreditCardFromPool(
  profile: Profile,
  cardId: string,
  cards: CreditCard[],
): Profile {
  if (!cardId) {
    return { ...profile, creditCardId: undefined };
  }
  const card = cards.find((item) => item.id === cardId);
  if (!card) return profile;
  return {
    ...profile,
    creditCardId: cardId,
    payment: {
      number: card.number,
      expiry: card.expiry,
      cvv: card.cvv,
      brand: card.brand,
    },
  };
}

export function syncProfileCredentials(
  profile: Profile,
  credentialIds: string[],
  credentials: Credential[],
): Profile {
  let profileEmail = resolveProfileEmail(profile);
  if (!profileEmail) {
    profileEmail = generateUniqueProfileEmail(profile.name, new Set());
  }

  const logins = credentialIds
    .map((id) => credentials.find((item) => item.id === id))
    .filter((item): item is Credential => Boolean(item))
    .map((credential) => {
      const existing = profile.logins.find((login) => login.label === credential.site);
      return loginFromCredential(credential, profileEmail, existing?.id);
    });

  return {
    ...profile,
    email: profileEmail,
    credentialIds,
    logins: logins.length > 0 ? logins : profile.logins,
  };
}

export function toggleProfileCredential(
  profile: Profile,
  credentialId: string,
  credentials: Credential[],
  assign: boolean,
): Profile {
  const ids = new Set(profile.credentialIds ?? []);
  if (assign) ids.add(credentialId);
  else ids.delete(credentialId);
  return syncProfileCredentials(profile, [...ids], credentials);
}

export function createBlankProfile(): Profile {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    locale: "en_US",
    email: "",
    name: { first: "", last: "", full: "" },
    address: {
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "United States",
    },
    payment: regeneratePayment({} as Profile),
    categoryId: PROFILE_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    notes: "",
    billingSameAsShipping: true,
    oneCheckoutPerProfile: true,
    cardHolderName: "",
    cardHolderSameAsShipping: true,
    accountSite: "",
    credentialIds: [],
    logins: [
      {
        id: crypto.randomUUID(),
        label: "default",
        username: "",
        email: "",
        password: "",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
