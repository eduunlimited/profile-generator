import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "./profileCategoryUtils";
import { formatUsPhone, normalizeUsPhone } from "./phoneUtils";
import {
  billingSameAsShipping,
  cardHolderSameAsShipping,
  ensureProfileEditorFields,
  oneCheckoutPerProfile,
  resolveShippingNameParts,
  setBillingSameAsShipping,
  setCardHolderSameAsShipping,
  shippingFullName,
  updateProfileField,
  updateProfilePaymentField,
} from "./profileUtils";
import type { AccountReviewStatus, CreditCard, Profile, ProfileAddress } from "./types";

export type ProfileEditField =
  | "profileName"
  | "email"
  | "phone"
  | "accountSite"
  | "oneCheckoutPerProfile"
  | "categoryId"
  | "accountStatus"
  | "cardHolderSameAsShipping"
  | "cardHolderName"
  | "paymentBrand"
  | "paymentNumber"
  | "paymentExpiry"
  | "paymentCvv"
  | "shippingFirstName"
  | "shippingLastName"
  | "shippingStreet"
  | "shippingUnit"
  | "shippingCountry"
  | "shippingState"
  | "shippingCity"
  | "shippingPostalCode"
  | "billingSameAsShipping"
  | "billingFirstName"
  | "billingLastName"
  | "billingStreet"
  | "billingUnit"
  | "billingCountry"
  | "billingState"
  | "billingCity"
  | "billingPostalCode";

export type ProfileMixedFields = Record<ProfileEditField, boolean>;
export type ProfileTouchedFields = Record<ProfileEditField, boolean>;

export const PROFILE_EDIT_FIELDS: ProfileEditField[] = [
  "profileName",
  "email",
  "phone",
  "accountSite",
  "oneCheckoutPerProfile",
  "categoryId",
  "accountStatus",
  "cardHolderSameAsShipping",
  "cardHolderName",
  "paymentBrand",
  "paymentNumber",
  "paymentExpiry",
  "paymentCvv",
  "shippingFirstName",
  "shippingLastName",
  "shippingStreet",
  "shippingUnit",
  "shippingCountry",
  "shippingState",
  "shippingCity",
  "shippingPostalCode",
  "billingSameAsShipping",
  "billingFirstName",
  "billingLastName",
  "billingStreet",
  "billingUnit",
  "billingCountry",
  "billingState",
  "billingCity",
  "billingPostalCode",
];

export function emptyProfileTouchedFields(): ProfileTouchedFields {
  return Object.fromEntries(PROFILE_EDIT_FIELDS.map((field) => [field, false])) as ProfileTouchedFields;
}

export function emptyProfileMixedFields(): ProfileMixedFields {
  return emptyProfileTouchedFields();
}

function valuesMatch<T>(items: T[], pick: (item: T) => string): boolean {
  if (items.length === 0) return true;
  const first = pick(items[0]);
  return items.every((item) => pick(item) === first);
}

function boolsMatch<T>(items: T[], pick: (item: T) => boolean): boolean {
  if (items.length === 0) return true;
  const first = pick(items[0]);
  return items.every((item) => pick(item) === first);
}

function effectiveShippingAddress(profile: Profile): ProfileAddress {
  if (billingSameAsShipping(profile)) {
    return profile.address;
  }
  return profile.shippingAddress ?? profile.address;
}

function pickString(profiles: Profile[], pick: (profile: Profile) => string): { mixed: boolean; value: string } {
  const mixed = !valuesMatch(profiles, pick);
  return { mixed, value: mixed ? "" : (pick(profiles[0]) ?? "") };
}

function pickBool(
  profiles: Profile[],
  pick: (profile: Profile) => boolean,
  defaultWhenMixed: boolean,
): { mixed: boolean; value: boolean } {
  const mixed = !boolsMatch(profiles, pick);
  return { mixed, value: mixed ? defaultWhenMixed : pick(profiles[0]) };
}

function shippingFieldPath(profile: Profile, part: "first" | "last"): string {
  return billingSameAsShipping(profile) ? `name.${part}` : `shippingName.${part}`;
}

function shippingAddressPath(profile: Profile, part: keyof ProfileAddress): string {
  return billingSameAsShipping(profile) ? `address.${part}` : `shippingAddress.${part}`;
}

export function buildProfileMassEditDraft(
  profiles: Profile[],
  ids: string[],
): {
  draft: Profile;
  mixedFields: ProfileMixedFields;
} {
  const selected = profiles.filter((profile) => ids.includes(profile.id)).map(ensureProfileEditorFields);
  const first = ensureProfileEditorFields(selected[0] ?? emptyMassEditProfile());
  const draft = structuredClone(first);

  const profileName = pickString(selected, (profile) => (profile.profileName ?? "").trim());
  const email = pickString(selected, (profile) => profile.email.trim());
  const phone = pickString(selected, (profile) => (profile.phone ?? "").trim());
  const accountSite = pickString(selected, (profile) => (profile.accountSite ?? "").trim());
  const oneCheckout = pickBool(selected, oneCheckoutPerProfile, true);
  const category = pickString(selected, (profile) => profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID);
  const accountStatus = pickString(selected, (profile) => profile.accountStatus);
  const cardHolderSame = pickBool(selected, cardHolderSameAsShipping, true);
  const cardHolderName = pickString(selected, (profile) =>
    cardHolderSameAsShipping(profile) ? shippingFullName(profile) : (profile.cardHolderName ?? "").trim(),
  );
  const paymentBrand = pickString(selected, (profile) => profile.payment.brand);
  const paymentNumber = pickString(selected, (profile) => profile.payment.number);
  const paymentExpiry = pickString(selected, (profile) => profile.payment.expiry);
  const paymentCvv = pickString(selected, (profile) => profile.payment.cvv);
  const billingSame = pickBool(selected, billingSameAsShipping, true);

  draft.profileName = profileName.value;
  draft.email = email.value;
  draft.phone = phone.mixed ? "" : formatUsPhone(phone.value);
  draft.accountSite = accountSite.value;
  draft.oneCheckoutPerProfile = oneCheckout.value;
  draft.categoryId = category.mixed ? PROFILE_UNCATEGORIZED_CATEGORY_ID : category.value;
  draft.accountStatus = (accountStatus.mixed ? "good" : accountStatus.value) as AccountReviewStatus;
  draft.cardHolderSameAsShipping = cardHolderSame.value;
  draft.cardHolderName = cardHolderName.value;
  draft.payment = {
    ...draft.payment,
    brand: paymentBrand.mixed ? "Visa" : paymentBrand.value,
    number: paymentNumber.value,
    expiry: paymentExpiry.value,
    cvv: paymentCvv.value,
  };
  draft.billingSameAsShipping = billingSame.value;

  const normalizedDraft = ensureProfileEditorFields(draft);
  const shippingName = pickString(selected, (profile) => resolveShippingNameParts(profile).first);
  const shippingLast = pickString(selected, (profile) => resolveShippingNameParts(profile).last);
  const shippingStreet = pickString(selected, (profile) => effectiveShippingAddress(profile).street);
  const shippingUnit = pickString(selected, (profile) => (effectiveShippingAddress(profile).unit ?? "").trim());
  const shippingCountry = pickString(selected, (profile) => effectiveShippingAddress(profile).country);
  const shippingState = pickString(selected, (profile) => effectiveShippingAddress(profile).state);
  const shippingCity = pickString(selected, (profile) => effectiveShippingAddress(profile).city);
  const shippingPostalCode = pickString(selected, (profile) => effectiveShippingAddress(profile).postalCode);

  if (billingSameAsShipping(normalizedDraft)) {
    normalizedDraft.name.first = shippingName.value;
    normalizedDraft.name.last = shippingLast.value;
    normalizedDraft.address.street = shippingStreet.value;
    normalizedDraft.address.unit = shippingUnit.value;
    normalizedDraft.address.country = shippingCountry.value;
    normalizedDraft.address.state = shippingState.value;
    normalizedDraft.address.city = shippingCity.value;
    normalizedDraft.address.postalCode = shippingPostalCode.value;
  } else {
    normalizedDraft.shippingName = normalizedDraft.shippingName ?? { first: "", last: "", full: "" };
    normalizedDraft.shippingAddress = normalizedDraft.shippingAddress ?? structuredClone(normalizedDraft.address);
    normalizedDraft.shippingName.first = shippingName.value;
    normalizedDraft.shippingName.last = shippingLast.value;
    normalizedDraft.shippingAddress.street = shippingStreet.value;
    normalizedDraft.shippingAddress.unit = shippingUnit.value;
    normalizedDraft.shippingAddress.country = shippingCountry.value;
    normalizedDraft.shippingAddress.state = shippingState.value;
    normalizedDraft.shippingAddress.city = shippingCity.value;
    normalizedDraft.shippingAddress.postalCode = shippingPostalCode.value;
  }

  const billingFirst = pickString(selected, (profile) => profile.name.first);
  const billingLast = pickString(selected, (profile) => profile.name.last);
  const billingStreet = pickString(selected, (profile) => profile.address.street);
  const billingUnit = pickString(selected, (profile) => (profile.address.unit ?? "").trim());
  const billingCountry = pickString(selected, (profile) => profile.address.country);
  const billingState = pickString(selected, (profile) => profile.address.state);
  const billingCity = pickString(selected, (profile) => profile.address.city);
  const billingPostalCode = pickString(selected, (profile) => profile.address.postalCode);

  normalizedDraft.name.first = billingFirst.value;
  normalizedDraft.name.last = billingLast.value;
  normalizedDraft.address.street = billingStreet.value;
  normalizedDraft.address.unit = billingUnit.value;
  normalizedDraft.address.country = billingCountry.value;
  normalizedDraft.address.state = billingState.value;
  normalizedDraft.address.city = billingCity.value;
  normalizedDraft.address.postalCode = billingPostalCode.value;

  const mixedFields: ProfileMixedFields = {
    profileName: profileName.mixed,
    email: email.mixed,
    phone: phone.mixed,
    accountSite: accountSite.mixed,
    oneCheckoutPerProfile: oneCheckout.mixed,
    categoryId: category.mixed,
    accountStatus: accountStatus.mixed,
    cardHolderSameAsShipping: cardHolderSame.mixed,
    cardHolderName: cardHolderName.mixed,
    paymentBrand: paymentBrand.mixed,
    paymentNumber: paymentNumber.mixed,
    paymentExpiry: paymentExpiry.mixed,
    paymentCvv: paymentCvv.mixed,
    shippingFirstName: shippingName.mixed,
    shippingLastName: shippingLast.mixed,
    shippingStreet: shippingStreet.mixed,
    shippingUnit: shippingUnit.mixed,
    shippingCountry: shippingCountry.mixed,
    shippingState: shippingState.mixed,
    shippingCity: shippingCity.mixed,
    shippingPostalCode: shippingPostalCode.mixed,
    billingSameAsShipping: billingSame.mixed,
    billingFirstName: billingFirst.mixed,
    billingLastName: billingLast.mixed,
    billingStreet: billingStreet.mixed,
    billingUnit: billingUnit.mixed,
    billingCountry: billingCountry.mixed,
    billingState: billingState.mixed,
    billingCity: billingCity.mixed,
    billingPostalCode: billingPostalCode.mixed,
  };

  return { draft: normalizedDraft, mixedFields };
}

export function applyProfileMassEditPatch(
  profile: Profile,
  draft: Profile,
  categoryId: string | null,
  touchedFields: ProfileTouchedFields,
  creditCards: CreditCard[],
): Profile {
  let next = ensureProfileEditorFields(structuredClone(profile));

  if (touchedFields.profileName) {
    next = updateProfileField(next, "profileName", draft.profileName ?? "");
  }
  if (touchedFields.email) {
    next = updateProfileField(next, "email", draft.email);
  }
  if (touchedFields.phone) {
    next = updateProfileField(next, "phone", normalizeUsPhone(draft.phone ?? ""));
  }
  if (touchedFields.accountSite) {
    next = updateProfileField(next, "accountSite", draft.accountSite ?? "");
  }
  if (touchedFields.oneCheckoutPerProfile) {
    next.oneCheckoutPerProfile = draft.oneCheckoutPerProfile !== false;
  }
  if (touchedFields.categoryId && categoryId) {
    next.categoryId = categoryId;
  }
  if (touchedFields.accountStatus) {
    next.accountStatus = draft.accountStatus;
  }
  if (touchedFields.cardHolderSameAsShipping) {
    next = setCardHolderSameAsShipping(next, draft.cardHolderSameAsShipping ?? true);
  }
  if (touchedFields.cardHolderName) {
    next = updateProfileField(next, "cardHolderName", draft.cardHolderName ?? "");
    next.cardHolderSameAsShipping = false;
  }
  if (touchedFields.paymentBrand) {
    next = updateProfilePaymentField(next, "payment.brand", draft.payment.brand, creditCards);
  }
  if (touchedFields.paymentNumber) {
    next = updateProfilePaymentField(next, "payment.number", draft.payment.number, creditCards);
  }
  if (touchedFields.paymentExpiry) {
    next = updateProfilePaymentField(next, "payment.expiry", draft.payment.expiry, creditCards);
  }
  if (touchedFields.paymentCvv) {
    next = updateProfilePaymentField(next, "payment.cvv", draft.payment.cvv, creditCards);
  }
  if (touchedFields.billingSameAsShipping) {
    next = setBillingSameAsShipping(next, draft.billingSameAsShipping !== false);
  }

  if (touchedFields.shippingFirstName) {
    next = updateProfileField(next, shippingFieldPath(next, "first"), resolveShippingNameParts(draft).first);
  }
  if (touchedFields.shippingLastName) {
    next = updateProfileField(next, shippingFieldPath(next, "last"), resolveShippingNameParts(draft).last);
  }
  if (touchedFields.shippingStreet) {
    next = updateProfileField(next, shippingAddressPath(next, "street"), effectiveShippingAddress(draft).street);
  }
  if (touchedFields.shippingUnit) {
    next = updateProfileField(next, shippingAddressPath(next, "unit"), effectiveShippingAddress(draft).unit ?? "");
  }
  if (touchedFields.shippingCountry) {
    next = updateProfileField(next, shippingAddressPath(next, "country"), effectiveShippingAddress(draft).country);
  }
  if (touchedFields.shippingState) {
    next = updateProfileField(next, shippingAddressPath(next, "state"), effectiveShippingAddress(draft).state);
  }
  if (touchedFields.shippingCity) {
    next = updateProfileField(next, shippingAddressPath(next, "city"), effectiveShippingAddress(draft).city);
  }
  if (touchedFields.shippingPostalCode) {
    next = updateProfileField(
      next,
      shippingAddressPath(next, "postalCode"),
      effectiveShippingAddress(draft).postalCode,
    );
  }

  if (touchedFields.billingFirstName) {
    next = updateProfileField(next, "name.first", draft.name.first);
  }
  if (touchedFields.billingLastName) {
    next = updateProfileField(next, "name.last", draft.name.last);
  }
  if (touchedFields.billingStreet) {
    next = updateProfileField(next, "address.street", draft.address.street);
  }
  if (touchedFields.billingUnit) {
    next = updateProfileField(next, "address.unit", draft.address.unit ?? "");
  }
  if (touchedFields.billingCountry) {
    next = updateProfileField(next, "address.country", draft.address.country);
  }
  if (touchedFields.billingState) {
    next = updateProfileField(next, "address.state", draft.address.state);
  }
  if (touchedFields.billingCity) {
    next = updateProfileField(next, "address.city", draft.address.city);
  }
  if (touchedFields.billingPostalCode) {
    next = updateProfileField(next, "address.postalCode", draft.address.postalCode);
  }

  return ensureProfileEditorFields(next);
}

export function hasProfileMassEditChanges(touchedFields: ProfileTouchedFields): boolean {
  return PROFILE_EDIT_FIELDS.some((field) => touchedFields[field]);
}

function emptyMassEditProfile(): Profile {
  return ensureProfileEditorFields({
    id: crypto.randomUUID(),
    locale: "en_US",
    email: "",
    profileName: "",
    phone: "",
    categoryId: PROFILE_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    notes: "",
    name: { first: "", last: "", full: "" },
    address: { street: "", city: "", state: "", postalCode: "", country: "US" },
    payment: { number: "", expiry: "", cvv: "", brand: "Visa" },
    credentialIds: [],
    logins: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}
