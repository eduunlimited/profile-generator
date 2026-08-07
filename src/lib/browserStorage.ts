import { billingAddressLines, billingFullName, resolveProfileDisplayName } from "./profileNameUtils";
import { normalizeProfile } from "./profileEmailUtils";
import { formatUsPhone } from "./phoneUtils";
import { parseCardNumberDigits, resolveCreditCardProfileLabel } from "./creditCardUtils";
import { normalizeMasterProfile, sortMasterProfiles } from "./masterProfileUtils";
import { normalizeCredential, type StoredCredential } from "./credentialUtils";
import { normalizeCreditCard, type StoredCreditCard } from "./creditCardUtils";
import { RETIRED_BUILTIN_JIG_IDS } from "./presets";
import { categoryIdsInUse, createUncategorizedCategory, sortAccountCategories, UNCATEGORIZED_CATEGORY_ID } from "./accountCategoryUtils";
import {
  cardCategoryIdsInUse,
  createUncategorizedCardCategory,
  sortCardCategories,
  CARD_UNCATEGORIZED_CATEGORY_ID,
} from "./cardCategoryUtils";
import {
  createUncategorizedProfileCategory,
  profileCategoryIdsInUse,
  sortProfileCategories,
  PROFILE_UNCATEGORIZED_CATEGORY_ID,
} from "./profileCategoryUtils";
import {
  readCachedMap,
  removeLegacyStorageKey,
  writeCachedMap,
} from "./localDataStore";
import type {
  AccountCategory,
  CardCategory,
  Credential,
  CreditCard,
  ExportTemplate,
  JigPreset,
  MasterProfile,
  Profile,
  ProfileCategory,
  ProfileSummary,
} from "./types";

const KEYS = {
  profiles: "profile-generator:profiles",
  jigPresets: "profile-generator:jig-presets",
  exportTemplates: "profile-generator:export-templates",
  masterProfiles: "profile-generator:master-profiles",
  masterProfileLegacy: "profile-generator:master-profile",
  creditCards: "profile-generator:credit-cards",
  credentials: "profile-generator:credentials",
  accountCategories: "profile-generator:account-categories",
  cardCategories: "profile-generator:card-categories",
  profileCategories: "profile-generator:profile-categories",
} as const;

function readMap<T>(key: string): Record<string, T> {
  return readCachedMap<T>(key);
}

function writeMap<T>(key: string, value: Record<string, T>) {
  writeCachedMap(key, value);
}

function readCredentialsMap(): Record<string, Credential> {
  const stored = readMap<StoredCredential>(KEYS.credentials);
  return Object.fromEntries(Object.entries(stored).map(([id, credential]) => [id, normalizeCredential(credential)]));
}

function readCreditCardsMap(): Record<string, CreditCard> {
  const stored = readMap<StoredCreditCard>(KEYS.creditCards);
  return Object.fromEntries(Object.entries(stored).map(([id, card]) => [id, normalizeCreditCard(card)]));
}

function maskCardNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 4) return digits;
  return `...${digits.slice(-4)}`;
}

function profileSummary(profile: Profile, cards: Record<string, CreditCard>, creds: Record<string, Credential>): ProfileSummary {
  const cardList = Object.values(cards);
  const payment = profile.payment;
  const sites =
    profile.accountSite?.trim() ||
    (profile.credentialIds ?? [])
      .map((id) => creds[id]?.site)
      .filter(Boolean)
      .join(", ");
  const displayName = resolveProfileDisplayName(profile);
  const billingName = billingFullName(profile);
  const addressLines = billingAddressLines(profile);
  const profileEmail = profile.email?.trim() || profile.logins[0]?.email?.trim() || "";

  return {
    id: profile.id,
    name: displayName,
    email: profileEmail,
    city: profile.address.city,
    state: profile.address.state,
    billingFullName: billingName,
    billingEmail: profileEmail,
    billingPhone: formatUsPhone(profile.phone ?? ""),
    billingAddressLine1: addressLines.line1,
    billingAddressLine2: addressLines.line2,
    billingAddressLine3: addressLines.line3,
    cardNumberMasked: maskCardNumber(payment.number),
    cardBrand: payment.brand,
    accounts: sites || "None",
    accountSite: profile.accountSite?.trim() ?? "",
    masterProfileId: profile.masterProfileId,
    jigPresetName: profile.jigPresetName,
    creditCardLabel: resolveCreditCardProfileLabel(profile, cardList),
    creditCardId: profile.creditCardId,
    paymentNumber: parseCardNumberDigits(payment.number),
    credentialSites: sites || undefined,
    credentialIds: profile.credentialIds ?? [],
    categoryId: profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: profile.accountStatus === "not_good" ? "not_good" : "good",
    notes: profile.notes ?? "",
    createdAt: profile.createdAt,
  };
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const profiles = Object.values(readMap<Profile>(KEYS.profiles));
  const cards = readCreditCardsMap();
  const creds = readCredentialsMap();
  return profiles.map((profile) => profileSummary(profile, cards, creds));
}

export async function getProfile(id: string): Promise<Profile> {
  const profile = readMap<Profile>(KEYS.profiles)[id];
  if (!profile) throw new Error("Profile not found.");
  return normalizeProfile({
    ...profile,
    credentialIds: profile.credentialIds ?? [],
  });
}

export async function saveProfile(profile: Profile): Promise<void> {
  const profiles = readMap<Profile>(KEYS.profiles);
  const normalized = normalizeProfile(profile);
  ensureProfileCategoryRecord(normalized.categoryId);
  profiles[normalized.id] = normalized;
  writeMap(KEYS.profiles, profiles);
  pruneEmptyProfileCategories();
}

export async function saveProfiles(profilesToSave: Profile[]): Promise<void> {
  const profiles = readMap<Profile>(KEYS.profiles);
  for (const profile of profilesToSave) {
    const normalized = normalizeProfile(profile);
    ensureProfileCategoryRecord(normalized.categoryId);
    profiles[normalized.id] = normalized;
  }
  writeMap(KEYS.profiles, profiles);
  pruneEmptyProfileCategories();
}

export async function deleteProfile(id: string): Promise<void> {
  const profiles = readMap<Profile>(KEYS.profiles);
  delete profiles[id];
  writeMap(KEYS.profiles, profiles);
  pruneEmptyProfileCategories();
}

export async function listJigPresets(): Promise<JigPreset[]> {
  return Object.values(readMap<JigPreset>(KEYS.jigPresets));
}

export async function saveJigPreset(preset: JigPreset): Promise<void> {
  const presets = readMap<JigPreset>(KEYS.jigPresets);
  presets[preset.id] = preset;
  writeMap(KEYS.jigPresets, presets);
}

export async function deleteJigPreset(id: string): Promise<void> {
  const presets = readMap<JigPreset>(KEYS.jigPresets);
  delete presets[id];
  writeMap(KEYS.jigPresets, presets);
}

export async function listExportTemplates(): Promise<ExportTemplate[]> {
  return Object.values(readMap<ExportTemplate>(KEYS.exportTemplates));
}

export async function saveExportTemplate(template: ExportTemplate): Promise<void> {
  const templates = readMap<ExportTemplate>(KEYS.exportTemplates);
  templates[template.id] = template;
  writeMap(KEYS.exportTemplates, templates);
}

export async function deleteExportTemplate(id: string): Promise<void> {
  const templates = readMap<ExportTemplate>(KEYS.exportTemplates);
  delete templates[id];
  writeMap(KEYS.exportTemplates, templates);
}

export async function seedDefaults(
  jigPresets: JigPreset[],
  exportTemplates: ExportTemplate[],
): Promise<void> {
  const storedPresets = readMap<JigPreset>(KEYS.jigPresets);
  let presetsChanged = false;

  for (const id of RETIRED_BUILTIN_JIG_IDS) {
    if (storedPresets[id]) {
      delete storedPresets[id];
      presetsChanged = true;
    }
  }

  for (const preset of jigPresets) {
    const existing = storedPresets[preset.id];
    if (!existing || existing.name !== preset.name) {
      storedPresets[preset.id] = preset;
      presetsChanged = true;
    }
  }

  if (presetsChanged || Object.keys(storedPresets).length === 0) {
    writeMap(KEYS.jigPresets, storedPresets);
  }

  if (Object.keys(readMap<ExportTemplate>(KEYS.exportTemplates)).length === 0) {
    const templates = readMap<ExportTemplate>(KEYS.exportTemplates);
    for (const template of exportTemplates) templates[template.id] = template;
    writeMap(KEYS.exportTemplates, templates);
  }

  ensureAccountCategoriesStored();
  ensureCardCategoriesStored();
  ensureProfileCategoriesStored();
}

function readAccountCategoriesMap(): Record<string, AccountCategory> {
  return readMap<AccountCategory>(KEYS.accountCategories);
}

function ensureAccountCategoriesStored(): void {
  readAccountCategoriesMap();
}

function ensureCategoryRecord(categoryId: string): void {
  const categories = readAccountCategoriesMap();
  if (categories[categoryId]) {
    return;
  }
  if (categoryId === UNCATEGORIZED_CATEGORY_ID) {
    categories[categoryId] = createUncategorizedCategory();
    writeMap(KEYS.accountCategories, categories);
  }
}

function pruneEmptyAccountCategories(): void {
  const creds = readCredentialsMap();
  const inUse = categoryIdsInUse(Object.values(creds));
  const categories = readAccountCategoriesMap();
  let changed = false;
  for (const id of Object.keys(categories)) {
    if (!inUse.has(id)) {
      delete categories[id];
      changed = true;
    }
  }
  if (changed) {
    writeMap(KEYS.accountCategories, categories);
  }
}

export async function listAccountCategories(): Promise<AccountCategory[]> {
  pruneEmptyAccountCategories();
  return sortAccountCategories(Object.values(readAccountCategoriesMap()));
}

export async function saveAccountCategory(category: AccountCategory): Promise<void> {
  const categories = readAccountCategoriesMap();
  categories[category.id] = category;
  writeMap(KEYS.accountCategories, categories);
}

export async function reorderAccountCategories(orderedIds: string[]): Promise<void> {
  const categories = readAccountCategoriesMap();
  let changed = false;

  orderedIds.forEach((id, index) => {
    const category = categories[id];
    if (!category || category.sortOrder === index) {
      return;
    }
    categories[id] = { ...category, sortOrder: index };
    changed = true;
  });

  if (changed) {
    writeMap(KEYS.accountCategories, categories);
  }
}

export async function deleteAccountCategory(id: string): Promise<void> {
  const categories = readAccountCategoriesMap();
  if (!categories[id]) {
    return;
  }

  const accountCount = Object.values(readCredentialsMap()).filter(
    (credential) => (credential.categoryId || UNCATEGORIZED_CATEGORY_ID) === id,
  ).length;
  if (accountCount > 0) {
    throw new Error("Cannot delete a category that still has accounts.");
  }

  delete categories[id];
  writeMap(KEYS.accountCategories, categories);
}

function readCardCategoriesMap(): Record<string, CardCategory> {
  return readMap<CardCategory>(KEYS.cardCategories);
}

function ensureCardCategoriesStored(): void {
  readCardCategoriesMap();
}

function ensureCardCategoryRecord(categoryId: string): void {
  const categories = readCardCategoriesMap();
  if (categories[categoryId]) {
    return;
  }
  if (categoryId === CARD_UNCATEGORIZED_CATEGORY_ID) {
    categories[categoryId] = createUncategorizedCardCategory();
    writeMap(KEYS.cardCategories, categories);
  }
}

function pruneEmptyCardCategories(): void {
  const cards = readCreditCardsMap();
  const inUse = cardCategoryIdsInUse(Object.values(cards));
  const categories = readCardCategoriesMap();
  let changed = false;
  for (const id of Object.keys(categories)) {
    if (!inUse.has(id)) {
      delete categories[id];
      changed = true;
    }
  }
  if (changed) {
    writeMap(KEYS.cardCategories, categories);
  }
}

export async function listCardCategories(): Promise<CardCategory[]> {
  pruneEmptyCardCategories();
  return sortCardCategories(Object.values(readCardCategoriesMap()));
}

export async function saveCardCategory(category: CardCategory): Promise<void> {
  const categories = readCardCategoriesMap();
  categories[category.id] = category;
  writeMap(KEYS.cardCategories, categories);
}

export async function reorderCardCategories(orderedIds: string[]): Promise<void> {
  const categories = readCardCategoriesMap();
  let changed = false;

  orderedIds.forEach((id, index) => {
    const category = categories[id];
    if (!category || category.sortOrder === index) {
      return;
    }
    categories[id] = { ...category, sortOrder: index };
    changed = true;
  });

  if (changed) {
    writeMap(KEYS.cardCategories, categories);
  }
}

export async function deleteCardCategory(id: string): Promise<void> {
  const categories = readCardCategoriesMap();
  if (!categories[id]) {
    return;
  }

  const cardCount = Object.values(readCreditCardsMap()).filter(
    (card) => (card.categoryId || CARD_UNCATEGORIZED_CATEGORY_ID) === id,
  ).length;
  if (cardCount > 0) {
    throw new Error("Cannot delete a category that still has cards.");
  }

  delete categories[id];
  writeMap(KEYS.cardCategories, categories);
}

function readProfileCategoriesMap(): Record<string, ProfileCategory> {
  return readMap<ProfileCategory>(KEYS.profileCategories);
}

function ensureProfileCategoriesStored(): void {
  readProfileCategoriesMap();
}

function ensureProfileCategoryRecord(categoryId: string): void {
  const categories = readProfileCategoriesMap();
  if (categories[categoryId]) {
    return;
  }
  if (categoryId === PROFILE_UNCATEGORIZED_CATEGORY_ID) {
    categories[categoryId] = createUncategorizedProfileCategory();
    writeMap(KEYS.profileCategories, categories);
  }
}

function pruneEmptyProfileCategories(): void {
  const profiles = Object.values(readMap<Profile>(KEYS.profiles));
  const cards = readCreditCardsMap();
  const creds = readCredentialsMap();
  const summaries = profiles.map((profile) => profileSummary(profile, cards, creds));
  const inUse = profileCategoryIdsInUse(summaries);
  const categories = readProfileCategoriesMap();
  let changed = false;
  for (const id of Object.keys(categories)) {
    if (!inUse.has(id)) {
      delete categories[id];
      changed = true;
    }
  }
  if (changed) {
    writeMap(KEYS.profileCategories, categories);
  }
}

export async function listProfileCategories(): Promise<ProfileCategory[]> {
  pruneEmptyProfileCategories();
  return sortProfileCategories(Object.values(readProfileCategoriesMap()));
}

export async function saveProfileCategory(category: ProfileCategory): Promise<void> {
  const categories = readProfileCategoriesMap();
  categories[category.id] = category;
  writeMap(KEYS.profileCategories, categories);
}

export async function reorderProfileCategories(orderedIds: string[]): Promise<void> {
  const categories = readProfileCategoriesMap();
  let changed = false;

  orderedIds.forEach((id, index) => {
    const category = categories[id];
    if (!category || category.sortOrder === index) {
      return;
    }
    categories[id] = { ...category, sortOrder: index };
    changed = true;
  });

  if (changed) {
    writeMap(KEYS.profileCategories, categories);
  }
}

export async function deleteProfileCategory(id: string): Promise<void> {
  const categories = readProfileCategoriesMap();
  if (!categories[id]) {
    return;
  }

  const profileCount = Object.values(readMap<Profile>(KEYS.profiles)).filter(
    (profile) => (profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID) === id,
  ).length;
  if (profileCount > 0) {
    throw new Error("Cannot delete a category that still has profiles.");
  }

  delete categories[id];
  writeMap(KEYS.profileCategories, categories);
}

function migrateMasterProfilesMap(): Record<string, MasterProfile> {
  let map = readMap<MasterProfile>(KEYS.masterProfiles);
  if (Object.keys(map).length > 0) {
    return map;
  }

  const legacyRaw = localStorage.getItem(KEYS.masterProfileLegacy);
  if (!legacyRaw) {
    return map;
  }

  try {
    const legacy = normalizeMasterProfile(JSON.parse(legacyRaw) as Partial<MasterProfile>);
    map = { [legacy.id]: legacy };
    removeLegacyStorageKey(KEYS.masterProfileLegacy);
    writeMap(KEYS.masterProfiles, map);
  } catch {
    map = {};
  }

  return map;
}

export async function listMasterProfiles(): Promise<MasterProfile[]> {
  const map = migrateMasterProfilesMap();
  return sortMasterProfiles(Object.values(map).map((master) => normalizeMasterProfile(master)));
}

export async function saveMasterProfile(master: MasterProfile): Promise<void> {
  const normalized = normalizeMasterProfile(master);
  const map = migrateMasterProfilesMap();
  map[normalized.id] = normalized;
  writeMap(KEYS.masterProfiles, map);
}

export async function deleteMasterProfile(id: string): Promise<void> {
  const map = migrateMasterProfilesMap();
  delete map[id];
  writeMap(KEYS.masterProfiles, map);
}

export async function listCreditCards(): Promise<CreditCard[]> {
  return Object.values(readCreditCardsMap());
}

export async function saveCreditCard(card: CreditCard): Promise<void> {
  const normalized = normalizeCreditCard(card);
  ensureCardCategoryRecord(normalized.categoryId);
  const cards = readCreditCardsMap();
  cards[normalized.id] = normalized;
  writeMap(KEYS.creditCards, cards);
  pruneEmptyCardCategories();
}

export async function deleteCreditCard(id: string): Promise<void> {
  const cards = readCreditCardsMap();
  delete cards[id];
  writeMap(KEYS.creditCards, cards);
  pruneEmptyCardCategories();
}

export async function importCreditCards(cardsToImport: CreditCard[]): Promise<void> {
  const cards = readCreditCardsMap();
  for (const card of cardsToImport) {
    const normalized = normalizeCreditCard(card);
    ensureCardCategoryRecord(normalized.categoryId);
    cards[normalized.id] = normalized;
  }
  writeMap(KEYS.creditCards, cards);
  pruneEmptyCardCategories();
}

export async function listCredentials(): Promise<Credential[]> {
  return Object.values(readCredentialsMap());
}

export async function saveCredential(credential: Credential): Promise<void> {
  const normalized = normalizeCredential(credential);
  ensureCategoryRecord(normalized.categoryId);
  const creds = readCredentialsMap();
  creds[normalized.id] = normalized;
  writeMap(KEYS.credentials, creds);
  pruneEmptyAccountCategories();
}

export async function deleteCredential(id: string): Promise<void> {
  const creds = readCredentialsMap();
  delete creds[id];
  writeMap(KEYS.credentials, creds);
  pruneEmptyAccountCategories();
}

export async function importCredentials(credentialsToImport: Credential[]): Promise<void> {
  const creds = readCredentialsMap();
  for (const credential of credentialsToImport) {
    const normalized = normalizeCredential(credential);
    ensureCategoryRecord(normalized.categoryId);
    creds[normalized.id] = normalized;
  }
  writeMap(KEYS.credentials, creds);
  pruneEmptyAccountCategories();
}
