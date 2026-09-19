import { decryptStore, encryptStore, SECRET_STORAGE_KEYS } from "./cardSecrets";
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
  "profile-generator:pool-emails": "pool-emails.json",
  "profile-generator:email-categories": "email-categories.json",
  "profile-generator:profile-groups": "profile-groups.json",
  "profile-generator:profile-categories": "profile-categories.json",
  "profile-generator:proxy-pool": "proxy-pool.json",
  "profile-generator:proxy-groups": "proxy-groups.json",
  "profile-generator:proxy-assignments": "proxy-assignments.json",
  "profile-generator:imap-settings": "imap-settings.json",
  "profile-generator:imap-mail": "imap-mail.json",
  "profile-generator:orders": "orders.json",
  "profile-generator:geocodio-settings": "geocodio-settings.json",
  "profile-generator:openai-settings": "openai-settings.json",
  "profile-generator:order-analysis": "order-analysis.json",
};

const DATA_API = "/__data";
const SKIP_EAGER_HYDRATE = new Set(["profile-generator:imap-mail"]);

const cache = new Map<string, Record<string, unknown>>();
const persistChain = new Map<string, Promise<void>>();
let hydratePromise: Promise<void> | null = null;

export function usesProjectDataFiles(): boolean {
  return isBrowserUiMode() || import.meta.env.DEV;
}

function cloneMap(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
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
  // Project data/*.json files are the source of truth in the browser UI and
  // `tauri dev`. Do not keep a second copy in localStorage — that duplicate
  // lives in the same WebView heap.
  if (usesProjectDataFiles()) {
    localStorage.removeItem(key);
    return;
  }
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

function persistChainKey(key: string): string {
  return STORAGE_KEY_TO_FILE[key] ?? key;
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

function enqueueSecretPersist(key: string, value: Record<string, unknown>): Promise<void> {
  const chainKey = persistChainKey(key);
  const snapshot = cloneMap(value);
  const previous = persistChain.get(chainKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const encrypted = await encryptStore(key, snapshot);
    const fileName = STORAGE_KEY_TO_FILE[key];
    if (usesProjectDataFiles()) {
      if (fileName) {
        await persistDataFile(fileName, encrypted);
      }
      return;
    }
    writeLocalStorageMap(key, encrypted);
  });
  persistChain.set(chainKey, next);
  return next;
}

async function hydrateKey(key: string): Promise<void> {
  const fileName = STORAGE_KEY_TO_FILE[key];
  if (!fileName) return;

  let data = await fetchDataFile(fileName);
  if (key === "profile-generator:profile-groups" && Object.keys(data).length === 0) {
    try {
      data = await fetchDataFile("profile-categories.json");
    } catch {
      data = {};
    }
  }
  const fromBrowser = readLocalStorageMap(key);

  // Project data files are the source of truth. Browser storage is only used
  // to migrate into an empty file — never to overwrite a newer rename on disk.
  if (Object.keys(data).length === 0 && Object.keys(fromBrowser).length > 0) {
    data = fromBrowser;
    const toPersist = SECRET_STORAGE_KEYS.has(key) ? await encryptStore(key, data) : data;
    await persistDataFile(fileName, toPersist);
  }

  if (SECRET_STORAGE_KEYS.has(key)) {
    cache.set(key, data);
    data = await decryptStore(key, data);
  }

  cache.set(key, data);
  writeLocalStorageMap(key, data);
}

async function hydrateKeySafe(key: string): Promise<void> {
  try {
    await hydrateKey(key);
  } catch (error) {
    console.error(`Failed to load ${STORAGE_KEY_TO_FILE[key] ?? key}:`, error);
    if (!cache.has(key)) {
      cache.set(key, readLocalStorageMap(key));
    }
  }
}

async function hydratePackagedSecretKeys(): Promise<void> {
  await Promise.all(
    [...SECRET_STORAGE_KEYS].map(async (key) => {
      if (cache.has(key)) return;
      const raw = readLocalStorageMap(key);
      try {
        cache.set(key, await decryptStore(key, raw));
      } catch (error) {
        console.error(`Failed to decrypt ${STORAGE_KEY_TO_FILE[key] ?? key}:`, error);
        if (!cache.has(key)) {
          cache.set(key, raw);
        }
      }
    }),
  );
}

export async function ensureDataKey(key: string): Promise<void> {
  if (cache.has(key)) return;
  if (usesProjectDataFiles()) {
    await hydrateKeySafe(key);
    return;
  }
  if (SECRET_STORAGE_KEYS.has(key)) {
    await initLocalDataStore();
  }
}

export async function initLocalDataStore(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (
      usesProjectDataFiles()
        ? (async () => {
            await Promise.all(
              Object.keys(STORAGE_KEY_TO_FILE)
                .filter((key) => !SKIP_EAGER_HYDRATE.has(key))
                .map((key) => hydrateKeySafe(key)),
            );
            // Drop leftover mirrors even for keys that are not eager-loaded (mail).
            for (const key of Object.keys(STORAGE_KEY_TO_FILE)) {
              localStorage.removeItem(key);
            }
          })()
        : hydratePackagedSecretKeys()
    ).catch((error) => {
      hydratePromise = null;
      throw error;
    });
  }
  await hydratePromise;
}

export function releaseDataKey(key: string): void {
  cache.delete(key);
}

export function readCachedMap<T>(key: string): Record<string, T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached as Record<string, T>;
  }
  if (usesProjectDataFiles() || SECRET_STORAGE_KEYS.has(key)) {
    return {} as Record<string, T>;
  }
  return readLocalStorageMap(key) as Record<string, T>;
}

export function writeCachedMap<T>(key: string, value: Record<string, T>): Promise<void> {
  const snapshot = cloneMap(value as Record<string, unknown>);
  if (SECRET_STORAGE_KEYS.has(key)) {
    const existing = cache.get(key) ?? readLocalStorageMap(key);
    if (Object.keys(snapshot).length === 0 && Object.keys(existing).length > 0) {
      console.error(`Refusing to persist empty ${key} over existing records.`);
      return Promise.resolve();
    }
    cache.set(key, snapshot);
    return enqueueSecretPersist(key, snapshot).catch((error) => {
      console.error(`Encrypted save failed for ${STORAGE_KEY_TO_FILE[key] ?? key}:`, error);
    });
  }
  cache.set(key, snapshot);
  writeLocalStorageMap(key, snapshot);
  if (usesProjectDataFiles()) {
    const fileName = STORAGE_KEY_TO_FILE[key];
    if (fileName) {
      return enqueuePersist(fileName, snapshot).catch((error) => {
        console.error(`Project data save failed for ${fileName}:`, error);
      });
    }
  }
  return Promise.resolve();
}

export async function flushLocalDataWrites(): Promise<void> {
  await Promise.all([...persistChain.values()].map((pending) => pending.catch(() => undefined)));
}

export function removeLegacyStorageKey(key: string): void {
  localStorage.removeItem(key);
}
