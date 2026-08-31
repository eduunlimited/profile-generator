import { isCardAvailableForProfile, toAssignableProfiles, type AssignableProfile } from "./assignCards";
import {
  isEmailAvailableForProfile,
  toEmailAssignableProfiles,
  type EmailAssignableProfile,
} from "./assignEmails";

import { collectUsedProfileNames, resolveGeneratedProfileName } from "./profileNameUtils";

import {
  applyJigRulesBatchToMasterAsync,
  applyLocalJigRulesToMaster,
  buildReservedStreetLinesForMisspell,
  buildStreetUseCounts,
  canAssignStreetLine,
  cloneStreetUseCounts,
  finalizeJigFromLocalAndMisspell,
  incrementStreetUse,
  MAX_STREET_LINE1_USES,
  streetLineFingerprint,
  streetUseCount,
  type LocalJigSlot,
} from "./jigEngine";

import {
  applyPhoneLastFourJig,
  normalizeUsPhone,
  phoneLastFour,
  randomUniquePhoneLastFour,
} from "./phoneUtils";

import type {
  CreditCard,
  GenerateFromMasterOptions,
  JigPreset,
  MasterProfile,
  PoolEmail,
  Profile,
  ProfilePayment,
  ProfileSummary,
} from "./types";

import type { ResolvedAddressJig } from "./jigPresetUtils";
import type { OpenAiMisspellResult } from "./openaiMisspell";

const DEFAULT_MAX_LOCAL_ATTEMPTS = 250;
const MAX_BATCH_MISSPELL_PASSES = 3;

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function paymentFromCard(card: CreditCard): ProfilePayment {
  return {
    number: card.number,
    expiry: card.expiry,
    cvv: card.cvv,
    brand: card.brand,
  };
}

function emptyPayment(): ProfilePayment {
  return {
    number: "",
    expiry: "",
    cvv: "",
    brand: "",
  };
}

function resolveCardForProfile(
  mode: GenerateFromMasterOptions["creditCardMode"],
  cards: CreditCard[],
  selectedId: string | undefined,
  targetProfile: AssignableProfile,
  allAssignableProfiles: AssignableProfile[],
  batchUsedCardIds: Set<string>,
): { payment: ProfilePayment; creditCardId?: string } {
  if (mode === "none" || cards.length === 0) {
    return { payment: emptyPayment() };
  }

  if (mode === "selected" && selectedId) {
    const card = cards.find((item) => item.id === selectedId);
    if (card && isCardAvailableForProfile(card, targetProfile, allAssignableProfiles)) {
      batchUsedCardIds.add(card.id);
      return { payment: paymentFromCard(card), creditCardId: card.id };
    }
    return { payment: emptyPayment() };
  }

  const available = cards.filter((card) => {
    if (batchUsedCardIds.has(card.id)) {
      return false;
    }
    return isCardAvailableForProfile(card, targetProfile, allAssignableProfiles);
  });
  const card = pickRandom(available);
  if (!card) {
    return { payment: emptyPayment() };
  }

  batchUsedCardIds.add(card.id);
  return { payment: paymentFromCard(card), creditCardId: card.id };
}

function resolveEmailForProfile(
  mode: GenerateFromMasterOptions["emailMode"] | undefined,
  emails: PoolEmail[],
  selectedId: string | undefined,
  targetProfile: EmailAssignableProfile,
  allAssignableProfiles: EmailAssignableProfile[],
  batchUsedEmailIds: Set<string>,
): { email: string; emailPoolId?: string } {
  if (!mode || mode === "none" || emails.length === 0) {
    return { email: "" };
  }

  if (mode === "selected" && selectedId) {
    const poolEmail = emails.find((item) => item.id === selectedId);
    if (poolEmail && isEmailAvailableForProfile(poolEmail, targetProfile, allAssignableProfiles)) {
      batchUsedEmailIds.add(poolEmail.id);
      return { email: poolEmail.email, emailPoolId: poolEmail.id };
    }
    return { email: "" };
  }

  const available = emails.filter((item) => {
    if (batchUsedEmailIds.has(item.id)) {
      return false;
    }
    return isEmailAvailableForProfile(item, targetProfile, allAssignableProfiles);
  });
  const poolEmail = pickRandom(available);
  if (!poolEmail) {
    return { email: "" };
  }

  batchUsedEmailIds.add(poolEmail.id);
  return { email: poolEmail.email, emailPoolId: poolEmail.id };
}

function reserveLocalSlot(
  master: MasterProfile,
  namePreset: JigPreset | null,
  addressRules: ResolvedAddressJig["rules"],
  nameMisspellScope: GenerateFromMasterOptions["nameMisspellScope"],
  existingCounts: Map<string, number>,
  batchCounts: Map<string, number>,
): LocalJigSlot {
  const slot = applyLocalJigRulesToMaster(
    master,
    namePreset,
    [],
    addressRules,
    nameMisspellScope ?? "both",
  );

  if (slot.needsStreetMisspell) {
    return slot;
  }

  let lastSlot = slot;
  let fallback: { slot: LocalJigSlot; fingerprint: string; count: number } | null = null;

  for (let attempt = 0; attempt < DEFAULT_MAX_LOCAL_ATTEMPTS; attempt += 1) {
    const candidate = applyLocalJigRulesToMaster(
      master,
      namePreset,
      [],
      addressRules,
      nameMisspellScope ?? "both",
    );
    lastSlot = candidate;

    const fingerprint = streetLineFingerprint(candidate.jigAddress.street);
    const used = streetUseCount(existingCounts, fingerprint) + streetUseCount(batchCounts, fingerprint);
    if (used === 0) {
      incrementStreetUse(batchCounts, fingerprint);
      return candidate;
    }
    if (used < MAX_STREET_LINE1_USES && (fallback === null || used < fallback.count)) {
      fallback = { slot: candidate, fingerprint, count: used };
    }
  }

  if (fallback) {
    incrementStreetUse(batchCounts, fallback.fingerprint);
    return fallback.slot;
  }

  const lastFingerprint = streetLineFingerprint(lastSlot.jigAddress.street);
  incrementStreetUse(batchCounts, lastFingerprint);
  return lastSlot;
}

function mergeBatchMisspellResults(
  master: MasterProfile,
  namePreset: JigPreset | null,
  slots: LocalJigSlot[],
  misspellResults: OpenAiMisspellResult[],
): Array<{ name: MasterProfile["name"]; address: Profile["address"] }> {
  return slots.map((slot, index) =>
    finalizeJigFromLocalAndMisspell(master, slot, misspellResults[index], namePreset),
  );
}

function findDuplicateStreetIndexes(
  jiggedProfiles: Array<{ address: Profile["address"] }>,
  existingCounts: Map<string, number>,
): number[] {
  const running = cloneStreetUseCounts(existingCounts);
  const duplicateIndexes: number[] = [];

  for (let index = 0; index < jiggedProfiles.length; index += 1) {
    const fingerprint = streetLineFingerprint(jiggedProfiles[index].address.street);
    if (!canAssignStreetLine(running, fingerprint)) {
      duplicateIndexes.push(index);
      continue;
    }
    incrementStreetUse(running, fingerprint);
  }

  return duplicateIndexes;
}

export async function generateProfilesFromMaster(
  master: MasterProfile,
  options: GenerateFromMasterOptions,
  namePreset: JigPreset | null,
  addressJig: ResolvedAddressJig,
  creditCards: CreditCard[],
  existingProfilesInCategory: Profile[],
  occupancyProfiles?: (Profile | ProfileSummary)[],
  poolEmails: PoolEmail[] = [],
): Promise<Profile[]> {
  const now = new Date().toISOString();
  const usedProfileNames = collectUsedProfileNames(existingProfilesInCategory);
  const streetUseCounts = buildStreetUseCounts(existingProfilesInCategory.map((profile) => profile.address));

  const occupiedPhoneLastFours = new Set(
    existingProfilesInCategory
      .map((profile) => phoneLastFour(profile.phone ?? ""))
      .filter((suffix) => suffix.length === 4),
  );

  const batchCounts = new Map<string, number>();
  const slots: LocalJigSlot[] = [];

  for (let index = 0; index < options.count; index += 1) {
    slots.push(
      reserveLocalSlot(
        master,
        namePreset,
        addressJig.rules,
        options.nameMisspellScope,
        streetUseCounts,
        batchCounts,
      ),
    );
  }

  const needsMisspell = slots.some((slot) => slot.needsNameMisspell || slot.needsStreetMisspell);
  let misspellResults: OpenAiMisspellResult[] = slots.map(() => ({}));

  if (needsMisspell) {
    let pendingIndexes = slots.map((_, index) => index);

    for (let pass = 0; pass < MAX_BATCH_MISSPELL_PASSES && pendingIndexes.length > 0; pass += 1) {
      const indexedPending = pendingIndexes.map((originalIndex) => ({
        index: originalIndex,
        slot: slots[originalIndex],
      }));
      const jiggedSoFar = mergeBatchMisspellResults(master, namePreset, slots, misspellResults);
      const pendingSet = new Set(pendingIndexes);
      const reservedStreetLines = buildReservedStreetLinesForMisspell(
        existingProfilesInCategory.map((profile) => profile.address.street),
        jiggedSoFar.map((item, index) => ({ index, street: item.address.street })),
        pendingSet,
      );

      const batchMisspellMap = await applyJigRulesBatchToMasterAsync(
        master,
        namePreset,
        [],
        addressJig.rules,
        options.nameMisspellScope ?? "both",
        indexedPending,
        reservedStreetLines,
      );

      for (const originalIndex of pendingIndexes) {
        misspellResults[originalIndex] = batchMisspellMap.get(originalIndex) ?? misspellResults[originalIndex];
      }

      const jigged = mergeBatchMisspellResults(master, namePreset, slots, misspellResults);
      const duplicateIndexes = findDuplicateStreetIndexes(jigged, streetUseCounts);

      if (duplicateIndexes.length === 0) {
        break;
      }

      if (pass === MAX_BATCH_MISSPELL_PASSES - 1) {
        break;
      }

      pendingIndexes = duplicateIndexes;
    }
  }

  const jiggedProfiles = mergeBatchMisspellResults(master, namePreset, slots, misspellResults);
  const generated: Profile[] = [];
  let failedCount = 0;
  const batchUsedCardIds = new Set<string>();
  const batchUsedEmailIds = new Set<string>();
  let simulatedAssignable = toAssignableProfiles(occupancyProfiles ?? existingProfilesInCategory);
  let simulatedEmailAssignable = toEmailAssignableProfiles(occupancyProfiles ?? existingProfilesInCategory);

  for (let index = 0; index < jiggedProfiles.length; index += 1) {
    const jigged = jiggedProfiles[index];
    const streetFingerprint = streetLineFingerprint(jigged.address.street);

    if (!canAssignStreetLine(streetUseCounts, streetFingerprint)) {
      failedCount += 1;
      continue;
    }

    let phone = master.phone ?? "";
    if (options.phoneJigLastFour) {
      const baseDigits = normalizeUsPhone(phone);
      if (baseDigits.length < 4) {
        failedCount += 1;
        continue;
      }

      const lastFour = randomUniquePhoneLastFour(occupiedPhoneLastFours);
      if (!lastFour) {
        failedCount += 1;
        continue;
      }

      occupiedPhoneLastFours.add(lastFour);
      phone = applyPhoneLastFourJig(phone, lastFour);
    }

    incrementStreetUse(streetUseCounts, streetFingerprint);

    const profileId = crypto.randomUUID();
    const profileName = resolveGeneratedProfileName(master, usedProfileNames);
    const targetAssignable = {
      id: profileId,
      name: profileName,
      accountSite: "",
      categoryId: options.categoryId,
    };

    const { payment, creditCardId } = resolveCardForProfile(
      options.creditCardMode,
      creditCards,
      options.creditCardId,
      targetAssignable,
      simulatedAssignable,
      batchUsedCardIds,
    );

    if (creditCardId) {
      simulatedAssignable = [
        ...simulatedAssignable,
        {
          ...targetAssignable,
          creditCardId,
          paymentNumber: payment.number.replace(/\D/g, ""),
        },
      ];
    } else {
      simulatedAssignable = [...simulatedAssignable, targetAssignable];
    }

    const emailTargetAssignable = {
      id: profileId,
      name: profileName,
      categoryId: options.categoryId,
    };
    const { email, emailPoolId } = resolveEmailForProfile(
      options.emailMode,
      poolEmails,
      options.emailId,
      emailTargetAssignable,
      simulatedEmailAssignable,
      batchUsedEmailIds,
    );

    if (emailPoolId) {
      simulatedEmailAssignable = [
        ...simulatedEmailAssignable,
        {
          ...emailTargetAssignable,
          emailPoolId,
          email,
        },
      ];
    } else {
      simulatedEmailAssignable = [...simulatedEmailAssignable, emailTargetAssignable];
    }

    generated.push({
      id: profileId,
      locale: "en_US",
      email,
      masterProfileId: master.id,
      generatedFromMaster: true,
      profileName,
      phone,
      categoryId: options.categoryId,
      accountStatus: "good",
      notes: "",
      nameJigPresetId: namePreset?.id,
      nameJigPresetName: namePreset?.name,
      addressJigPresetIds: addressJig.presetIds,
      addressJigPresetName: addressJig.label,
      jigPresetName: [namePreset?.name, addressJig.label].filter(Boolean).join(" + ") || undefined,
      name: jigged.name,
      address: jigged.address,
      billingSameAsShipping: true,
      oneCheckoutPerProfile: true,
      cardHolderSameAsShipping: true,
      cardHolderName: `${jigged.name.first} ${jigged.name.last}`.trim(),
      payment,
      creditCardId,
      emailPoolId,
      credentialIds: [],
      logins: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  if (generated.length === 0 && options.count > 0) {
    const phoneJigHint = options.phoneJigLastFour
      ? " Try disabling phone jig, using a different count, or clearing last-4 duplicates in this category."
      : "";
    throw new Error(
      `Could not generate street line 1 values within the 3-per-category limit.${phoneJigHint} Try Street type combo (PKC/Target) or a lower count.`,
    );
  }

  if (failedCount > 0) {
    const phoneJigHint = options.phoneJigLastFour ? " or unique phone last-4 digits" : "";
    throw new Error(
      `Generated ${generated.length} of ${options.count} profile(s). ${failedCount} could not get a street line 1 under the 3-per-category limit${phoneJigHint}.`,
    );
  }

  return generated;
}
