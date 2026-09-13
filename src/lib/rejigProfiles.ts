import {
  addressRulesChangeStreetLine,
  applyJigRulesBatchToMasterAsync,
  applyLocalJigRulesToMaster,
  applyLocalJigRulesToProfile,
  buildStreetUseCounts,
  canAssignStreetLine,
  collectUniqueStreetLines,
  finalizeJigFromLocalAndMisspell,
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
import { shippingAddressForProfile, withShippingAddress } from "./profileUtils";
import type { JigPreset, MasterProfile, NameMisspellScope, Profile } from "./types";
import type { OpenAiMisspellResult } from "./openaiMisspell";

const DEFAULT_MAX_ATTEMPTS = 250;
const MAX_BATCH_MISSPELL_PASSES = 3;

export interface RejigProfilesParams {
  nameMisspellScope?: NameMisspellScope;
  phoneJigLastFour?: boolean;
  /** Jig from the master's clean address/name instead of the profile's current jig. */
  sourceFromMaster?: boolean;
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
      buildStreetUseCounts(profiles.map((profile) => shippingAddressForProfile(profile))),
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
    .map((profile) => shippingAddressForProfile(profile).street);

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
  const sourceFromMaster = Boolean(params.sourceFromMaster);
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
  const changesStreetLine = addressRulesChangeStreetLine(addressJig.rules) || sourceFromMaster;
  const applyLocalSlot = (profile: Profile) =>
    sourceFromMaster
      ? applyLocalJigRulesToMaster(master, namePreset, [], addressJig.rules, nameMisspellScope)
      : applyLocalJigRulesToProfile(profile, master, namePreset, [], addressJig.rules, nameMisspellScope);
  const finalizeSlot = (profile: Profile, slot: LocalJigSlot, misspell: OpenAiMisspellResult | undefined) => {
    if (sourceFromMaster) {
      const jigged = finalizeJigFromLocalAndMisspell(master, slot, misspell, namePreset);
      return {
        name: namePreset ? jigged.name : profile.name,
        address: hasAddressJig ? jigged.address : { ...master.address },
      };
    }
    return finalizeRejigFromLocalAndMisspell(profile, master, slot, misspell, namePreset);
  };
  const slots: LocalJigSlot[] = profilesToUpdate.map((profile) => applyLocalSlot(profile));
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
        nameSource: sourceFromMaster ? master.name : profilesToUpdate[originalIndex].name,
      }));
      const jiggedSoFar = slots.map((slot, slotIndex) =>
        finalizeSlot(profilesToUpdate[slotIndex], slot, misspellResults[slotIndex]),
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
        finalizeSlot(profilesToUpdate[slotIndex], slot, misspellResults[slotIndex]),
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
      const slot = attempt === 0 ? slots[index] : applyLocalSlot(profile);
      const misspell = needsMisspell ? misspellResults[index] : undefined;
      const jigged = finalizeSlot(profile, slot, misspell);
      const address = hasAddressJig || sourceFromMaster ? jigged.address : profile.address;
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

      let phone = profile.phone;
      if (params.phoneJigLastFour) {
        const phoneBase = profile.phone ?? master.phone ?? "";
        const baseDigits = normalizeUsPhone(phoneBase);
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
        phone = applyPhoneLastFourJig(phoneBase, lastFour);
      }

      const nextName = namePreset ? jigged.name : profile.name;
      const nameLabel = namePreset?.name ?? profile.nameJigPresetName;
      const addressLabel = hasAddressJig ? addressJig.label : profile.addressJigPresetName;

      merged = {
        ...profile,
        ...(sourceFromMaster ? { masterProfileId: master.id } : {}),
        ...(namePreset
          ? {
              nameJigPresetId: namePreset.id,
              nameJigPresetName: namePreset.name,
              name: nextName,
              cardHolderName:
                profile.cardHolderSameAsShipping !== false
                  ? billingFullName({ ...profile, name: nextName })
                  : profile.cardHolderName,
            }
          : {}),
        ...(hasAddressJig
          ? {
              addressJigPresetIds: addressJig.presetIds.length > 0 ? addressJig.presetIds : undefined,
              addressJigPresetName: addressJig.label,
              addressCheck: undefined,
            }
          : sourceFromMaster
            ? {
                addressCheck: undefined,
                addressJigPresetIds: undefined,
                addressJigPresetName: undefined,
              }
            : {}),
        ...(params.phoneJigLastFour ? { phone } : {}),
        jigPresetName: [nameLabel, addressLabel].filter(Boolean).join(" + ") || undefined,
        updatedAt: now,
      };
      if (hasAddressJig || sourceFromMaster) {
        merged = withShippingAddress(merged, address);
      }
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
