import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./env";
import type { Profile } from "./types";

export const PROFILES_STORAGE_KEY = "profile-generator:profiles";
export const CREDIT_CARDS_STORAGE_KEY = "profile-generator:credit-cards";

export const SECRET_STORAGE_KEYS = new Set([PROFILES_STORAGE_KEY, CREDIT_CARDS_STORAGE_KEY]);

const lockedSecretKeys = new Set<string>();

export function secretStoreLocked(key: string): boolean {
  return lockedSecretKeys.has(key);
}

export function anySecretStoreLocked(): boolean {
  return lockedSecretKeys.size > 0;
}

function markSecretDecryptFailure(key: string): void {
  lockedSecretKeys.add(key);
}

export type SecretEnvelope = {
  v: 1;
  alg: "aes-256-gcm";
  n: string;
  ct: string;
};

export function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    record.alg === "aes-256-gcm" &&
    typeof record.n === "string" &&
    typeof record.ct === "string"
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function last4FromNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function protectPlaintexts(plaintexts: string[]): Promise<(string | SecretEnvelope)[]> {
  if (!isTauriRuntime() || plaintexts.length === 0) return plaintexts;
  const indexes: number[] = [];
  const payload: string[] = [];
  const result: (string | SecretEnvelope)[] = plaintexts.map((text, index) => {
    if (!text) return text;
    indexes.push(index);
    payload.push(text);
    return text;
  });
  if (payload.length === 0) return result;
  const envelopes = await invoke<SecretEnvelope[]>("protect_secrets", { plaintexts: payload });
  indexes.forEach((index, i) => {
    result[index] = envelopes[i];
  });
  return result;
}

async function unprotectValues(values: unknown[]): Promise<string[]> {
  if (values.length === 0) return [];
  const hasEnvelope = values.some((value) => isSecretEnvelope(value));
  if (!hasEnvelope) {
    return values.map((value) => {
      if (typeof value === "string") return value;
      if (value == null) return "";
      return String(value);
    });
  }
  if (!isTauriRuntime()) {
    throw new Error("Encrypted card data can only be read in the desktop app.");
  }
  return invoke<string[]>("unprotect_secrets", { values });
}

type SecretSlot = { record: Record<string, unknown>; field: string };

function collectPaymentSlots(store: Record<string, unknown>): SecretSlot[] {
  const slots: SecretSlot[] = [];
  for (const value of Object.values(store)) {
    const profile = asRecord(value);
    const payment = asRecord(profile?.payment);
    if (!payment) continue;
    slots.push({ record: payment, field: "number" });
    slots.push({ record: payment, field: "cvv" });
  }
  return slots;
}

function collectCardSlots(store: Record<string, unknown>): SecretSlot[] {
  const slots: SecretSlot[] = [];
  for (const value of Object.values(store)) {
    const card = asRecord(value);
    if (!card) continue;
    slots.push({ record: card, field: "number" });
    slots.push({ record: card, field: "cvv" });
  }
  return slots;
}

async function encryptSlots(slots: SecretSlot[]): Promise<void> {
  const pending: { slot: SecretSlot; text: string }[] = [];
  for (const slot of slots) {
    const current = slot.record[slot.field];
    if (isSecretEnvelope(current) || typeof current !== "string" || !current) continue;
    pending.push({ slot, text: current });
  }
  const protectedValues = await protectPlaintexts(pending.map((item) => item.text));
  pending.forEach((item, index) => {
    item.slot.record[item.slot.field] = protectedValues[index];
  });
}

function redactedSecret(slot: SecretSlot): string {
  if (slot.field !== "number") return "";
  const last4 =
    (typeof slot.record.numberLast4 === "string" && slot.record.numberLast4.trim()) ||
    last4FromNumber(slot.record.number);
  return last4 ? `••••${last4}` : "";
}

function applyPlaintexts(slots: SecretSlot[], storeKey: string, plaintexts: string[]): void {
  slots.forEach((slot, index) => {
    const current = slot.record[slot.field];
    const text = plaintexts[index] ?? "";
    if (isSecretEnvelope(current) && !text) {
      markSecretDecryptFailure(storeKey);
      slot.record[slot.field] = redactedSecret(slot);
      return;
    }
    slot.record[slot.field] = text;
  });
}

async function decryptSlots(slots: SecretSlot[], storeKey: string): Promise<void> {
  if (slots.length === 0) return;
  const values = slots.map((slot) => slot.record[slot.field]);
  try {
    applyPlaintexts(slots, storeKey, await unprotectValues(values));
    return;
  } catch (error) {
    console.error(`Could not decrypt ${storeKey} in one pass.`, error);
  }
  for (const slot of slots) {
    const current = slot.record[slot.field];
    try {
      const [text] = await unprotectValues([current]);
      applyPlaintexts([slot], storeKey, [text ?? ""]);
    } catch (error) {
      console.error(`Could not decrypt ${storeKey} field ${slot.field}.`, error);
      if (isSecretEnvelope(current)) {
        markSecretDecryptFailure(storeKey);
        slot.record[slot.field] = redactedSecret(slot);
      }
    }
  }
}

export async function encryptProfilesMap(
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = cloneJson(store);
  await encryptSlots(collectPaymentSlots(next));
  return next;
}

export async function decryptProfilesMap(
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = cloneJson(store);
  await decryptSlots(collectPaymentSlots(next), PROFILES_STORAGE_KEY);
  return next;
}

export async function encryptCreditCardsMap(
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = cloneJson(store);
  for (const value of Object.values(next)) {
    const card = asRecord(value);
    if (!card) continue;
    const existingLast4 = typeof card.numberLast4 === "string" ? card.numberLast4.trim() : "";
    card.numberLast4 = existingLast4 || last4FromNumber(card.number);
  }
  await encryptSlots(collectCardSlots(next));
  return next;
}

export async function decryptCreditCardsMap(
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = cloneJson(store);
  await decryptSlots(collectCardSlots(next), CREDIT_CARDS_STORAGE_KEY);
  return next;
}

export async function encryptStore(
  key: string,
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (key === CREDIT_CARDS_STORAGE_KEY) return encryptCreditCardsMap(store);
  if (key === PROFILES_STORAGE_KEY) return encryptProfilesMap(store);
  return store;
}

export async function decryptStore(
  key: string,
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (key === CREDIT_CARDS_STORAGE_KEY) return decryptCreditCardsMap(store);
  if (key === PROFILES_STORAGE_KEY) return decryptProfilesMap(store);
  return store;
}

export async function encryptProfileSecrets(profile: Profile): Promise<unknown> {
  const [encrypted] = Object.values(await encryptProfilesMap({ [profile.id]: profile }));
  return encrypted;
}

export async function decryptProfileSecrets(profile: Profile): Promise<Profile> {
  const [decrypted] = Object.values(await decryptProfilesMap({ [profile.id]: profile }));
  return decrypted as Profile;
}

export async function encryptProfilesList(profiles: Profile[]): Promise<unknown[]> {
  const mapped = await encryptProfilesMap(Object.fromEntries(profiles.map((profile) => [profile.id, profile])));
  return profiles.map((profile) => mapped[profile.id]);
}

export async function decryptProfilesList(profiles: Profile[]): Promise<Profile[]> {
  const mapped = await decryptProfilesMap(Object.fromEntries(profiles.map((profile) => [profile.id, profile])));
  return profiles.map((profile) => mapped[profile.id] as Profile);
}

export async function confirmWindowsUser(message: string): Promise<boolean> {
  if (!isTauriRuntime()) return true;
  return invoke<boolean>("confirm_windows_user", { message });
}

export async function requireWindowsUser(message: string): Promise<void> {
  const verified = await confirmWindowsUser(message);
  if (!verified) {
    throw new Error("Export cancelled.");
  }
}