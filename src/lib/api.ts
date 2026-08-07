import { invoke } from "@tauri-apps/api/core";
import * as browserStorage from "./browserStorage";
import { isTauriRuntime } from "./env";
import { usesProjectDataFiles } from "./localDataStore";
import type {
  ExportTemplate,
  JigPreset,
  MasterProfile,
  Profile,
  ProfileSummary,
} from "./types";

const backend = isTauriRuntime() && !usesProjectDataFiles()
  ? {
      listProfiles: () => invoke<ProfileSummary[]>("list_profiles"),
      getProfile: (id: string) => invoke<Profile>("get_profile", { id }),
      saveProfile: (profile: Profile) => invoke("save_profile", { profile }),
      saveProfiles: (profiles: Profile[]) => invoke("save_profiles", { profiles }),
      deleteProfile: (id: string) => invoke("delete_profile", { id }),
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
  return backend.listProfiles();
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
