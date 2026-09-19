import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./env";
import type { Profile } from "./types";

export const PROFILES_STORAGE_KEY = "profile-generator:profiles";
export const CREDIT_CARDS_STORAGE_KEY = "profile-generator:credit-cards";

export const SECRET_STORAGE_KEYS = new Set([PROFILES_STORAGE_KEY, CREDIT_CARDS_STORAGE_KEY]);

/** Card/profile PAN+CVV vault encryption is off. Values stay plaintext. */
const CARD_FIELD_ENCRYPTION_ENABLED = false;

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

function plaintextFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null || isSecretEnvelope(value)) return "";
  return "";
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

function stripSecretSlots(slots: SecretSlot[]): void {
  for (const slot of slots) {
    slot.record[slot.field] = plaintextFromValue(slot.record[slot.field]);
  }
}

export async function encryptProfilesMap(
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = cloneJson(store);
  if (!CARD_FIELD_ENCRYPTION_ENABLED) {
    stripSecretSlots(collectPaymentSlots(next));
    return next;
  }
  return next;
}

export async function decryptProfilesMap(
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = cloneJson(store);
  stripSecretSlots(collectPaymentSlots(next));
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
  if (!CARD_FIELD_ENCRYPTION_ENABLED) {
    stripSecretSlots(collectCardSlots(next));
    return next;
  }
  return next;
}

export async function decryptCreditCardsMap(
  store: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = cloneJson(store);
  stripSecretSlots(collectCardSlots(next));
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
