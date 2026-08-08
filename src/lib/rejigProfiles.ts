import {
  applyJigRulesBatchToMasterAsync,
  applyLocalJigRulesToMaster,
  collectUniqueStreetLines,
  finalizeJigFromLocalAndMisspell,
  streetLineFingerprint,
  type LocalJigSlot,
} from "./jigEngine";
import type { ResolvedAddressJig } from "./jigPresetUtils";
import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "./profileCategoryUtils";
import {
  applyPhoneLastFourJig,
  normalizeUsPhone,
  phoneLastFour,
  randomUniquePhoneLastFour,
} from "./phoneUtils";
import type { JigPreset, MasterProfile, NameMisspellScope, Profile } from "./types";
import type { OpenAiMisspellResult } from "./openaiMisspell";

const DEFAULT_MAX_ATTEMPTS = 250;
const MAX_BATCH_MISSPELL_PASSES = 3;

export interface RejigProfilesParams {
  nameMisspellScope?: NameMisspellScope;
  phoneJigLastFour?: boolean;
}

function profileCategoryId(profile: Profile): string {
  return profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID;
}

function buildOccupiedStreetsByCategory(
  allProfiles: Profile[],
  reJigIds: Set<string>,
): Map<string, Set<string>> {
  const byCategory = new Map<string, Set<string>>();
  for (const profile of allProfiles) {
    if (reJigIds.has(profile.id)) continue;
    const categoryId = profileCategoryId(profile);
    const occupied = byCategory.get(categoryId) ?? new Set<string>();
    occupied.add(streetLineFingerprint(profile.address.street));
    byCategory.set(categoryId, occupied);
  }
  return byCategory;
}

function collectCategoryReservedStreetLines(
  allProfiles: Profile[],
  reJigIds: Set<string>,
  categoryIds: Set<string>,
  batchStreetsByIndex: Array<{ index: number; street: string; categoryId: string }>,
  excludeBatchIndexes: Set<number>,
): string[] {
  const streets = allProfiles
    .filter(
      (profile) =>
        !reJigIds.has(profile.id) && categoryIds.has(profileCategoryId(profile)),
    )
    .map((profile) => profile.address.street);

  for (const { index, street, categoryId } of batchStreetsByIndex) {
    if (excludeBatchIndexes.has(index)) continue;
    if (!categoryIds.has(categoryId)) continue;
    streets.push(street);
  }

  return collectUniqueStreetLines(streets);
}

function isStreetDuplicateInCategory(
  fingerprint: string,
  categoryId: string,
  occupiedByCategory: Map<string, Set<string>>,
  batchByCategory: Map<string, Set<string>>,
): boolean {
  if (occupiedByCategory.get(categoryId)?.has(fingerprint)) return true;
  if (batchByCategory.get(categoryId)?.has(fingerprint)) return true;
  return false;
}

export async function rejigProfiles(
  master: MasterProfile,
  profilesToUpdate: Profile[],
  allProfiles: Profile[],
  namePreset: JigPreset | null,
  addressJig: ResolvedAddressJig,
  params: RejigProfilesParams = {},
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<{ updated: Profile[]; failedIds: string[] }> {
  const reJigIds = new Set(profilesToUpdate.map((profile) => profile.id));
  const nameMisspellScope = params.nameMisspellScope ?? "both";
  const occupiedByCategory = buildOccupiedStreetsByCategory(allProfiles, reJigIds);
  const categoryIds = new Set(profilesToUpdate.map(profileCategoryId));
  const now = new Date().toISOString();

  const occupiedPhoneLastFours = new Set(
    allProfiles
      .filter((profile) => !reJigIds.has(profile.id))
      .map((profile) => phoneLastFour(profile.phone ?? ""))
      .filter((suffix) => suffix.length === 4),
  );

  const slots: LocalJigSlot[] = profilesToUpdate.map(() =>
    applyLocalJigRulesToMaster(master, namePreset, [], addressJig.rules, nameMisspellScope),
  );
  const needsMisspell = slots.some((slot) => slot.needsNameMisspell || slot.needsStreetMisspell);
  let misspellResults: OpenAiMisspellResult[] = slots.map(() => ({}));

  if (needsMisspell) {
    let pendingIndexes = profilesToUpdate.map((_, index) => index);

    for (let pass = 0; pass < MAX_BATCH_MISSPELL_PASSES && pendingIndexes.length > 0; pass += 1) {
      const indexedPending = pendingIndexes.map((originalIndex) => ({
        index: originalIndex,
        slot: slots[originalIndex],
      }));
      const jiggedSoFar = slots.map((slot, index) =>
        finalizeJigFromLocalAndMisspell(master, slot, misspellResults[index], namePreset),
      );
      const pendingSet = new Set(pendingIndexes);
      const reservedStreetLines = collectCategoryReservedStreetLines(
        allProfiles,
        reJigIds,
        categoryIds,
        jiggedSoFar.map((item, index) => ({
          index,
          street: item.address.street,
          categoryId: profileCategoryId(profilesToUpdate[index]),
        })),
        pendingSet,
      );

      const batchMisspellMap = await applyJigRulesBatchToMasterAsync(
        master,
        namePreset,
        [],
        addressJig.rules,
        nameMisspellScope,
        indexedPending,
        reservedStreetLines,
      );

      for (const originalIndex of pendingIndexes) {
        misspellResults[originalIndex] = batchMisspellMap.get(originalIndex) ?? misspellResults[originalIndex];
      }

      const jigged = slots.map((slot, index) =>
        finalizeJigFromLocalAndMisspell(master, slot, misspellResults[index], namePreset),
      );
      const duplicateIndexes = jigged
        .map((item, index) => ({
          index,
          fingerprint: streetLineFingerprint(item.address.street),
          categoryId: profileCategoryId(profilesToUpdate[index]),
        }))
        .filter(({ fingerprint, categoryId }, index, list) => {
          const occupied = occupiedByCategory.get(categoryId) ?? new Set<string>();
          if (occupied.has(fingerprint)) return true;
          return (
            list.findIndex(
              (entry) => entry.categoryId === categoryId && entry.fingerprint === fingerprint,
            ) !== index
          );
        })
        .map(({ index }) => index);

      if (duplicateIndexes.length === 0 || pass === MAX_BATCH_MISSPELL_PASSES - 1) {
        break;
      }

      pendingIndexes = duplicateIndexes;
    }
  }

  const updated: Profile[] = [];
  const failedIds: string[] = [];
  const batchByCategory = new Map<string, Set<string>>();

  for (let index = 0; index < profilesToUpdate.length; index += 1) {
    const profile = profilesToUpdate[index];
    const categoryId = profileCategoryId(profile);
    let merged: Profile | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const slot =
        attempt === 0
          ? slots[index]
          : applyLocalJigRulesToMaster(
              master,
              namePreset,
              [],
              addressJig.rules,
              nameMisspellScope,
            );
      const misspell = needsMisspell ? misspellResults[index] : undefined;
      const jigged = finalizeJigFromLocalAndMisspell(master, slot, misspell, namePreset);
      const fingerprint = streetLineFingerprint(jigged.address.street);

      if (
        isStreetDuplicateInCategory(fingerprint, categoryId, occupiedByCategory, batchByCategory) &&
        attempt < maxAttempts - 1
      ) {
        continue;
      }

      const categoryBatch = batchByCategory.get(categoryId) ?? new Set<string>();
      categoryBatch.add(fingerprint);
      batchByCategory.set(categoryId, categoryBatch);
      occupiedByCategory.get(categoryId)?.add(fingerprint);

      let phone = profile.phone ?? master.phone ?? "";
      if (params.phoneJigLastFour) {
        const baseDigits = normalizeUsPhone(master.phone ?? profile.phone ?? "");
        if (baseDigits.length < 4) {
          if (attempt >= maxAttempts - 1) {
            failedIds.push(profile.id);
          }
          continue;
        }

        const lastFour = randomUniquePhoneLastFour(occupiedPhoneLastFours);
        if (!lastFour) {
          if (attempt >= maxAttempts - 1) {
            failedIds.push(profile.id);
          }
          continue;
        }

        occupiedPhoneLastFours.add(lastFour);
        phone = applyPhoneLastFourJig(master.phone ?? profile.phone ?? "", lastFour);
      }

      merged = {
        ...profile,
        nameJigPresetId: namePreset?.id,
        nameJigPresetName: namePreset?.name,
        addressJigPresetIds: addressJig.presetIds.length > 0 ? addressJig.presetIds : undefined,
        addressJigPresetName: addressJig.label,
        jigPresetName:
          [namePreset?.name, addressJig.label].filter(Boolean).join(" + ") || undefined,
        name: namePreset ? jigged.name : profile.name,
        address: jigged.address,
        phone,
        cardHolderName: namePreset
          ? `${jigged.name.first} ${jigged.name.last}`.trim()
          : profile.cardHolderName,
        updatedAt: now,
      };
      break;
    }

    if (merged) {
      updated.push(merged);
    } else if (!failedIds.includes(profile.id)) {
      failedIds.push(profile.id);
    }
  }

  return { updated, failedIds };
}
