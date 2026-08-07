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
};

const DATA_API = "/__data";

const cache = new Map<string, Record<string, unknown>>();
let hydratePromise: Promise<void> | null = null;

export function usesProjectDataFiles(): boolean {
  return isBrowserUiMode() || import.meta.env.DEV;
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

async function fetchDataFile(fileName: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${DATA_API}/${fileName}`);
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    throw new Error(`Failed to save ${fileName} (${response.status}).`);
  }
}

async function hydrateKey(key: string): Promise<void> {
  const fileName = STORAGE_KEY_TO_FILE[key];
  if (!fileName) return;

  let data = await fetchDataFile(fileName);
  const fromBrowser = readLocalStorageMap(key);

  const fileCount = Object.keys(data).length;
  const browserCount = Object.keys(fromBrowser).length;

  if (fileCount === 0 && browserCount > 0) {
    data = fromBrowser;
    await persistDataFile(fileName, data);
  } else if (fileCount > 0 && browserCount > fileCount) {
    data = fromBrowser;
    await persistDataFile(fileName, data);
  }

  cache.set(key, data);
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
    return (cache.get(key) ?? {}) as Record<string, T>;
  }
  return readLocalStorageMap(key) as Record<string, T>;
}

export function writeCachedMap<T>(key: string, value: Record<string, T>): void {
  if (usesProjectDataFiles()) {
    cache.set(key, value as Record<string, unknown>);
    const fileName = STORAGE_KEY_TO_FILE[key];
    if (fileName) {
      void persistDataFile(fileName, value as Record<string, unknown>).catch((error) => {
        console.error(`Project data save failed for ${fileName}:`, error);
      });
    }
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export function removeLegacyStorageKey(key: string): void {
  localStorage.removeItem(key);
}
