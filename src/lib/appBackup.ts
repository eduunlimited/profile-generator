import {
  listExportTemplates,
  listJigPresets,
  listMasterProfiles,
  loadAllProfiles,
  replaceAllExportTemplates,
  replaceAllJigPresets,
  replaceAllMasterProfiles,
  replaceAllProfiles,
} from "./api";
import type { ExportTemplate, JigPreset, MasterProfile, Profile } from "./types";
import {
  STORAGE_KEY_TO_FILE,
  ensureDataKey,
  flushLocalDataWrites,
  initLocalDataStore,
  readCachedMap,
  writeCachedMap,
} from "./localDataStore";
import { pickTextFile, saveTextFile } from "./saveFile";

export const APP_BACKUP_KIND = "profile-generator-backup";
export const APP_BACKUP_VERSION = 1;

const PROFILES_KEY = "profile-generator:profiles";
const JIG_PRESETS_KEY = "profile-generator:jig-presets";
const EXPORT_TEMPLATES_KEY = "profile-generator:export-templates";
const MASTER_PROFILES_KEY = "profile-generator:master-profiles";
const PYTHON_PATH_KEY = "profile-generator:python-path";
const UI_KEY_PREFIXES = [
  "profile-generator:table-cols:",
  "profile-generator:profiles-sidebar-width",
  "profile-generator:cards-sidebar-width",
  "profile-generator:emails-sidebar-width",
  "profile-generator:accounts-sidebar-width",
  "profile-generator:mail-sidebar-width",
  PYTHON_PATH_KEY,
] as const;

export interface AppBackup {
  kind: typeof APP_BACKUP_KIND;
  version: number;
  exportedAt: string;
  appVersion: string;
  stores: Record<string, Record<string, unknown>>;
  extras: {
    pythonPath?: string;
    ui: Record<string, string>;
  };
}

export interface AppBackupSummary {
  profiles: number;
  cards: number;
  emails: number;
  accounts: number;
  imapAccounts: number;
  proxies: number;
  orders: number;
  hasGeocodioKey: boolean;
  hasOpenAiKey: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordsById<T extends { id: string }>(items: T[]): Record<string, unknown> {
  return Object.fromEntries(items.filter((item) => item?.id).map((item) => [item.id, item]));
}

function countMap(store: Record<string, unknown> | undefined): number {
  return store ? Object.keys(store).length : 0;
}

function hasApiKey(store: Record<string, unknown> | undefined): boolean {
  return typeof store?.apiKey === "string" && store.apiKey.trim().length > 0;
}

export function summarizeAppBackup(backup: AppBackup): AppBackupSummary {
  return {
    profiles: countMap(backup.stores[PROFILES_KEY]),
    cards: countMap(backup.stores["profile-generator:credit-cards"]),
    emails: countMap(backup.stores["profile-generator:pool-emails"]),
    accounts: countMap(backup.stores["profile-generator:credentials"]),
    imapAccounts: countMap(backup.stores["profile-generator:imap-settings"]),
    proxies: countMap(backup.stores["profile-generator:proxy-pool"]),
    orders: countMap(backup.stores["profile-generator:orders"]),
    hasGeocodioKey: hasApiKey(backup.stores["profile-generator:geocodio-settings"]),
    hasOpenAiKey: hasApiKey(backup.stores["profile-generator:openai-settings"]),
  };
}

function collectUiPrefs(): Record<string, string> {
  const ui: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith("profile-generator:")) continue;
    if (!UI_KEY_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))) continue;
    const value = localStorage.getItem(key);
    if (value != null) ui[key] = value;
  }
  return ui;
}

function applyUiPrefs(ui: Record<string, string> | undefined) {
  if (!ui) return;
  for (const [key, value] of Object.entries(ui)) {
    if (!key.startsWith("profile-generator:")) continue;
    if (typeof value !== "string") continue;
    localStorage.setItem(key, value);
  }
}

export function parseAppBackup(raw: string): AppBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!isPlainObject(parsed) || parsed.kind !== APP_BACKUP_KIND) {
    throw new Error("That file is not a Profile Generator backup.");
  }
  if (typeof parsed.version !== "number" || parsed.version < 1) {
    throw new Error("Unsupported backup version.");
  }
  if (!isPlainObject(parsed.stores)) {
    throw new Error("Backup is missing app data.");
  }
  const stores: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(parsed.stores)) {
    stores[key] = isPlainObject(value) ? value : {};
  }
  const extrasRaw = isPlainObject(parsed.extras) ? parsed.extras : {};
  const ui = isPlainObject(extrasRaw.ui)
    ? Object.fromEntries(
        Object.entries(extrasRaw.ui).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};
  return {
    kind: APP_BACKUP_KIND,
    version: parsed.version,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : "",
    stores,
    extras: {
      pythonPath: typeof extrasRaw.pythonPath === "string" ? extrasRaw.pythonPath : undefined,
      ui,
    },
  };
}

export async function collectAppBackup(): Promise<AppBackup> {
  await initLocalDataStore();
  await Promise.all(Object.keys(STORAGE_KEY_TO_FILE).map((key) => ensureDataKey(key)));

  const stores: Record<string, Record<string, unknown>> = {};
  for (const key of Object.keys(STORAGE_KEY_TO_FILE)) {
    stores[key] = { ...readCachedMap<unknown>(key) };
  }

  const [profiles, jigPresets, exportTemplates, masterProfiles] = await Promise.all([
    loadAllProfiles(),
    listJigPresets(),
    listExportTemplates(),
    listMasterProfiles(),
  ]);
  stores[PROFILES_KEY] = recordsById(profiles);
  stores[JIG_PRESETS_KEY] = recordsById(jigPresets);
  stores[EXPORT_TEMPLATES_KEY] = recordsById(exportTemplates);
  stores[MASTER_PROFILES_KEY] = recordsById(masterProfiles);

  const ui = collectUiPrefs();
  return {
    kind: APP_BACKUP_KIND,
    version: APP_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: "",
    stores,
    extras: {
      pythonPath: ui[PYTHON_PATH_KEY],
      ui,
    },
  };
}

export async function restoreAppBackup(backup: AppBackup): Promise<AppBackupSummary> {
  await initLocalDataStore();
  await Promise.all(Object.keys(STORAGE_KEY_TO_FILE).map((key) => ensureDataKey(key)));

  for (const key of Object.keys(STORAGE_KEY_TO_FILE)) {
    const store = isPlainObject(backup.stores[key]) ? backup.stores[key] : {};
    await writeCachedMap(key, store);
  }
  await flushLocalDataWrites();

  await replaceAllProfiles(Object.values(backup.stores[PROFILES_KEY] ?? {}) as Profile[]);
  await replaceAllJigPresets(Object.values(backup.stores[JIG_PRESETS_KEY] ?? {}) as JigPreset[]);
  await replaceAllExportTemplates(Object.values(backup.stores[EXPORT_TEMPLATES_KEY] ?? {}) as ExportTemplate[]);
  await replaceAllMasterProfiles(Object.values(backup.stores[MASTER_PROFILES_KEY] ?? {}) as MasterProfile[]);

  applyUiPrefs(backup.extras.ui);
  if (backup.extras.pythonPath != null) {
    const trimmed = backup.extras.pythonPath.trim();
    if (trimmed) localStorage.setItem(PYTHON_PATH_KEY, trimmed);
    else localStorage.removeItem(PYTHON_PATH_KEY);
  }

  return summarizeAppBackup(backup);
}

export async function exportAppBackupFile(): Promise<AppBackupSummary | null> {
  const backup = await collectAppBackup();
  const stamp = backup.exportedAt.slice(0, 10);
  const saved = await saveTextFile(
    `profile-generator-backup-${stamp}.json`,
    `${JSON.stringify(backup, null, 2)}\n`,
  );
  return saved ? summarizeAppBackup(backup) : null;
}

export async function importAppBackupFile(): Promise<AppBackupSummary | null> {
  const raw = await pickTextFile({ extensions: ["json"] });
  if (raw == null) return null;
  const backup = parseAppBackup(raw);
  return restoreAppBackup(backup);
}
