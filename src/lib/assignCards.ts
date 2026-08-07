import { applyCreditCardFromPool } from "./profileUtils";
import { cardNumbersMatch } from "./creditCardUtils";
import type { AssignCardsOptions, CreditCard, Profile, ProfileSummary } from "./types";

export function listUnassignedCreditCards(
  cards: CreditCard[],
  profiles: Pick<ProfileSummary, "creditCardId" | "paymentNumber">[],
): CreditCard[] {
  const assignedIds = new Set<string>();
  for (const profile of profiles) {
    if (profile.creditCardId) {
      assignedIds.add(profile.creditCardId);
      continue;
    }
    if (profile.paymentNumber) {
      const matched = cards.find((card) => cardNumbersMatch(profile.paymentNumber!, card.number));
      if (matched) {
        assignedIds.add(matched.id);
      }
    }
  }
  return cards.filter((card) => !assignedIds.has(card.id));
}

/** Pick the first N unassigned pool cards for mass assign (profile order). */
export function pickCardsForMassAssign(
  profileCount: number,
  cards: CreditCard[],
  profiles: ProfileSummary[],
): string[] {
  return listUnassignedCreditCards(cards, profiles)
    .slice(0, profileCount)
    .map((card) => card.id);
}

export function confirmReplaceExistingCards(targetProfiles: ProfileSummary[]): boolean {
  const occupied = targetProfiles.filter(
    (profile) => Boolean(profile.creditCardId || profile.creditCardLabel),
  );
  if (occupied.length === 0) {
    return true;
  }

  const list = occupied
    .map(
      (profile) =>
        `• ${profile.name || "Unnamed"} (current: ${profile.creditCardLabel || "assigned card"})`,
    )
    .join("\n");

  return window.confirm(
    `${occupied.length} profile(s) already have a card assigned:\n\n${list}\n\nReplace with new card(s)?`,
  );
}

export function assignCardsToProfiles(
  profilesToUpdate: Profile[],
  allProfiles: Profile[],
  cards: CreditCard[],
  options: AssignCardsOptions,
): Profile[] {
  if (profilesToUpdate.length === 0 || options.profileIds.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const updatedById = new Map<string, Profile>();

  if (options.creditCardIds?.length) {
    if (
      options.creditCardIds.length !== options.profileIds.length ||
      new Set(options.creditCardIds).size !== options.creditCardIds.length
    ) {
      return [];
    }

    const assignmentByProfile = new Map(
      options.profileIds.map((profileId, index) => [profileId, options.creditCardIds![index]]),
    );
    const assignedCardIds = new Set(options.creditCardIds);
    const profileMap = new Map(profilesToUpdate.map((profile) => [profile.id, profile]));

    for (const profile of allProfiles) {
      if (!profile.creditCardId || !assignedCardIds.has(profile.creditCardId)) {
        continue;
      }
      const nextOwner = [...assignmentByProfile.entries()].find(
        ([, cardId]) => cardId === profile.creditCardId,
      )?.[0];
      if (nextOwner !== profile.id) {
        updatedById.set(profile.id, {
          ...profile,
          creditCardId: undefined,
          updatedAt: now,
        });
      }
    }

    for (const profileId of options.profileIds) {
      const cardId = assignmentByProfile.get(profileId);
      if (!cardId) continue;
      const card = cards.find((item) => item.id === cardId);
      if (!card) continue;

      const profile = updatedById.get(profileId) ?? profileMap.get(profileId);
      if (!profile) continue;

      updatedById.set(profileId, {
        ...applyCreditCardFromPool(profile, cardId, cards),
        updatedAt: now,
      });
    }

    return [...updatedById.values()];
  }

  if (!options.creditCardId) {
    return [];
  }

  const card = cards.find((item) => item.id === options.creditCardId);
  if (!card) {
    return [];
  }

  const targetIds = new Set(options.profileIds);

  for (const profile of allProfiles) {
    if (profile.creditCardId === options.creditCardId && !targetIds.has(profile.id)) {
      updatedById.set(profile.id, {
        ...profile,
        creditCardId: undefined,
        updatedAt: now,
      });
    }
  }

  for (const profile of profilesToUpdate) {
    const cleared = updatedById.get(profile.id) ?? profile;
    updatedById.set(profile.id, applyCreditCardFromPool(cleared, options.creditCardId, cards));
    const next = updatedById.get(profile.id);
    if (next) {
      updatedById.set(profile.id, { ...next, updatedAt: now });
    }
  }

  return [...updatedById.values()];
}
