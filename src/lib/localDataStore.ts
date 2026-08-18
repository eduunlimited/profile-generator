import { isBrowserUiMode } from "./env";

export const STORAGE_KEY_TO_FILE: Record<string, string> = {
  "profile-generator:profiles": "profiles.json",
  "profile-generator:jig-presets": "jig-presets.json",
  "profile-generator:export-templates": "export-templates.json",
  "profile-generator:master-profiles": "master-profiles.json",
  "profile-generator:credit-cards": "credit-cards.json",
  "profile-generator:credentials": "credentials.json",
  "profile-generator:account-categories": "account-categories.json",
  "profile-generator:card-categories": "card-categories.json",
  "profile-generator:profile-categories": "profile-categories.json",
  "profile-generator:proxy-pool": "proxy-pool.json",
  "profile-generator:proxy-groups": "proxy-groups.json",
  "profile-generator:proxy-assignments": "proxy-assignments.json",
  "profile-generator:imap-settings": "imap-settings.json",
  "profile-generator:imap-mail": "imap-mail.json",
};

const DATA_API = "/__data";

const cache = new Map<string, Record<string, unknown>>();
const persistChain = new Map<string, Promise<void>>();
let hydratePromise: Promise<void> | null = null;

export function usesProjectDataFiles(): boolean {
  return isBrowserUiMode() || import.meta.env.DEV;
}

function cloneMap(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function readLocalStorageMap(key: string): Record<string, unknown> {
  const raw = localStorage.getItem(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeLocalStorageMap(key: string, value: Record<string, unknown>): void {
  localStorage.setItem(key, JSON.stringify(value));
}

async function fetchDataFile(fileName: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${DATA_API}/${fileName}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${fileName} (${response.status}).`);
  }
  const parsed = (await response.json()) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

async function persistDataFile(fileName: string, value: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${DATA_API}/${fileName}`, {
    method: "PUT",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    throw new Error(`Failed to save ${fileName} (${response.status}).`);
  }
}

function enqueuePersist(fileName: string, value: Record<string, unknown>): Promise<void> {
  const snapshot = cloneMap(value);
  const previous = persistChain.get(fileName) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => persistDataFile(fileName, snapshot));
  persistChain.set(fileName, next);
  return next;
}

async function hydrateKey(key: string): Promise<void> {
  const fileName = STORAGE_KEY_TO_FILE[key];
  if (!fileName) return;

  let data = await fetchDataFile(fileName);
  const fromBrowser = readLocalStorageMap(key);

  // Project data files are the source of truth. Browser storage is only used
  // to migrate into an empty file — never to overwrite a newer rename on disk.
  if (Object.keys(data).length === 0 && Object.keys(fromBrowser).length > 0) {
    data = fromBrowser;
    await persistDataFile(fileName, data);
  }

  cache.set(key, data);
  writeLocalStorageMap(key, data);
}

export async function initLocalDataStore(): Promise<void> {
  if (!usesProjectDataFiles()) return;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      await Promise.all(Object.keys(STORAGE_KEY_TO_FILE).map((key) => hydrateKey(key)));
    })();
  }
  await hydratePromise;
}

export function readCachedMap<T>(key: string): Record<string, T> {
  if (usesProjectDataFiles()) {
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached as Record<string, T>;
    }
    if (!STORAGE_KEY_TO_FILE[key]) {
      return readLocalStorageMap(key) as Record<string, T>;
    }
    return {};
  }
  return readLocalStorageMap(key) as Record<string, T>;
}

export function writeCachedMap<T>(key: string, value: Record<string, T>): Promise<void> {
  const snapshot = cloneMap(value as Record<string, unknown>);
  if (usesProjectDataFiles()) {
    cache.set(key, snapshot);
    writeLocalStorageMap(key, snapshot);
    const fileName = STORAGE_KEY_TO_FILE[key];
    if (fileName) {
      return enqueuePersist(fileName, snapshot).catch((error) => {
        console.error(`Project data save failed for ${fileName}:`, error);
      });
    }
    return Promise.resolve();
  }
  writeLocalStorageMap(key, snapshot);
  return Promise.resolve();
}

export async function flushLocalDataWrites(): Promise<void> {
  await Promise.all([...persistChain.values()]);
}

export function removeLegacyStorageKey(key: string): void {
  localStorage.removeItem(key);
}
