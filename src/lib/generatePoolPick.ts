import {
  isCardAvailableForProfile,
  listAvailableCardsForNextBatchSlot,
  toAssignableProfile,
  toAssignableProfiles,
} from "./assignCards";
import {
  isEmailAvailableForProfile,
  listAvailableEmailsForNextBatchSlot,
  toEmailAssignableProfile,
  toEmailAssignableProfiles,
} from "./assignEmails";
import type { CreditCard, PoolEmail, Profile, ProfileSummary } from "./types";

/** Stand-in group id so a not-yet-created group does not collide with an existing one. */
export const PENDING_GENERATE_GROUP_ID = "pending-new-group";

function slotProfile(index: number, groupId: string): Profile {
  return {
    id: `generate-slot-${index}`,
    locale: "en_US",
    email: "",
    profileName: `Profile ${index + 1}`,
    groupId,
    categoryId: groupId,
    accountStatus: "good",
    notes: "",
    name: { first: "Profile", last: String(index + 1), full: `Profile ${index + 1}` },
    address: { street: "", city: "", state: "", postalCode: "", country: "US" },
    payment: { number: "", expiry: "", cvv: "", brand: "" },
    credentialIds: [],
    logins: [],
    createdAt: "",
    updatedAt: "",
  };
}

function slotProfiles(slotCount: number, groupId: string): Profile[] {
  return Array.from({ length: Math.max(0, slotCount) }, (_, index) => slotProfile(index, groupId));
}

/** Cards that stay visible but cannot be picked for the next generated profile. */
export function disabledCardIdsForGenerate(
  cards: CreditCard[],
  profiles: ProfileSummary[],
  groupId: string,
  slotCount: number,
  selectedCardIds: string[],
): string[] {
  if (slotCount <= 0) {
    return cards.map((card) => card.id);
  }
  const nextIds = new Set(
    listAvailableCardsForNextBatchSlot(
      cards,
      slotProfiles(slotCount, groupId),
      profiles,
      selectedCardIds,
    ).map((card) => card.id),
  );
  const selected = new Set(selectedCardIds);
  return cards.filter((card) => !selected.has(card.id) && !nextIds.has(card.id)).map((card) => card.id);
}

/** Emails that stay visible but cannot be picked for the next generated profile. */
export function disabledEmailIdsForGenerate(
  emails: PoolEmail[],
  profiles: ProfileSummary[],
  groupId: string,
  slotCount: number,
  selectedEmailIds: string[],
): string[] {
  if (slotCount <= 0) {
    return emails.map((email) => email.id);
  }
  const nextIds = new Set(
    listAvailableEmailsForNextBatchSlot(
      emails,
      slotProfiles(slotCount, groupId),
      profiles,
      selectedEmailIds,
    ).map((email) => email.id),
  );
  const selected = new Set(selectedEmailIds);
  return emails.filter((email) => !selected.has(email.id) && !nextIds.has(email.id)).map((email) => email.id);
}

/** Drop picks that are already used in this group, or that no longer fit the profile count. */
export function pruneGenerateCardIds(
  cards: CreditCard[],
  profiles: ProfileSummary[],
  groupId: string,
  slotCount: number,
  selectedCardIds: string[],
): string[] {
  if (slotCount <= 0) return [];
  const target = toAssignableProfile(slotProfile(0, groupId));
  const all = toAssignableProfiles(profiles);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of selectedCardIds) {
    if (seen.has(id) || kept.length >= slotCount) continue;
    const card = cards.find((item) => item.id === id);
    if (!card || !isCardAvailableForProfile(card, target, all)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

/** Drop picks that are already used in this group, or that no longer fit the profile count. */
export function pruneGenerateEmailIds(
  emails: PoolEmail[],
  profiles: ProfileSummary[],
  groupId: string,
  slotCount: number,
  selectedEmailIds: string[],
): string[] {
  if (slotCount <= 0) return [];
  const target = toEmailAssignableProfile(slotProfile(0, groupId));
  const all = toEmailAssignableProfiles(profiles);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of selectedEmailIds) {
    if (seen.has(id) || kept.length >= slotCount) continue;
    const email = emails.find((item) => item.id === id);
    if (!email || !isEmailAvailableForProfile(email, target, all)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

export function countCardsAvailableForGenerate(
  cards: CreditCard[],
  profiles: ProfileSummary[],
  groupId: string,
): number {
  return listAvailableCardsForNextBatchSlot(cards, slotProfiles(1, groupId), profiles, []).length;
}

export function countEmailsAvailableForGenerate(
  emails: PoolEmail[],
  profiles: ProfileSummary[],
  groupId: string,
): number {
  return listAvailableEmailsForNextBatchSlot(emails, slotProfiles(1, groupId), profiles, []).length;
}
