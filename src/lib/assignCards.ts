import { applyCreditCardFromPool, clearProfileCreditCardAssignment } from "./profileUtils";
import { cardNumbersMatch, isAssignablePoolCard } from "./creditCardUtils";
import { profileCategoryId } from "./profileCategoryUtils";
import type { AssignCardsOptions, CreditCard, Profile, ProfileSummary } from "./types";

export function profileSummaryHasPoolCard(
  profile: Pick<ProfileSummary, "creditCardId" | "creditCardLabel" | "paymentNumber">,
  cards: CreditCard[],
): boolean {
  if (profile.creditCardId) {
    return true;
  }
  const paymentNumber = profile.paymentNumber ?? "";
  if (paymentNumber && cards.some((card) => cardNumbersMatch(card.number, paymentNumber))) {
    return true;
  }
  return false;
}

/** True when the profile has pool-linked or standalone payment data (for unassign / display). */
export function profileSummaryHasAssignedCard(
  profile: Pick<ProfileSummary, "creditCardId" | "creditCardLabel" | "paymentNumber">,
): boolean {
  return Boolean(profile.creditCardId || profile.creditCardLabel || profile.paymentNumber);
}

type AssignableProfile = {
  id: string;
  name: string;
  creditCardId?: string;
  paymentNumber?: string;
  accountSite?: string;
  categoryId?: string;
};

export type { AssignableProfile };

export function toAssignableProfile(profile: ProfileSummary | Profile): AssignableProfile {
  if ("payment" in profile) {
    return {
      id: profile.id,
      name: profile.profileName?.trim() || profile.name.full || "Unnamed",
      creditCardId: profile.creditCardId,
      paymentNumber: profile.payment.number.replace(/\D/g, ""),
      accountSite: profile.accountSite,
      categoryId: profileCategoryId(profile),
    };
  }
  return {
    id: profile.id,
    name: profile.name || "Unnamed",
    creditCardId: profile.creditCardId,
    paymentNumber: profile.paymentNumber,
    accountSite: profile.accountSite,
    categoryId: profileCategoryId(profile),
  };
}

export function toAssignableProfiles(profiles: (ProfileSummary | Profile)[]): AssignableProfile[] {
  return profiles.map(toAssignableProfile);
}

export function cardUsesSingleProfileScope(card: Pick<CreditCard, "assignmentScope">): boolean {
  return card.assignmentScope === "single_profile";
}

function assignmentConflicts(
  card: Pick<CreditCard, "assignmentScope">,
  holder: { id: string; categoryId?: string },
  incoming: { id: string; categoryId?: string },
): boolean {
  if (holder.id === incoming.id) {
    return false;
  }
  if (cardUsesSingleProfileScope(card)) {
    return true;
  }
  return profileCategoryId(holder) === profileCategoryId(incoming);
}

export function profilesUsingCard(card: CreditCard, profiles: AssignableProfile[]): AssignableProfile[] {
  return profiles.filter((profile) => {
    if (profile.creditCardId === card.id) {
      return true;
    }
    if (profile.paymentNumber && cardNumbersMatch(profile.paymentNumber, card.number)) {
      return true;
    }
    return false;
  });
}

export function isCardAvailableForProfile(
  card: CreditCard,
  targetProfile: AssignableProfile,
  allProfiles: AssignableProfile[],
): boolean {
  if (!isAssignablePoolCard(card)) {
    return false;
  }

  const otherAssignees = profilesUsingCard(card, allProfiles).filter(
    (profile) => profile.id !== targetProfile.id,
  );

  if (otherAssignees.length === 0) {
    return true;
  }

  return !otherAssignees.some((profile) => assignmentConflicts(card, profile, targetProfile));
}

export function cardIdsUsedByProfiles(
  profiles: (ProfileSummary | Profile)[],
  cards: CreditCard[],
): Set<string> {
  const used = new Set<string>();
  for (const profile of profiles) {
    if (!profileSummaryHasPoolCard(profile, cards)) {
      continue;
    }
    if (profile.creditCardId) {
      used.add(profile.creditCardId);
      continue;
    }
    const paymentNumber =
      "payment" in profile ? profile.payment.number.replace(/\D/g, "") : profile.paymentNumber ?? "";
    const matched = cards.find((card) => cardNumbersMatch(card.number, paymentNumber));
    if (matched) {
      used.add(matched.id);
    }
  }
  return used;
}

/** Profiles still needed (beyond existing no-card slots) to assign every usable pool card in this category. */
export function countProfilesToCreateForFullCardUse(
  scopeProfiles: ProfileSummary[],
  creditCards: CreditCard[],
  allProfiles: ProfileSummary[],
): number {
  if (scopeProfiles.length === 0 || creditCards.length === 0) {
    return 0;
  }

  const usedInCategory = cardIdsUsedByProfiles(scopeProfiles, creditCards);
  const profilesWithoutCards = scopeProfiles.filter(
    (profile) => !profileSummaryHasPoolCard(profile, creditCards),
  );
  const referenceProfile =
    profilesWithoutCards[0] ??
    ({
      ...scopeProfiles[0],
      creditCardId: undefined,
      creditCardLabel: undefined,
      paymentNumber: undefined,
      cardNumberMasked: "",
      cardBrand: "",
    } satisfies ProfileSummary);

  const referenceTarget = toAssignableProfile(referenceProfile);
  const allAssignable = toAssignableProfiles(allProfiles);

  let totalCapacity = usedInCategory.size;
  for (const card of creditCards) {
    if (!isAssignablePoolCard(card)) {
      continue;
    }
    if (usedInCategory.has(card.id)) {
      continue;
    }
    if (isCardAvailableForProfile(card, referenceTarget, allAssignable)) {
      totalCapacity += 1;
    }
  }

  return Math.max(0, totalCapacity - usedInCategory.size - profilesWithoutCards.length);
}

export function listCreditCardsAvailableForAnyProfile(
  cards: CreditCard[],
  targetProfiles: (ProfileSummary | Profile)[],
  allProfiles: (ProfileSummary | Profile)[],
): CreditCard[] {
  const targets = toAssignableProfiles(targetProfiles);
  const all = toAssignableProfiles(allProfiles);
  if (targets.length === 0) {
    return cards.filter((card) => isAssignablePoolCard(card) && profilesUsingCard(card, all).length === 0);
  }
  return cards.filter((card) =>
    targets.some((target) => isCardAvailableForProfile(card, target, all)),
  );
}

export function listAvailableCreditCardsForProfiles(
  cards: CreditCard[],
  targetProfiles: (ProfileSummary | Profile)[],
  allProfiles: (ProfileSummary | Profile)[],
): CreditCard[] {
  const targets = toAssignableProfiles(targetProfiles);
  const all = toAssignableProfiles(allProfiles);
  if (targets.length === 0) {
    return cards.filter(isAssignablePoolCard);
  }
  return cards.filter((card) => targets.every((target) => isCardAvailableForProfile(card, target, all)));
}

/** @deprecated Use listAvailableCreditCardsForProfiles with explicit target profiles. */
export function listUnassignedCreditCards(
  cards: CreditCard[],
  profiles: (ProfileSummary | Profile)[],
): CreditCard[] {
  return listAvailableCreditCardsForProfiles(cards, profiles, profiles);
}

function applyBatchAssignmentToProfiles(
  allProfiles: AssignableProfile[],
  assignments: Array<{ profileId: string; card: CreditCard }>,
): AssignableProfile[] {
  let simulated = allProfiles;
  for (const { profileId, card } of assignments) {
    simulated = simulated.map((profile) =>
      profile.id === profileId
        ? { ...profile, creditCardId: card.id, paymentNumber: card.number }
        : profile,
    );
  }
  return simulated;
}

/** Cards eligible for the next profile slot in an ordered batch assign. */
export function listAvailableCardsForNextBatchSlot(
  cards: CreditCard[],
  targetProfiles: (ProfileSummary | Profile)[],
  allProfiles: (ProfileSummary | Profile)[],
  selectedCardIds: string[],
): CreditCard[] {
  const targets = toAssignableProfiles(targetProfiles);
  const nextIndex = selectedCardIds.length;
  if (nextIndex >= targets.length) {
    return [];
  }

  const assignments: Array<{ profileId: string; card: CreditCard }> = [];
  for (let index = 0; index < selectedCardIds.length; index += 1) {
    const card = cards.find((item) => item.id === selectedCardIds[index]);
    if (!card) {
      continue;
    }
    assignments.push({ profileId: targets[index].id, card });
  }

  const simulatedAll = applyBatchAssignmentToProfiles(toAssignableProfiles(allProfiles), assignments);
  const selectedSet = new Set(selectedCardIds);
  const nextTarget = targets[nextIndex];

  return cards.filter(
    (card) => !selectedSet.has(card.id) && isCardAvailableForProfile(card, nextTarget, simulatedAll),
  );
}

/** Selected cards plus the next valid choices for ordered batch assign (profile 1, then 2, …). */
export function listDisplayCardsForBatchAssign(
  cards: CreditCard[],
  targetProfiles: (ProfileSummary | Profile)[],
  allProfiles: (ProfileSummary | Profile)[],
  selectedCardIds: string[],
): CreditCard[] {
  const selectedCards = selectedCardIds
    .map((id) => cards.find((card) => card.id === id))
    .filter((card): card is CreditCard => Boolean(card));

  if (selectedCardIds.length >= targetProfiles.length) {
    return selectedCards;
  }

  const nextSlot = listAvailableCardsForNextBatchSlot(
    cards,
    targetProfiles,
    allProfiles,
    selectedCardIds,
  );
  const visibleIds = new Set([...selectedCards.map((card) => card.id), ...nextSlot.map((card) => card.id)]);
  return cards.filter((card) => visibleIds.has(card.id));
}

/** How many profiles in order can receive a distinct card from the pool. */
export function countCompletableBatchAssignments(
  targetProfiles: (ProfileSummary | Profile)[],
  cards: CreditCard[],
  allProfiles: (ProfileSummary | Profile)[],
): number {
  return pickCardsForMassAssign(targetProfiles, cards, allProfiles).length;
}

/** Pick the first N available pool cards for mass assign (profile order). */
export function pickCardsForMassAssign(
  targetProfiles: (ProfileSummary | Profile)[],
  cards: CreditCard[],
  allProfiles: (ProfileSummary | Profile)[],
): string[] {
  const targets = toAssignableProfiles(targetProfiles);
  let simulatedProfiles = toAssignableProfiles(allProfiles);
  const picked: string[] = [];

  for (const target of targets) {
    const available = cards.filter((card) => {
      if (picked.includes(card.id)) {
        return false;
      }
      return isCardAvailableForProfile(card, target, simulatedProfiles);
    });
    if (available.length === 0) {
      break;
    }
    const card = available[0];
    picked.push(card.id);
    simulatedProfiles = simulatedProfiles.map((profile) =>
      profile.id === target.id
        ? { ...profile, creditCardId: card.id, paymentNumber: card.number }
        : profile,
    );
  }

  return picked;
}

export function confirmReplaceExistingCards(
  targetProfiles: ProfileSummary[],
  cards: CreditCard[],
): boolean {
  const occupied = targetProfiles.filter((profile) => profileSummaryHasPoolCard(profile, cards));
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

export function validateCardAssignments(
  profileIds: string[],
  cardIds: string[],
  cards: CreditCard[],
  allProfiles: (ProfileSummary | Profile)[],
): string | null {
  const assignableProfiles = toAssignableProfiles(allProfiles);
  const profileMap = new Map(assignableProfiles.map((profile) => [profile.id, profile]));
  let simulatedProfiles = assignableProfiles;

  for (let index = 0; index < profileIds.length; index += 1) {
    const profile = profileMap.get(profileIds[index]);
    const card = cards.find((item) => item.id === cardIds[index]);
    if (!profile || !card) {
      continue;
    }
    if (!isCardAvailableForProfile(card, profile, simulatedProfiles)) {
      const scopeLabel = cardUsesSingleProfileScope(card)
        ? "another profile"
        : "another profile in the same category";
      return `"${card.profileName}" is not available for "${profile.name}" — already assigned to ${scopeLabel}.`;
    }
    simulatedProfiles = simulatedProfiles.map((item) =>
      item.id === profile.id
        ? { ...item, creditCardId: card.id, paymentNumber: card.number }
        : item,
    );
  }
  return null;
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
      const nextOwnerId = [...assignmentByProfile.entries()].find(
        ([, cardId]) => cardId === profile.creditCardId,
      )?.[0];
      if (!nextOwnerId || nextOwnerId === profile.id) {
        continue;
      }
      const card = cards.find((item) => item.id === profile.creditCardId);
      const nextOwner = profileMap.get(nextOwnerId) ?? allProfiles.find((item) => item.id === nextOwnerId);
      if (!card || !nextOwner || !assignmentConflicts(card, profile, nextOwner)) {
        continue;
      }
      updatedById.set(profile.id, {
        ...profile,
        creditCardId: undefined,
        updatedAt: now,
      });
    }

    for (const profileId of options.profileIds) {
      const cardId = assignmentByProfile.get(profileId);
      if (!cardId) continue;
      const card = cards.find((item) => item.id === cardId);
      if (!card || !isAssignablePoolCard(card)) continue;

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
  if (!card || !isAssignablePoolCard(card)) {
    return [];
  }

  const targetIds = new Set(options.profileIds);

  for (const profile of allProfiles) {
    if (profile.creditCardId !== options.creditCardId || targetIds.has(profile.id)) {
      continue;
    }
    const conflicts = profilesToUpdate.some((target) => assignmentConflicts(card, profile, target));
    if (!conflicts) {
      continue;
    }
    updatedById.set(profile.id, {
      ...profile,
      creditCardId: undefined,
      updatedAt: now,
    });
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

export function unassignCardsFromProfiles(profilesToUpdate: Profile[]): Profile[] {
  if (profilesToUpdate.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  return profilesToUpdate
    .filter(
      (profile) =>
        profile.creditCardId ||
        profile.payment.number.trim() ||
        profile.payment.expiry.trim() ||
        profile.payment.cvv.trim(),
    )
    .map((profile) => ({
      ...clearProfileCreditCardAssignment(profile),
      updatedAt: now,
    }));
}
