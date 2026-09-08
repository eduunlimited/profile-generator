import { invoke } from "@tauri-apps/api/core";
import * as browserStorage from "./browserStorage";
import { isTauriRuntime } from "./env";
import { usesProjectDataFiles } from "./localDataStore";
import { sortProfilesByName } from "./profileNameUtils";
import type {
  ExportTemplate,
  JigPreset,
  MasterProfile,
  Profile,
  ProfileSummary,
} from "./types";

function usesRustProfileStore(): boolean {
  return isTauriRuntime() && !usesProjectDataFiles();
}

const backend = usesRustProfileStore()
  ? {
      listProfiles: () => invoke<Profile[]>("list_profiles"),
      getProfile: (id: string) => invoke<Profile>("get_profile", { id }),
      saveProfile: (profile: Profile) => invoke("save_profile", { profile }),
      saveProfiles: (profiles: Profile[]) => invoke("save_profiles", { profiles }),
      deleteProfile: (id: string) => invoke("delete_profile", { id }),
      replaceAllProfiles: (profiles: Profile[]) => invoke("replace_profiles", { profiles }),
      listJigPresets: () => invoke<JigPreset[]>("list_jig_presets"),
      saveJigPreset: (preset: JigPreset) => invoke("save_jig_preset", { preset }),
      deleteJigPreset: (id: string) => invoke("delete_jig_preset", { id }),
      listExportTemplates: () => invoke<ExportTemplate[]>("list_export_templates"),
      saveExportTemplate: (template: ExportTemplate) =>
        invoke("save_export_template", { template }),
      deleteExportTemplate: (id: string) => invoke("delete_export_template", { id }),
      seedDefaults: (jigPresets: JigPreset[], exportTemplates: ExportTemplate[]) =>
        invoke("seed_defaults", { jigPresets, exportTemplates }),
      listMasterProfiles: () => invoke<MasterProfile[]>("list_master_profiles"),
      saveMasterProfile: (master: MasterProfile) => invoke("save_master_profile", { master }),
      deleteMasterProfile: (id: string) => invoke("delete_master_profile", { id }),
    }
  : browserStorage;

export async function listProfiles(): Promise<ProfileSummary[]> {
  if (usesRustProfileStore()) {
    const profiles = await invoke<Profile[]>("list_profiles");
    return sortProfilesByName(await browserStorage.summarizeProfiles(profiles));
  }
  return sortProfilesByName(await browserStorage.listProfiles());
}

export async function getProfile(id: string): Promise<Profile> {
  return backend.getProfile(id);
}

export async function saveProfile(profile: Profile): Promise<void> {
  await backend.saveProfile(profile);
}

export async function saveProfiles(profiles: Profile[]): Promise<void> {
  await backend.saveProfiles(profiles);
}

export async function deleteProfile(id: string): Promise<void> {
  await backend.deleteProfile(id);
}

export async function loadAllProfiles(): Promise<Profile[]> {
  if (usesRustProfileStore()) {
    return invoke<Profile[]>("list_profiles");
  }
  return browserStorage.loadAllProfiles();
}

export async function replaceAllProfiles(profiles: Profile[]): Promise<void> {
  if (usesRustProfileStore()) {
    await invoke("replace_profiles", { profiles });
    return;
  }
  await browserStorage.replaceAllProfiles(profiles);
}

export async function listJigPresets(): Promise<JigPreset[]> {
  return backend.listJigPresets();
}

export async function saveJigPreset(preset: JigPreset): Promise<void> {
  await backend.saveJigPreset(preset);
}

export async function deleteJigPreset(id: string): Promise<void> {
  await backend.deleteJigPreset(id);
}

export async function listExportTemplates(): Promise<ExportTemplate[]> {
  return backend.listExportTemplates();
}

export async function saveExportTemplate(template: ExportTemplate): Promise<void> {
  await backend.saveExportTemplate(template);
}

export async function deleteExportTemplate(id: string): Promise<void> {
  await backend.deleteExportTemplate(id);
}

export async function replaceAllJigPresets(presets: JigPreset[]): Promise<void> {
  if (isTauriRuntime() && !usesProjectDataFiles()) {
    const current = await listJigPresets();
    const keep = new Set(presets.map((preset) => preset.id));
    for (const preset of current) {
      if (!keep.has(preset.id)) {
        await deleteJigPreset(preset.id);
      }
    }
    for (const preset of presets) {
      await saveJigPreset(preset);
    }
    return;
  }
  await browserStorage.replaceAllJigPresets(presets);
}

export async function replaceAllExportTemplates(templates: ExportTemplate[]): Promise<void> {
  if (isTauriRuntime() && !usesProjectDataFiles()) {
    const current = await listExportTemplates();
    const keep = new Set(templates.map((template) => template.id));
    for (const template of current) {
      if (!keep.has(template.id)) {
        await deleteExportTemplate(template.id);
      }
    }
    for (const template of templates) {
      await saveExportTemplate(template);
    }
    return;
  }
  await browserStorage.replaceAllExportTemplates(templates);
}

export async function seedDefaults(
  jigPresets: JigPreset[],
  exportTemplates: ExportTemplate[],
): Promise<void> {
  await backend.seedDefaults(jigPresets, exportTemplates);
}

export async function listMasterProfiles(): Promise<MasterProfile[]> {
  return backend.listMasterProfiles();
}

export async function saveMasterProfile(master: MasterProfile): Promise<void> {
  await backend.saveMasterProfile(master);
}

export async function deleteMasterProfile(id: string): Promise<void> {
  await backend.deleteMasterProfile(id);
}

export async function replaceAllMasterProfiles(masters: MasterProfile[]): Promise<void> {
  if (isTauriRuntime() && !usesProjectDataFiles()) {
    const current = await listMasterProfiles();
    const snapshotIds = new Set(masters.map((master) => master.id));
    for (const master of current) {
      if (!snapshotIds.has(master.id)) {
        await deleteMasterProfile(master.id);
      }
    }
    for (const master of masters) {
      await saveMasterProfile(master);
    }
    return;
  }
  await browserStorage.replaceAllMasterProfiles(masters);
}

export async function listCreditCards() {
  return browserStorage.listCreditCards();
}

export async function saveCreditCard(card: import("./types").CreditCard) {
  return browserStorage.saveCreditCard(card);
}

export async function deleteCreditCard(id: string) {
  return browserStorage.deleteCreditCard(id);
}

export async function importCreditCards(cards: import("./types").CreditCard[]) {
  return browserStorage.importCreditCards(cards);
}

export async function replaceAllCreditCards(cards: import("./types").CreditCard[]) {
  return browserStorage.replaceAllCreditCards(cards);
}

export async function listCredentials() {
  return browserStorage.listCredentials();
}

export async function saveCredential(credential: import("./types").Credential) {
  return browserStorage.saveCredential(credential);
}

export async function deleteCredential(id: string) {
  return browserStorage.deleteCredential(id);
}

export async function importCredentials(credentials: import("./types").Credential[]) {
  return browserStorage.importCredentials(credentials);
}

export async function replaceAllCredentials(credentials: import("./types").Credential[]) {
  return browserStorage.replaceAllCredentials(credentials);
}

export async function listAccountCategories() {
  return browserStorage.listAccountCategories();
}

export async function saveAccountCategory(category: import("./types").AccountCategory) {
  return browserStorage.saveAccountCategory(category);
}

export async function deleteAccountCategory(id: string) {
  return browserStorage.deleteAccountCategory(id);
}

export async function reorderAccountCategories(orderedIds: string[]) {
  return browserStorage.reorderAccountCategories(orderedIds);
}

export async function listCardCategories() {
  return browserStorage.listCardCategories();
}

export async function saveCardCategory(category: import("./types").CardCategory) {
  return browserStorage.saveCardCategory(category);
}

export async function deleteCardCategory(id: string) {
  return browserStorage.deleteCardCategory(id);
}

export async function reorderCardCategories(orderedIds: string[]) {
  return browserStorage.reorderCardCategories(orderedIds);
}

export async function listPoolEmails() {
  return browserStorage.listPoolEmails();
}

export async function savePoolEmail(email: import("./types").PoolEmail) {
  return browserStorage.savePoolEmail(email);
}

export async function deletePoolEmail(id: string) {
  return browserStorage.deletePoolEmail(id);
}

export async function importPoolEmails(emails: import("./types").PoolEmail[]) {
  return browserStorage.importPoolEmails(emails);
}

export async function replaceAllPoolEmails(emails: import("./types").PoolEmail[]) {
  return browserStorage.replaceAllPoolEmails(emails);
}

export async function listEmailCategories() {
  return browserStorage.listEmailCategories();
}

export async function saveEmailCategory(category: import("./types").EmailCategory) {
  return browserStorage.saveEmailCategory(category);
}

export async function deleteEmailCategory(id: string) {
  return browserStorage.deleteEmailCategory(id);
}

export async function reorderEmailCategories(orderedIds: string[]) {
  return browserStorage.reorderEmailCategories(orderedIds);
}

export async function listProfileCategories() {
  return browserStorage.listProfileCategories();
}

export async function saveProfileCategory(category: import("./types").ProfileCategory) {
  return browserStorage.saveProfileCategory(category);
}

export async function deleteProfileCategory(id: string) {
  return browserStorage.deleteProfileCategory(id);
}

export async function reorderProfileCategories(orderedIds: string[]) {
  return browserStorage.reorderProfileCategories(orderedIds);
}

export async function listProxies() {
  return browserStorage.listProxies();
}

export async function saveProxies(proxies: import("../modules/browserSessions/types").ProxyEntry[]) {
  return browserStorage.saveProxies(proxies);
}

export async function importProxies(proxies: import("../modules/browserSessions/types").ProxyEntry[]) {
  return browserStorage.importProxies(proxies);
}

export async function deleteProxy(id: string) {
  return browserStorage.deleteProxy(id);
}

export async function listProxyAssignments() {
  return browserStorage.listProxyAssignments();
}

export async function saveProxyAssignments(assignments: Record<string, string>) {
  return browserStorage.saveProxyAssignments(assignments);
}

export async function listProxyGroups() {
  return browserStorage.listProxyGroups();
}

export async function saveProxyGroup(group: import("../modules/browserSessions/types").ProxyGroup) {
  return browserStorage.saveProxyGroup(group);
}

export async function deleteProxyGroup(id: string) {
  return browserStorage.deleteProxyGroup(id);
}

export async function listImapAccounts() {
  return browserStorage.listImapAccounts();
}

export async function saveImapAccount(account: import("./types").ImapAccount) {
  return browserStorage.saveImapAccount(account);
}

export async function deleteImapAccount(id: string) {
  return browserStorage.deleteImapAccount(id);
}

export async function getImapMail(accountId: string) {
  return browserStorage.getImapMail(accountId);
}

export async function saveImapMail(accountId: string, messages: import("./types").StoredImapMessage[]) {
  return browserStorage.saveImapMail(accountId, messages);
}

export async function compactImapMailIfNeeded() {
  return browserStorage.compactImapMailIfNeeded();
}

export async function testImap(settings: import("./types").ImapSettings) {
  if (!isTauriRuntime()) {
    throw new Error("IMAP reading needs the desktop app. Run npm run tauri dev.");
  }
  return invoke<import("./types").ImapTestResult>("test_imap", { settings });
}

export async function fetchImapInbox(
  settings: import("./types").ImapSettings,
  limit = 500,
  offset = 0,
) {
  if (!isTauriRuntime()) {
    throw new Error("IMAP reading needs the desktop app. Run npm run tauri dev.");
  }
  return invoke<import("./types").ImapMessage[]>("fetch_imap_inbox", { settings, limit, offset });
}

async function fetchImapMessagesFromDevServer(
  settings: import("./types").ImapSettings,
  uids: number[],
): Promise<import("./types").ImapMessage[]> {
  const response = await fetch("/__imap/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings, uids }),
  });
  const payload = (await response.json().catch(() => null)) as
    | import("./types").ImapMessage[]
    | { error?: string }
    | null;
  if (!response.ok) {
    const message =
      payload && !Array.isArray(payload) && payload.error?.trim()
        ? payload.error
        : "IMAP reading needs the desktop app, or the local Vite IMAP helper.";
    throw new Error(message);
  }
  return Array.isArray(payload) ? payload : [];
}

export async function fetchImapMessage(settings: import("./types").ImapSettings, uid: number) {
  if (isTauriRuntime()) {
    return invoke<import("./types").ImapMessage>("fetch_imap_message", { settings, uid });
  }
  const [message] = await fetchImapMessagesFromDevServer(settings, [uid]);
  if (!message) {
    throw new Error(`Could not load message ${uid}.`);
  }
  return message;
}

export async function fetchImapMessages(
  settings: import("./types").ImapSettings,
  uids: number[],
): Promise<import("./types").ImapMessage[]> {
  const unique = [...new Set(uids.filter((uid) => Number.isFinite(uid) && uid > 0))];
  if (unique.length === 0) return [];
  if (!isTauriRuntime()) {
    return fetchImapMessagesFromDevServer(settings, unique);
  }
  const messages: import("./types").ImapMessage[] = [];
  for (const uid of unique) {
    try {
      messages.push(await fetchImapMessage(settings, uid));
    } catch {
      // Keep going; the caller reports how many bodies were missing.
    }
  }
  return messages;
}

export async function searchImapHeaders(settings: import("./types").ImapSettings, subjects: string[]) {
  if (isTauriRuntime()) {
    return invoke<import("./types").ImapMessage[]>("search_imap_headers", { settings, subjects });
  }
  const response = await fetch("/__imap/headers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings, subjects }),
  });
  const payload = (await response.json().catch(() => null)) as
    | import("./types").ImapMessage[]
    | { error?: string }
    | null;
  if (!response.ok) {
    const message =
      payload && !Array.isArray(payload) && payload.error?.trim()
        ? payload.error
        : "IMAP reading needs the desktop app, or the local Vite IMAP helper.";
    throw new Error(message);
  }
  return Array.isArray(payload) ? payload : [];
}

export async function listOrders() {
  return browserStorage.listOrders();
}

export async function saveOrders(orders: import("./types").ParsedOrder[]) {
  return browserStorage.saveOrders(orders);
}

export async function getGeocodioSettings() {
  return browserStorage.getGeocodioSettings();
}

export async function saveGeocodioSettings(settings: import("./types").GeocodioSettings) {
  return browserStorage.saveGeocodioSettings(settings);
}

export async function geocodioLookup(request: import("./types").GeocodioLookupRequest) {
  return import("./geocodioClient").then((mod) => mod.geocodioLookup(request));
}

export async function testGeocodioConnection(apiKey: string) {
  return import("./geocodioClient").then((mod) => mod.testGeocodioConnection(apiKey));
}

export async function getOpenAiSettings() {
  return browserStorage.getOpenAiSettings();
}

export async function saveOpenAiSettings(settings: import("./types").OpenAiSettings) {
  return browserStorage.saveOpenAiSettings(settings);
}

export async function testOpenAiConnection(apiKey: string) {
  return import("./openaiMisspell").then((mod) => mod.testOpenAiConnection(apiKey));
}

export async function listOrderAnalysis() {
  return browserStorage.listOrderAnalysis();
}

export async function upsertOrderAnalysis(record: import("./types").OrderAnalysisRecord) {
  return browserStorage.upsertOrderAnalysis(record);
}

export async function replaceAllOrderAnalysis(records: import("./types").OrderAnalysisRecord[]) {
  return browserStorage.replaceAllOrderAnalysis(records);
}
