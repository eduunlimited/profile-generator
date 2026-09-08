import { billingAddressLines, billingFullName, resolveProfileDisplayName } from "./profileNameUtils";
import { normalizeProfile } from "./profileEmailUtils";
import { formatUsPhone } from "./phoneUtils";
import { parseCardNumberDigits, profileHasPaymentCard, resolveCreditCardProfileLabel } from "./creditCardUtils";
import { normalizeMasterProfile, sortMasterProfiles } from "./masterProfileUtils";
import { normalizeCredential, type StoredCredential } from "./credentialUtils";
import { normalizeCreditCard, type StoredCreditCard } from "./creditCardUtils";
import { normalizePoolEmail, type StoredPoolEmail } from "./emailPoolUtils";
import {
  createUncategorizedEmailCategory,
  sortEmailCategories,
  EMAIL_UNCATEGORIZED_CATEGORY_ID,
} from "./emailCategoryUtils";
import { RETIRED_BUILTIN_JIG_IDS } from "./presets";
import { createUncategorizedCategory, sortAccountCategories, UNCATEGORIZED_CATEGORY_ID } from "./accountCategoryUtils";
import {
  createUncategorizedCardCategory,
  sortCardCategories,
  CARD_UNCATEGORIZED_CATEGORY_ID,
} from "./cardCategoryUtils";
import {
  createMissingProfileCategory,
  createUncategorizedProfileCategory,
  sortProfileCategories,
  PROFILE_UNCATEGORIZED_CATEGORY_ID,
} from "./profileCategoryUtils";
import { toStoredImapHeaders } from "./imapInbox";
import { canonicalizeOrderId, orderRecordId } from "./orderEmail/classify";
import { finalizeParsedOrder, upsertParsedOrders } from "./orderEmail/merge";
import { repairUtf8Mojibake } from "./orderEmail/parse";
import {
  ensureDataKey,
  flushLocalDataWrites,
  readCachedMap,
  removeLegacyStorageKey,
  writeCachedMap,
} from "./localDataStore";
import type {
  AccountCategory,
  CardCategory,
  Credential,
  CreditCard,
  EmailCategory,
  ExportTemplate,
  ImapAccount,
  ImapSettings,
  JigPreset,
  MasterProfile,
  PoolEmail,
  Profile,
  ProfileCategory,
  ProfileSummary,
  StoredImapMessage,
  OrderAnalysisRecord,
  OrderRetailer,
  ParsedOrder,
} from "./types";
import type { ProxyEntry, ProxyGroup } from "../modules/browserSessions/types";
import {
  PROXY_UNCATEGORIZED_GROUP_ID,
  createUncategorizedProxyGroup,
  sortProxyGroups,
} from "../modules/browserSessions/proxyGroupUtils";

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
  poolEmails: "profile-generator:pool-emails",
  emailCategories: "profile-generator:email-categories",
  profileCategories: "profile-generator:profile-categories",
  proxyPool: "profile-generator:proxy-pool",
  proxyGroups: "profile-generator:proxy-groups",
  proxyAssignments: "profile-generator:proxy-assignments",
  imapSettings: "profile-generator:imap-settings",
  imapMail: "profile-generator:imap-mail",
  orders: "profile-generator:orders",
  geocodioSettings: "profile-generator:geocodio-settings",
  openaiSettings: "profile-generator:openai-settings",
  orderAnalysis: "profile-generator:order-analysis",
  pythonPath: "profile-generator:python-path",
} as const;

function readMap<T>(key: string): Record<string, T> {
  return readCachedMap<T>(key);
}

function writeMap<T>(key: string, value: Record<string, T>) {
  void writeCachedMap(key, value);
}

async function persistMap(): Promise<void> {
  await flushLocalDataWrites();
}

function readCredentialsMap(): Record<string, Credential> {
  const stored = readMap<StoredCredential>(KEYS.credentials);
  return Object.fromEntries(Object.entries(stored).map(([id, credential]) => [id, normalizeCredential(credential)]));
}

function readCreditCardsMap(): Record<string, CreditCard> {
  const stored = readMap<StoredCreditCard>(KEYS.creditCards);
  return Object.fromEntries(Object.entries(stored).map(([id, card]) => [id, normalizeCreditCard(card)]));
}

function readPoolEmailsMap(): Record<string, PoolEmail> {
  const stored = readMap<StoredPoolEmail>(KEYS.poolEmails);
  return Object.fromEntries(Object.entries(stored).map(([id, email]) => [id, normalizePoolEmail(email)]));
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
  const hasPaymentCard = profileHasPaymentCard(profile);

  return {
    id: profile.id,
    name: displayName,
    email: profileEmail,
    city: profile.address.city,
    state: profile.address.state,
    postalCode: profile.address.postalCode,
    billingFullName: billingName,
    billingEmail: profileEmail,
    billingPhone: formatUsPhone(profile.phone ?? ""),
    billingAddressLine1: addressLines.line1,
    billingAddressLine2: addressLines.line2,
    billingAddressLine3: addressLines.line3,
    cardNumberMasked: hasPaymentCard ? maskCardNumber(payment.number) : "",
    cardBrand: hasPaymentCard && payment.brand.trim() ? payment.brand : "",
    accounts: sites || "None",
    accountSite: profile.accountSite?.trim() ?? "",
    masterProfileId: profile.masterProfileId,
    jigPresetName: profile.jigPresetName,
    nameJigPresetName: profile.nameJigPresetName,
    addressJigPresetName: profile.addressJigPresetName,
    creditCardLabel: resolveCreditCardProfileLabel(profile, cardList),
    creditCardId: profile.creditCardId,
    emailPoolId: profile.emailPoolId,
    paymentNumber: parseCardNumberDigits(payment.number),
    credentialSites: sites || undefined,
    credentialIds: profile.credentialIds ?? [],
    categoryId: profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: profile.accountStatus === "not_good" ? "not_good" : "good",
    notes: profile.notes ?? "",
    createdAt: profile.createdAt,
    addressCheckStatus: profile.addressCheck?.status,
    addressCheckMessage: profile.addressCheck?.message,
    addressCheckDisplayLabel: profile.addressCheck?.displayLabel,
    addressMasterMatch: profile.addressCheck?.masterMatch,
  };
}

export async function summarizeProfiles(profiles: Profile[]): Promise<ProfileSummary[]> {
  const cards = readCreditCardsMap();
  const creds = readCredentialsMap();
  return profiles.map((profile) =>
    profileSummary(
      normalizeProfile({
        ...profile,
        credentialIds: profile.credentialIds ?? [],
      }),
      cards,
      creds,
    ),
  );
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  repairOrphanProfileCategoryIds();
  await persistMap();
  return summarizeProfiles(Object.values(readMap<Profile>(KEYS.profiles)));
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
  const normalized = normalizeProfile({
    ...profile,
    categoryId: resolveStoredProfileCategoryId(profile.categoryId),
  });
  ensureProfileCategoryRecord(normalized.categoryId);
  profiles[normalized.id] = normalized;
  writeMap(KEYS.profiles, profiles);
  await persistMap();
}

export async function saveProfiles(profilesToSave: Profile[]): Promise<void> {
  const profiles = readMap<Profile>(KEYS.profiles);
  for (const profile of profilesToSave) {
    const normalized = normalizeProfile({
      ...profile,
      categoryId: resolveStoredProfileCategoryId(profile.categoryId),
    });
    ensureProfileCategoryRecord(normalized.categoryId);
    profiles[normalized.id] = normalized;
  }
  writeMap(KEYS.profiles, profiles);
  await persistMap();
}

export async function deleteProfile(id: string): Promise<void> {
  const profiles = readMap<Profile>(KEYS.profiles);
  delete profiles[id];
  writeMap(KEYS.profiles, profiles);
  await persistMap();
}

export async function loadAllProfiles(): Promise<Profile[]> {
  const profiles = Object.values(readMap<Profile>(KEYS.profiles));
  return profiles.map((profile) =>
    normalizeProfile({
      ...profile,
      credentialIds: profile.credentialIds ?? [],
    }),
  );
}

export async function replaceAllProfiles(profilesToRestore: Profile[]): Promise<void> {
  const profiles: Record<string, Profile> = {};
  for (const profile of profilesToRestore) {
    const normalized = normalizeProfile({
      ...profile,
      credentialIds: profile.credentialIds ?? [],
      categoryId: resolveStoredProfileCategoryId(profile.categoryId),
    });
    ensureProfileCategoryRecord(normalized.categoryId);
    profiles[normalized.id] = normalized;
  }
  writeMap(KEYS.profiles, profiles);
  await persistMap();
}

export async function listJigPresets(): Promise<JigPreset[]> {
  return Object.values(readMap<JigPreset>(KEYS.jigPresets));
}

export async function saveJigPreset(preset: JigPreset): Promise<void> {
  const presets = readMap<JigPreset>(KEYS.jigPresets);
  presets[preset.id] = preset;
  writeMap(KEYS.jigPresets, presets);
  await persistMap();
}

export async function deleteJigPreset(id: string): Promise<void> {
  const presets = readMap<JigPreset>(KEYS.jigPresets);
  delete presets[id];
  writeMap(KEYS.jigPresets, presets);
  await persistMap();
}

export async function listExportTemplates(): Promise<ExportTemplate[]> {
  return Object.values(readMap<ExportTemplate>(KEYS.exportTemplates));
}

export async function saveExportTemplate(template: ExportTemplate): Promise<void> {
  const templates = readMap<ExportTemplate>(KEYS.exportTemplates);
  templates[template.id] = template;
  writeMap(KEYS.exportTemplates, templates);
  await persistMap();
}

export async function deleteExportTemplate(id: string): Promise<void> {
  const templates = readMap<ExportTemplate>(KEYS.exportTemplates);
  delete templates[id];
  writeMap(KEYS.exportTemplates, templates);
  await persistMap();
}

export async function replaceAllJigPresets(presetsToRestore: JigPreset[]): Promise<void> {
  const presets: Record<string, JigPreset> = {};
  for (const preset of presetsToRestore) {
    if (preset?.id) presets[preset.id] = preset;
  }
  writeMap(KEYS.jigPresets, presets);
  await persistMap();
}

export async function replaceAllExportTemplates(templatesToRestore: ExportTemplate[]): Promise<void> {
  const templates: Record<string, ExportTemplate> = {};
  for (const template of templatesToRestore) {
    if (template?.id) templates[template.id] = template;
  }
  writeMap(KEYS.exportTemplates, templates);
  await persistMap();
}

export async function replaceAllOrderAnalysis(recordsToRestore: OrderAnalysisRecord[]): Promise<void> {
  const map: Record<string, OrderAnalysisRecord> = {};
  for (const record of recordsToRestore) {
    const normalized = normalizeOrderAnalysis(record);
    if (normalized) map[analysisStorageKey(normalized.site, normalized.email)] = normalized;
  }
  writeMap(KEYS.orderAnalysis, map);
  await persistMap();
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
  ensureEmailCategoriesStored();
  ensureProfileCategoriesStored();
  await persistMap();
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

export async function listAccountCategories(): Promise<AccountCategory[]> {
  return sortAccountCategories(Object.values(readAccountCategoriesMap()));
}

export async function saveAccountCategory(category: AccountCategory): Promise<void> {
  const categories = readAccountCategoriesMap();
  categories[category.id] = category;
  writeMap(KEYS.accountCategories, categories);
  await persistMap();
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
    await persistMap();
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
  await persistMap();
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
    return;
  }
  categories[categoryId] = {
    id: categoryId,
    name: "Missing category",
    createdAt: new Date(0).toISOString(),
  };
  writeMap(KEYS.cardCategories, categories);
}

function resolveStoredCardCategoryId(categoryId: string): string {
  return categoryId?.trim() || CARD_UNCATEGORIZED_CATEGORY_ID;
}

function repairOrphanCardCategoryIds(): void {
  const categories = readCardCategoriesMap();
  const cards = readCreditCardsMap();
  let cardsChanged = false;
  let categoriesChanged = false;
  let needsUncategorized = false;

  for (const [id, card] of Object.entries(cards)) {
    const categoryId = card.categoryId?.trim() || CARD_UNCATEGORIZED_CATEGORY_ID;
    if (categoryId === CARD_UNCATEGORIZED_CATEGORY_ID) {
      if (card.categoryId !== CARD_UNCATEGORIZED_CATEGORY_ID) {
        cards[id] = { ...card, categoryId: CARD_UNCATEGORIZED_CATEGORY_ID };
        cardsChanged = true;
      }
      needsUncategorized = true;
      continue;
    }
    if (!categories[categoryId]) {
      categories[categoryId] = {
        id: categoryId,
        name: "Missing category",
        createdAt: new Date(0).toISOString(),
      };
      categoriesChanged = true;
    }
  }

  if (cardsChanged) {
    writeMap(KEYS.creditCards, cards);
  }
  if (categoriesChanged) {
    writeMap(KEYS.cardCategories, categories);
  }
  if (needsUncategorized) {
    ensureCardCategoryRecord(CARD_UNCATEGORIZED_CATEGORY_ID);
  }
}

export async function listCardCategories(): Promise<CardCategory[]> {
  repairOrphanCardCategoryIds();
  await persistMap();
  return sortCardCategories(Object.values(readCardCategoriesMap()));
}

export async function saveCardCategory(category: CardCategory): Promise<void> {
  const categories = readCardCategoriesMap();
  categories[category.id] = category;
  writeMap(KEYS.cardCategories, categories);
  await persistMap();
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
    await persistMap();
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
  await persistMap();
}

function readEmailCategoriesMap(): Record<string, EmailCategory> {
  return readMap<EmailCategory>(KEYS.emailCategories);
}

function ensureEmailCategoriesStored(): void {
  readEmailCategoriesMap();
}

function ensureEmailCategoryRecord(categoryId: string): void {
  const categories = readEmailCategoriesMap();
  if (categories[categoryId]) {
    return;
  }
  if (categoryId === EMAIL_UNCATEGORIZED_CATEGORY_ID) {
    categories[categoryId] = createUncategorizedEmailCategory();
    writeMap(KEYS.emailCategories, categories);
    return;
  }
  categories[categoryId] = {
    id: categoryId,
    name: "Missing category",
    createdAt: new Date(0).toISOString(),
  };
  writeMap(KEYS.emailCategories, categories);
}

function resolveStoredEmailCategoryId(categoryId: string): string {
  return categoryId?.trim() || EMAIL_UNCATEGORIZED_CATEGORY_ID;
}

function repairOrphanEmailCategoryIds(): void {
  const categories = readEmailCategoriesMap();
  const emails = readPoolEmailsMap();
  let emailsChanged = false;
  let categoriesChanged = false;
  let needsUncategorized = false;

  for (const [id, email] of Object.entries(emails)) {
    const categoryId = email.categoryId?.trim() || EMAIL_UNCATEGORIZED_CATEGORY_ID;
    if (categoryId === EMAIL_UNCATEGORIZED_CATEGORY_ID) {
      if (email.categoryId !== EMAIL_UNCATEGORIZED_CATEGORY_ID) {
        emails[id] = { ...email, categoryId: EMAIL_UNCATEGORIZED_CATEGORY_ID };
        emailsChanged = true;
      }
      needsUncategorized = true;
      continue;
    }
    if (!categories[categoryId]) {
      categories[categoryId] = {
        id: categoryId,
        name: "Missing category",
        createdAt: new Date(0).toISOString(),
      };
      categoriesChanged = true;
    }
  }

  if (emailsChanged) {
    writeMap(KEYS.poolEmails, emails);
  }
  if (categoriesChanged) {
    writeMap(KEYS.emailCategories, categories);
  }
  if (needsUncategorized) {
    ensureEmailCategoryRecord(EMAIL_UNCATEGORIZED_CATEGORY_ID);
  }
}

export async function listEmailCategories(): Promise<EmailCategory[]> {
  repairOrphanEmailCategoryIds();
  await persistMap();
  return sortEmailCategories(Object.values(readEmailCategoriesMap()));
}

export async function saveEmailCategory(category: EmailCategory): Promise<void> {
  const categories = readEmailCategoriesMap();
  categories[category.id] = category;
  writeMap(KEYS.emailCategories, categories);
  await persistMap();
}

export async function reorderEmailCategories(orderedIds: string[]): Promise<void> {
  const categories = readEmailCategoriesMap();
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
    writeMap(KEYS.emailCategories, categories);
    await persistMap();
  }
}

export async function deleteEmailCategory(id: string): Promise<void> {
  const categories = readEmailCategoriesMap();
  if (!categories[id]) {
    return;
  }

  const emailCount = Object.values(readPoolEmailsMap()).filter(
    (email) => (email.categoryId || EMAIL_UNCATEGORIZED_CATEGORY_ID) === id,
  ).length;
  if (emailCount > 0) {
    throw new Error("Cannot delete a category that still has emails.");
  }

  delete categories[id];
  writeMap(KEYS.emailCategories, categories);
  await persistMap();
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
    return;
  }
  categories[categoryId] = createMissingProfileCategory(categoryId);
  writeMap(KEYS.profileCategories, categories);
}

function resolveStoredProfileCategoryId(categoryId: string): string {
  return categoryId?.trim() || PROFILE_UNCATEGORIZED_CATEGORY_ID;
}

function repairOrphanProfileCategoryIds(): void {
  const categories = readProfileCategoriesMap();
  const profiles = readMap<Profile>(KEYS.profiles);
  let profilesChanged = false;
  let categoriesChanged = false;
  let needsUncategorized = false;

  for (const [id, profile] of Object.entries(profiles)) {
    const categoryId = profile.categoryId?.trim() || PROFILE_UNCATEGORIZED_CATEGORY_ID;
    if (categoryId === PROFILE_UNCATEGORIZED_CATEGORY_ID) {
      if (profile.categoryId !== PROFILE_UNCATEGORIZED_CATEGORY_ID) {
        profiles[id] = { ...profile, categoryId: PROFILE_UNCATEGORIZED_CATEGORY_ID };
        profilesChanged = true;
      }
      needsUncategorized = true;
      continue;
    }
    if (!categories[categoryId]) {
      categories[categoryId] = createMissingProfileCategory(categoryId);
      categoriesChanged = true;
    }
  }

  if (profilesChanged) {
    writeMap(KEYS.profiles, profiles);
  }
  if (categoriesChanged) {
    writeMap(KEYS.profileCategories, categories);
  }
  if (needsUncategorized) {
    ensureProfileCategoryRecord(PROFILE_UNCATEGORIZED_CATEGORY_ID);
  }
}

export async function listProfileCategories(): Promise<ProfileCategory[]> {
  repairOrphanProfileCategoryIds();
  await persistMap();
  return sortProfileCategories(Object.values(readProfileCategoriesMap()));
}

export async function saveProfileCategory(category: ProfileCategory): Promise<void> {
  const categories = readProfileCategoriesMap();
  categories[category.id] = category;
  writeMap(KEYS.profileCategories, categories);
  await persistMap();
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
    await persistMap();
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
  await persistMap();
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
  await persistMap();
}

export async function deleteMasterProfile(id: string): Promise<void> {
  const map = migrateMasterProfilesMap();
  delete map[id];
  writeMap(KEYS.masterProfiles, map);
  await persistMap();
}

export async function replaceAllMasterProfiles(mastersToRestore: MasterProfile[]): Promise<void> {
  const map: Record<string, MasterProfile> = {};
  for (const master of mastersToRestore) {
    const normalized = normalizeMasterProfile(master);
    map[normalized.id] = normalized;
  }
  writeMap(KEYS.masterProfiles, map);
  await persistMap();
}

export async function listCreditCards(): Promise<CreditCard[]> {
  repairOrphanCardCategoryIds();
  await persistMap();
  return Object.values(readCreditCardsMap());
}

export async function saveCreditCard(card: CreditCard): Promise<void> {
  const normalized = normalizeCreditCard({
    ...card,
    categoryId: resolveStoredCardCategoryId(card.categoryId),
  });
  ensureCardCategoryRecord(normalized.categoryId);
  const cards = readCreditCardsMap();
  cards[normalized.id] = normalized;
  writeMap(KEYS.creditCards, cards);
  await persistMap();
}

export async function deleteCreditCard(id: string): Promise<void> {
  const cards = readCreditCardsMap();
  delete cards[id];
  writeMap(KEYS.creditCards, cards);
  await persistMap();
}

export async function importCreditCards(cardsToImport: CreditCard[]): Promise<void> {
  const cards = readCreditCardsMap();
  for (const card of cardsToImport) {
    const normalized = normalizeCreditCard({
      ...card,
      categoryId: resolveStoredCardCategoryId(card.categoryId),
    });
    ensureCardCategoryRecord(normalized.categoryId);
    cards[normalized.id] = normalized;
  }
  writeMap(KEYS.creditCards, cards);
  await persistMap();
}

export async function replaceAllCreditCards(cardsToRestore: CreditCard[]): Promise<void> {
  const cards: Record<string, CreditCard> = {};
  for (const card of cardsToRestore) {
    const normalized = normalizeCreditCard({
      ...card,
      categoryId: resolveStoredCardCategoryId(card.categoryId),
    });
    ensureCardCategoryRecord(normalized.categoryId);
    cards[normalized.id] = normalized;
  }
  writeMap(KEYS.creditCards, cards);
  await persistMap();
}

export async function listPoolEmails(): Promise<PoolEmail[]> {
  repairOrphanEmailCategoryIds();
  await persistMap();
  return Object.values(readPoolEmailsMap());
}

export async function savePoolEmail(email: PoolEmail): Promise<void> {
  const normalized = normalizePoolEmail({
    ...email,
    categoryId: resolveStoredEmailCategoryId(email.categoryId),
  });
  ensureEmailCategoryRecord(normalized.categoryId);
  const emails = readPoolEmailsMap();
  emails[normalized.id] = normalized;
  writeMap(KEYS.poolEmails, emails);
  await persistMap();
}

export async function deletePoolEmail(id: string): Promise<void> {
  const emails = readPoolEmailsMap();
  delete emails[id];
  writeMap(KEYS.poolEmails, emails);
  await persistMap();
}

export async function importPoolEmails(emailsToImport: PoolEmail[]): Promise<void> {
  const emails = readPoolEmailsMap();
  for (const email of emailsToImport) {
    const normalized = normalizePoolEmail({
      ...email,
      categoryId: resolveStoredEmailCategoryId(email.categoryId),
    });
    ensureEmailCategoryRecord(normalized.categoryId);
    emails[normalized.id] = normalized;
  }
  writeMap(KEYS.poolEmails, emails);
  await persistMap();
}

export async function replaceAllPoolEmails(emailsToRestore: PoolEmail[]): Promise<void> {
  const emails: Record<string, PoolEmail> = {};
  for (const email of emailsToRestore) {
    const normalized = normalizePoolEmail({
      ...email,
      categoryId: resolveStoredEmailCategoryId(email.categoryId),
    });
    ensureEmailCategoryRecord(normalized.categoryId);
    emails[normalized.id] = normalized;
  }
  writeMap(KEYS.poolEmails, emails);
  await persistMap();
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
  await persistMap();
}

export async function deleteCredential(id: string): Promise<void> {
  const creds = readCredentialsMap();
  delete creds[id];
  writeMap(KEYS.credentials, creds);
  await persistMap();
}

export async function importCredentials(credentialsToImport: Credential[]): Promise<void> {
  const creds = readCredentialsMap();
  for (const credential of credentialsToImport) {
    const normalized = normalizeCredential(credential);
    ensureCategoryRecord(normalized.categoryId);
    creds[normalized.id] = normalized;
  }
  writeMap(KEYS.credentials, creds);
  await persistMap();
}

export async function replaceAllCredentials(credentialsToRestore: Credential[]): Promise<void> {
  const creds: Record<string, Credential> = {};
  for (const credential of credentialsToRestore) {
    const normalized = normalizeCredential(credential);
    ensureCategoryRecord(normalized.categoryId);
    creds[normalized.id] = normalized;
  }
  writeMap(KEYS.credentials, creds);
  await persistMap();
}

function normalizeProxyEntry(proxy: ProxyEntry): ProxyEntry {
  return {
    ...proxy,
    groupId: proxy.groupId || PROXY_UNCATEGORIZED_GROUP_ID,
    label: proxy.label?.trim() || undefined,
    host: proxy.host.trim(),
    username: proxy.username?.trim() || undefined,
    password: proxy.password?.trim() || undefined,
    protocol: proxy.protocol ?? "http",
    enabled: proxy.enabled !== false,
  };
}

function readProxyGroupsMap(): Record<string, ProxyGroup> {
  const stored = readMap<ProxyGroup>(KEYS.proxyGroups);
  if (!stored[PROXY_UNCATEGORIZED_GROUP_ID]) {
    stored[PROXY_UNCATEGORIZED_GROUP_ID] = createUncategorizedProxyGroup();
    writeMap(KEYS.proxyGroups, stored);
  }
  return stored;
}

export async function listProxyGroups(): Promise<ProxyGroup[]> {
  const groups = sortProxyGroups(Object.values(readProxyGroupsMap()));
  await persistMap();
  return groups;
}

export async function saveProxyGroups(groups: ProxyGroup[]): Promise<void> {
  const map = Object.fromEntries(groups.map((group) => [group.id, group]));
  if (!map[PROXY_UNCATEGORIZED_GROUP_ID]) {
    map[PROXY_UNCATEGORIZED_GROUP_ID] =
      readProxyGroupsMap()[PROXY_UNCATEGORIZED_GROUP_ID] ?? createUncategorizedProxyGroup();
  }
  writeMap(KEYS.proxyGroups, map);
  await persistMap();
}

export async function saveProxyGroup(group: ProxyGroup): Promise<void> {
  const groups = readProxyGroupsMap();
  groups[group.id] = group;
  writeMap(KEYS.proxyGroups, groups);
  await persistMap();
}

export async function deleteProxyGroup(id: string): Promise<void> {
  if (id === PROXY_UNCATEGORIZED_GROUP_ID) {
    throw new Error("Cannot delete the default proxy group.");
  }

  const groups = readProxyGroupsMap();
  if (!groups[id]) {
    return;
  }

  const proxies = readMap<ProxyEntry>(KEYS.proxyPool);
  for (const proxy of Object.values(proxies)) {
    if ((proxy.groupId || PROXY_UNCATEGORIZED_GROUP_ID) === id) {
      const normalized = normalizeProxyEntry(proxy);
      normalized.groupId = PROXY_UNCATEGORIZED_GROUP_ID;
      proxies[normalized.id] = normalized;
    }
  }
  writeMap(KEYS.proxyPool, proxies);

  delete groups[id];
  writeMap(KEYS.proxyGroups, groups);
  await persistMap();
}

export async function listProxies(): Promise<ProxyEntry[]> {
  const stored = readMap<ProxyEntry>(KEYS.proxyPool);
  return Object.values(stored)
    .map(normalizeProxyEntry)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function saveProxies(proxies: ProxyEntry[]): Promise<void> {
  const map = Object.fromEntries(proxies.map((proxy) => [proxy.id, normalizeProxyEntry(proxy)]));
  writeMap(KEYS.proxyPool, map);
  await persistMap();
}

export async function importProxies(proxiesToImport: ProxyEntry[]): Promise<void> {
  const stored = readMap<ProxyEntry>(KEYS.proxyPool);
  for (const proxy of proxiesToImport) {
    const normalized = normalizeProxyEntry(proxy);
    stored[normalized.id] = normalized;
  }
  writeMap(KEYS.proxyPool, stored);
  await persistMap();
}

export async function deleteProxy(id: string): Promise<void> {
  const stored = readMap<ProxyEntry>(KEYS.proxyPool);
  delete stored[id];
  writeMap(KEYS.proxyPool, stored);

  const assignments = readMap<string>(KEYS.proxyAssignments);
  let assignmentsChanged = false;
  for (const [accountId, proxyId] of Object.entries(assignments)) {
    if (proxyId === id) {
      delete assignments[accountId];
      assignmentsChanged = true;
    }
  }
  if (assignmentsChanged) {
    writeMap(KEYS.proxyAssignments, assignments);
  }
  await persistMap();
}

export async function listProxyAssignments(): Promise<Record<string, string>> {
  return readMap<string>(KEYS.proxyAssignments);
}

export async function saveProxyAssignments(assignments: Record<string, string>): Promise<void> {
  writeMap(KEYS.proxyAssignments, assignments);
  await persistMap();
}

export async function getPythonPath(): Promise<string | undefined> {
  const stored = localStorage.getItem(KEYS.pythonPath)?.trim();
  return stored || undefined;
}

export async function savePythonPath(pythonPath: string): Promise<void> {
  const trimmed = pythonPath.trim();
  if (trimmed) {
    localStorage.setItem(KEYS.pythonPath, trimmed);
  } else {
    localStorage.removeItem(KEYS.pythonPath);
  }
}

function normalizeImapAccount(id: string, raw: Partial<ImapAccount> & Partial<ImapSettings>): ImapAccount | null {
  const host = raw.host?.trim() ?? "";
  const username = raw.username?.trim() ?? "";
  if (!host && !username && !raw.password) return null;
  return {
    id: raw.id?.trim() || id,
    name: raw.name?.trim() || username || host || "IMAP key",
    host,
    port: Number.isFinite(raw.port) && (raw.port ?? 0) > 0 ? Number(raw.port) : 993,
    username,
    password: raw.password ?? "",
    mailbox: raw.mailbox?.trim() || "INBOX",
    createdAt: raw.createdAt || new Date().toISOString(),
    lastFetchedAt: raw.lastFetchedAt,
  };
}

function readImapAccountsMap(): Record<string, ImapAccount> {
  const stored = readMap<Partial<ImapAccount> & Partial<ImapSettings>>(KEYS.imapSettings);
  const accounts: Record<string, ImapAccount> = {};
  for (const [id, raw] of Object.entries(stored)) {
    const account = normalizeImapAccount(id, raw ?? {});
    if (account) accounts[account.id] = account;
  }
  return accounts;
}

export async function listImapAccounts(): Promise<ImapAccount[]> {
  await ensureDataKey(KEYS.imapSettings);
  return Object.values(readImapAccountsMap()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export async function saveImapAccount(account: ImapAccount): Promise<void> {
  const normalized = normalizeImapAccount(account.id, account);
  if (!normalized) return;
  const accounts = readImapAccountsMap();
  accounts[normalized.id] = normalized;
  writeMap(KEYS.imapSettings, accounts);
  await persistMap();
}

export async function deleteImapAccount(id: string): Promise<void> {
  const accounts = readImapAccountsMap();
  delete accounts[id];
  writeMap(KEYS.imapSettings, accounts);
  const mail = readMap<StoredImapMessage[]>(KEYS.imapMail);
  delete mail[id];
  writeMap(KEYS.imapMail, mail);
  await persistMap();
}

export async function getImapMail(accountId: string): Promise<StoredImapMessage[]> {
  await ensureDataKey(KEYS.imapMail);
  const stored = readMap<StoredImapMessage[]>(KEYS.imapMail)[accountId] ?? [];
  return stored
    .map((message) => ({
      ...toStoredImapHeaders(message, message.fetchedAt),
      dateMs: Number.isFinite(message.dateMs) ? message.dateMs : toStoredImapHeaders(message).dateMs,
    }))
    .sort((a, b) => b.dateMs - a.dateMs || b.uid - a.uid);
}

export async function saveImapMail(accountId: string, messages: StoredImapMessage[]): Promise<void> {
  await ensureDataKey(KEYS.imapMail);
  const mail = readMap<StoredImapMessage[]>(KEYS.imapMail);
  mail[accountId] = messages.map((message) => toStoredImapHeaders(message, message.fetchedAt));
  writeMap(KEYS.imapMail, mail);
  await persistMap();
}

export async function compactImapMailIfNeeded(): Promise<void> {
  await ensureDataKey(KEYS.imapMail);
  const mail = readMap<StoredImapMessage[]>(KEYS.imapMail);
  let changed = false;
  const next: Record<string, StoredImapMessage[]> = {};
  for (const [id, messages] of Object.entries(mail)) {
    const list = Array.isArray(messages) ? messages : [];
    if (list.some((message) => Boolean(message.htmlBody?.trim() || message.body?.trim()))) {
      changed = true;
    }
    next[id] = list
      .map((message) => toStoredImapHeaders(message, message.fetchedAt))
      .sort((a, b) => b.dateMs - a.dateMs || b.uid - a.uid);
  }
  if (!changed) return;
  writeMap(KEYS.imapMail, next);
  await persistMap();
}

function normalizeParsedOrder(raw: Partial<ParsedOrder> & { id?: string }): ParsedOrder | null {
  const retailer: OrderRetailer =
    raw.retailer === "walmart" || raw.retailer === "pokemon-center" ? raw.retailer : "target";
  const orderId = canonicalizeOrderId(raw.orderId ?? "") || canonicalizeOrderId(raw.id ?? "");
  if (!orderId) return null;
  const id = orderRecordId(retailer, orderId);
  const events = Array.isArray(raw.events)
    ? raw.events.filter((event) => event && event.uid && event.kind && event.accountId)
    : [];
  if (!events.some((event) => event.kind === "placed")) return null;
  return finalizeParsedOrder({
    id,
    retailer,
    orderId,
    status:
      raw.status === "cancelled" ||
      raw.status === "delivered" ||
      raw.status === "picked_up" ||
      raw.status === "shipped"
        ? raw.status
        : "placed",
    fulfillment: raw.fulfillment === "pickup" || raw.fulfillment === "delivery" ? raw.fulfillment : undefined,
    total: typeof raw.total === "number" && Number.isFinite(raw.total) ? raw.total : undefined,
    currency: raw.currency?.trim() || (raw.total != null ? "USD" : undefined),
    trackingNumber: raw.trackingNumber?.trim() || undefined,
    items: (() => {
      const items = Array.isArray(raw.items)
        ? raw.items
            .map((item) => ({
              name: repairUtf8Mojibake(String(item?.name ?? "").trim()),
              quantity: Number(item?.quantity),
              price:
                typeof item?.price === "number" && Number.isFinite(item.price) && item.price > 0
                  ? item.price
                  : undefined,
            }))
            .filter((item) => item.name.length > 0 && Number.isFinite(item.quantity) && item.quantity > 0)
        : [];
      return items.length > 0 ? items : undefined;
    })(),
    recipientEmail: raw.recipientEmail?.trim() || undefined,
    profileId: raw.profileId?.trim() || undefined,
    profileName: raw.profileName?.trim() || undefined,
    events,
    placedAt: raw.placedAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  });
}

export async function listOrders(): Promise<ParsedOrder[]> {
  await ensureDataKey(KEYS.orders);
  const orders = Object.values(readMap<Partial<ParsedOrder>>(KEYS.orders))
    .map((raw) => normalizeParsedOrder(raw ?? {}))
    .filter((order): order is ParsedOrder => order != null);
  return upsertParsedOrders([], orders);
}

export async function saveOrders(orders: ParsedOrder[]): Promise<void> {
  const folded = upsertParsedOrders(
    [],
    orders.map((raw) => normalizeParsedOrder(raw)).filter((order): order is ParsedOrder => order != null),
  );
  const map: Record<string, ParsedOrder> = {};
  for (const order of folded) map[order.id] = order;
  writeMap(KEYS.orders, map);
  await persistMap();
}

export async function getGeocodioSettings(): Promise<import("./types").GeocodioSettings> {
  await ensureDataKey(KEYS.geocodioSettings);
  const stored = readMap<string>(KEYS.geocodioSettings);
  return { apiKey: (stored.apiKey ?? "").trim() };
}

export async function saveGeocodioSettings(settings: import("./types").GeocodioSettings): Promise<void> {
  writeMap(KEYS.geocodioSettings, { apiKey: settings.apiKey.trim() });
  await persistMap();
}

export async function getOpenAiSettings(): Promise<import("./types").OpenAiSettings> {
  await ensureDataKey(KEYS.openaiSettings);
  const stored = readMap<string>(KEYS.openaiSettings);
  return { apiKey: (stored.apiKey ?? "").trim() };
}

export async function saveOpenAiSettings(settings: import("./types").OpenAiSettings): Promise<void> {
  writeMap(KEYS.openaiSettings, { apiKey: settings.apiKey.trim() });
  await persistMap();
}

function analysisStorageKey(site: string, email: string): string {
  return `${site}:${email.trim().toLowerCase()}`;
}

function normalizeOrderAnalysis(raw: Partial<OrderAnalysisRecord> | undefined): OrderAnalysisRecord | null {
  if (!raw) return null;
  const site = raw.site;
  const email = raw.email?.trim().toLowerCase() ?? "";
  const display = raw.result?.display?.trim() ?? "";
  if (site !== "target" && site !== "walmart" && site !== "pokemon-center") return null;
  if (!email || !display) return null;
  const cancelledAtCount = Number(raw.cancelledAtCount);
  const promptVersion = Number(raw.promptVersion);
  return {
    site,
    email,
    cancelledAtCount: Number.isFinite(cancelledAtCount) ? cancelledAtCount : 0,
    analyzedAt: raw.analyzedAt?.trim() || new Date().toISOString(),
    promptVersion: Number.isFinite(promptVersion) && promptVersion > 0 ? promptVersion : undefined,
    result: {
      display,
      severity: raw.result?.severity === "low" || raw.result?.severity === "high" ? raw.result.severity : "med",
      causes: Array.isArray(raw.result?.causes) ? raw.result.causes : [],
      confidence: typeof raw.result?.confidence === "number" ? raw.result.confidence : 0.5,
      action: raw.result?.action?.trim() || "",
      notes: raw.result?.notes?.trim() || undefined,
    },
  };
}

export async function listOrderAnalysis(): Promise<OrderAnalysisRecord[]> {
  await ensureDataKey(KEYS.orderAnalysis);
  return Object.values(readMap<Partial<OrderAnalysisRecord>>(KEYS.orderAnalysis))
    .map((raw) => normalizeOrderAnalysis(raw))
    .filter((record): record is OrderAnalysisRecord => record != null);
}

export async function upsertOrderAnalysis(record: OrderAnalysisRecord): Promise<void> {
  await ensureDataKey(KEYS.orderAnalysis);
  const normalized = normalizeOrderAnalysis(record);
  if (!normalized) return;
  const map = readMap<OrderAnalysisRecord>(KEYS.orderAnalysis);
  map[analysisStorageKey(normalized.site, normalized.email)] = normalized;
  writeMap(KEYS.orderAnalysis, map);
  await persistMap();
}
