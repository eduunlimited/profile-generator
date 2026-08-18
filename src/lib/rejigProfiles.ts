import {
  addressRulesChangeStreetLine,
  applyJigRulesBatchToMasterAsync,
  applyLocalJigRulesToProfile,
  buildStreetUseCounts,
  canAssignStreetLine,
  collectUniqueStreetLines,
  finalizeRejigFromLocalAndMisspell,
  incrementStreetUse,
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
import { billingFullName } from "./profileNameUtils";
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

function buildStreetUseCountsByCategory(
  allProfiles: Profile[],
  reJigIds: Set<string>,
): Map<string, Map<string, number>> {
  const byCategory = new Map<string, Profile[]>();
  for (const profile of allProfiles) {
    if (reJigIds.has(profile.id)) continue;
    const categoryId = profileCategoryId(profile);
    const bucket = byCategory.get(categoryId) ?? [];
    bucket.push(profile);
    byCategory.set(categoryId, bucket);
  }

  const countsByCategory = new Map<string, Map<string, number>>();
  for (const [categoryId, profiles] of byCategory) {
    countsByCategory.set(
      categoryId,
      buildStreetUseCounts(profiles.map((profile) => profile.address)),
    );
  }
  return countsByCategory;
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

  const counts = buildStreetUseCounts(streets.map((street) => ({ street })));
  return collectUniqueStreetLines(
    streets.filter((street) => !canAssignStreetLine(counts, streetLineFingerprint(street))),
  );
}

function isStreetAtCapInCategory(
  fingerprint: string,
  categoryId: string,
  occupiedByCategory: Map<string, Map<string, number>>,
): boolean {
  return !canAssignStreetLine(occupiedByCategory.get(categoryId) ?? new Map(), fingerprint);
}

function incrementCategoryStreetUse(
  countsByCategory: Map<string, Map<string, number>>,
  categoryId: string,
  fingerprint: string,
): void {
  const counts = countsByCategory.get(categoryId) ?? new Map<string, number>();
  incrementStreetUse(counts, fingerprint);
  countsByCategory.set(categoryId, counts);
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
  const occupiedByCategory = buildStreetUseCountsByCategory(allProfiles, reJigIds);
  const categoryIds = new Set(profilesToUpdate.map(profileCategoryId));
  const now = new Date().toISOString();

  const occupiedPhoneLastFours = new Set(
    allProfiles
      .filter((profile) => !reJigIds.has(profile.id))
      .map((profile) => phoneLastFour(profile.phone ?? ""))
      .filter((suffix) => suffix.length === 4),
  );

  const hasAddressJig = addressJig.rules.some((rule) => rule.type !== "splitLines");
  const changesStreetLine = addressRulesChangeStreetLine(addressJig.rules);
  const slots: LocalJigSlot[] = profilesToUpdate.map((profile) =>
    applyLocalJigRulesToProfile(profile, master, namePreset, [], addressJig.rules, nameMisspellScope),
  );
  const needsNameMisspell = slots.some((slot) => slot.needsNameMisspell);
  const needsStreetMisspell = slots.some((slot) => slot.needsStreetMisspell);
  const needsMisspell = needsNameMisspell || needsStreetMisspell;
  let misspellResults: OpenAiMisspellResult[] = slots.map(() => ({}));

  if (needsMisspell) {
    let pendingIndexes = profilesToUpdate.map((_, index) => index);

    for (let pass = 0; pass < MAX_BATCH_MISSPELL_PASSES && pendingIndexes.length > 0; pass += 1) {
      const indexedPending = pendingIndexes.map((originalIndex) => ({
        index: originalIndex,
        slot: slots[originalIndex],
        nameSource: profilesToUpdate[originalIndex].name,
      }));
      const jiggedSoFar = slots.map((slot, slotIndex) =>
        finalizeRejigFromLocalAndMisspell(
          profilesToUpdate[slotIndex],
          master,
          slot,
          misspellResults[slotIndex],
          namePreset,
        ),
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

      const jigged = slots.map((slot, slotIndex) =>
        finalizeRejigFromLocalAndMisspell(
          profilesToUpdate[slotIndex],
          master,
          slot,
          misspellResults[slotIndex],
          namePreset,
        ),
      );
      const runningByCategory = new Map<string, Map<string, number>>();
      for (const [categoryId, counts] of occupiedByCategory) {
        runningByCategory.set(categoryId, new Map(counts));
      }
      const duplicateIndexes = needsStreetMisspell
        ? jigged
            .map((item, index) => ({
              index,
              fingerprint: streetLineFingerprint(item.address.street),
              categoryId: profileCategoryId(profilesToUpdate[index]),
            }))
            .filter(({ fingerprint, categoryId }) => {
              const running = runningByCategory.get(categoryId) ?? new Map<string, number>();
              if (!canAssignStreetLine(running, fingerprint)) {
                return true;
              }
              incrementStreetUse(running, fingerprint);
              runningByCategory.set(categoryId, running);
              return false;
            })
            .map(({ index }) => index)
        : [];

      if (duplicateIndexes.length === 0 || pass === MAX_BATCH_MISSPELL_PASSES - 1) {
        break;
      }

      pendingIndexes = duplicateIndexes;
    }
  }

  const updated: Profile[] = [];
  const failedIds: string[] = [];
  for (let index = 0; index < profilesToUpdate.length; index += 1) {
    const profile = profilesToUpdate[index];
    const categoryId = profileCategoryId(profile);
    let merged: Profile | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const slot =
        attempt === 0
          ? slots[index]
          : applyLocalJigRulesToProfile(
              profile,
              master,
              namePreset,
              [],
              addressJig.rules,
              nameMisspellScope,
            );
      const misspell = needsMisspell ? misspellResults[index] : undefined;
      const jigged = finalizeRejigFromLocalAndMisspell(profile, master, slot, misspell, namePreset);
      const address = hasAddressJig ? jigged.address : profile.address;
      const fingerprint = streetLineFingerprint(address.street);

      if (changesStreetLine && isStreetAtCapInCategory(fingerprint, categoryId, occupiedByCategory)) {
        if (attempt < maxAttempts - 1) {
          continue;
        }
        failedIds.push(profile.id);
        break;
      }

      if (changesStreetLine) {
        incrementCategoryStreetUse(occupiedByCategory, categoryId, fingerprint);
      }

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
        name: jigged.name,
        address,
        phone,
        cardHolderName: namePreset
          ? `${jigged.name.first} ${jigged.name.last}`.trim()
          : profile.cardHolderSameAsShipping !== false
            ? billingFullName({ ...profile, name: jigged.name })
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
