import { generateProfile } from "./generator";

import { resolveGeneratedProfileName } from "./profileNameUtils";

import {
  applyJigRulesBatchToMasterAsync,
  applyLocalJigRulesToMaster,
  buildReservedStreetLinesForMisspell,
  buildStreetUseCounts,
  finalizeJigFromLocalAndMisspell,
  streetLineFingerprint,
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
  Profile,
  ProfilePayment,
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

function resolveCard(
  mode: GenerateFromMasterOptions["creditCardMode"],
  cards: CreditCard[],
  selectedId: string | undefined,
): { payment: ProfilePayment; creditCardId?: string } {
  if (mode === "none" || cards.length === 0) {
    return { payment: generateProfile().payment };
  }

  if (mode === "selected" && selectedId) {
    const card = cards.find((item) => item.id === selectedId);
    if (card) return { payment: paymentFromCard(card), creditCardId: card.id };
  }

  const card = pickRandom(cards);
  return card
    ? { payment: paymentFromCard(card), creditCardId: card.id }
    : { payment: generateProfile().payment };
}

function reserveLocalSlot(
  master: MasterProfile,
  namePreset: JigPreset | null,
  addressRules: ResolvedAddressJig["rules"],
  nameMisspellScope: GenerateFromMasterOptions["nameMisspellScope"],
  occupiedStreets: Set<string>,
  batchStreets: Set<string>,
): { slot: LocalJigSlot; allowStreetReuse: boolean } {
  const slot = applyLocalJigRulesToMaster(
    master,
    namePreset,
    [],
    addressRules,
    nameMisspellScope ?? "both",
  );

  if (slot.needsStreetMisspell) {
    return { slot, allowStreetReuse: false };
  }

  let lastSlot = slot;
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
    if (!occupiedStreets.has(fingerprint) && !batchStreets.has(fingerprint)) {
      batchStreets.add(fingerprint);
      return { slot: candidate, allowStreetReuse: false };
    }
  }

  batchStreets.add(streetLineFingerprint(lastSlot.jigAddress.street));
  return { slot: lastSlot, allowStreetReuse: true };
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
  occupiedStreets: Set<string>,
  allowReuseByIndex: boolean[],
): number[] {
  const seenInBatch = new Set<string>();
  const duplicateIndexes: number[] = [];

  for (let index = 0; index < jiggedProfiles.length; index += 1) {
    const fingerprint = streetLineFingerprint(jiggedProfiles[index].address.street);
    const duplicateInBatch = seenInBatch.has(fingerprint);
    const duplicateInCategory = occupiedStreets.has(fingerprint);

    if (duplicateInBatch || (duplicateInCategory && !allowReuseByIndex[index])) {
      duplicateIndexes.push(index);
    } else {
      seenInBatch.add(fingerprint);
    }
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
  existingChildCount = 0,
): Promise<Profile[]> {
  const now = new Date().toISOString();
  const streetUseCounts = buildStreetUseCounts(existingProfilesInCategory.map((profile) => profile.address));
  const occupiedStreets = new Set(streetUseCounts.keys());

  const occupiedPhoneLastFours = new Set(
    existingProfilesInCategory
      .map((profile) => phoneLastFour(profile.phone ?? ""))
      .filter((suffix) => suffix.length === 4),
  );

  const batchStreets = new Set<string>();
  const slots: LocalJigSlot[] = [];
  const allowStreetReuseByIndex: boolean[] = [];

  for (let index = 0; index < options.count; index += 1) {
    const reserved = reserveLocalSlot(
      master,
      namePreset,
      addressJig.rules,
      options.nameMisspellScope,
      occupiedStreets,
      batchStreets,
    );
    slots.push(reserved.slot);
    allowStreetReuseByIndex.push(reserved.allowStreetReuse);
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
      const duplicateIndexes = findDuplicateStreetIndexes(jigged, occupiedStreets, allowStreetReuseByIndex);

      if (duplicateIndexes.length === 0) {
        break;
      }

      if (pass === MAX_BATCH_MISSPELL_PASSES - 1) {
        for (const index of duplicateIndexes) {
          if (!allowStreetReuseByIndex[index]) {
            allowStreetReuseByIndex[index] = true;
          }
        }
        break;
      }

      pendingIndexes = duplicateIndexes;
    }
  }

  const jiggedProfiles = mergeBatchMisspellResults(master, namePreset, slots, misspellResults);
  const generated: Profile[] = [];
  let failedCount = 0;

  for (let index = 0; index < jiggedProfiles.length; index += 1) {
    const jigged = jiggedProfiles[index];
    const streetFingerprint = streetLineFingerprint(jigged.address.street);
    const allowReuse = allowStreetReuseByIndex[index];

    if (occupiedStreets.has(streetFingerprint) && !allowReuse) {
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

    occupiedStreets.add(streetFingerprint);
    streetUseCounts.set(streetFingerprint, (streetUseCounts.get(streetFingerprint) ?? 0) + 1);

    const { payment, creditCardId } = resolveCard(
      options.creditCardMode,
      creditCards,
      options.creditCardId,
    );

    generated.push({
      id: crypto.randomUUID(),
      locale: "en_US",
      email: "",
      masterProfileId: master.id,
      generatedFromMaster: true,
      profileName: resolveGeneratedProfileName(master, existingChildCount + generated.length),
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
      `Could not generate unique street line 1 values in this category.${phoneJigHint} Try different address jigs or a lower count.`,
    );
  }

  if (failedCount > 0) {
    const phoneJigHint = options.phoneJigLastFour ? " or unique phone last-4 digits" : "";
    throw new Error(
      `Generated ${generated.length} of ${options.count} profile(s). ${failedCount} could not get a unique street line 1${phoneJigHint} in this category.`,
    );
  }

  return generated;
}
