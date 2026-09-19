import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./env";
import type { Profile } from "./types";

export const PROFILES_STORAGE_KEY = "profile-generator:profiles";
export const CREDIT_CARDS_STORAGE_KEY = "profile-generator:credit-cards";

export const SECRET_STORAGE_KEYS = new Set([PROFILES_STORAGE_KEY, CREDIT_CARDS_STORAGE_KEY]);

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
  if (typeof value === "string") {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 4 ? digits.slice(-4) : digits;
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function secretFieldUsable(value: unknown): boolean {
  if (isSecretEnvelope(value)) return true;
  return typeof value === "string" && value.trim().length > 0;
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
    return values.map((value) => (typeof value === "string" ? value : ""));
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

async function decryptSlots(slots: SecretSlot[]): Promise<void> {
  if (slots.length === 0) return;
  const values = slots.map((slot) => slot.record[slot.field]);
  try {
    const plaintexts = await unprotectValues(values);
    slots.forEach((slot, index) => {
      const current = slot.record[slot.field];
      const text = plaintexts[index] ?? "";
      if (isSecretEnvelope(current) && !text) {
        const last4 =
          (typeof slot.record.numberLast4 === "string" && slot.record.numberLast4.trim()) ||
          last4FromNumber(slot.record.number);
        slot.record[slot.field] = slot.field === "number" && last4 ? `••••${last4}` : current;
        return;
      }
      slot.record[slot.field] = text;
    });
  } catch (error) {
    console.error("Could not decrypt card fields.", error);
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
  await decryptSlots(collectPaymentSlots(next));
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
  await decryptSlots(collectCardSlots(next));
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

export function countUsableSecretRecords(store: Record<string, unknown>, kind: "cards" | "profiles"): number {
  return Object.values(store).reduce<number>((count, value) => {
    const record = asRecord(value);
    if (!record) return count;
    const secret = kind === "cards" ? record.number : asRecord(record.payment)?.number;
    return count + (secretFieldUsable(secret) ? 1 : 0);
  }, 0);
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
