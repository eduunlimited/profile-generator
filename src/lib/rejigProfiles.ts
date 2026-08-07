import { applyJigRulesToMaster, jigFingerprint } from "./jigEngine";
import { addressJigPresetLabel } from "./jigPresetUtils";
import type { JigPreset, MasterProfile, Profile } from "./types";
const DEFAULT_MAX_ATTEMPTS = 250;

function buildOccupiedFingerprints(allProfiles: Profile[], reJigIds: Set<string>): Set<string> {
  const occupied = new Set<string>();
  for (const profile of allProfiles) {
    if (reJigIds.has(profile.id)) continue;
    occupied.add(jigFingerprint(profile));
  }
  return occupied;
}

export function rejigProfiles(
  master: MasterProfile,
  profilesToUpdate: Profile[],
  allProfiles: Profile[],
  namePreset: JigPreset | null,
  addressPresets: JigPreset[],
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): { updated: Profile[]; failedIds: string[] } {  const reJigIds = new Set(profilesToUpdate.map((profile) => profile.id));
  const occupied = buildOccupiedFingerprints(allProfiles, reJigIds);
  const now = new Date().toISOString();
  const updated: Profile[] = [];
  const failedIds: string[] = [];

  for (const profile of profilesToUpdate) {
    let merged: Profile | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const jigged = applyJigRulesToMaster(master, namePreset, addressPresets);      const fingerprint = jigFingerprint(jigged);
      if (occupied.has(fingerprint)) continue;

      occupied.add(fingerprint);
      merged = {
        ...profile,
        nameJigPresetId: namePreset?.id,
        nameJigPresetName: namePreset?.name,
        addressJigPresetIds: addressPresets.map((preset) => preset.id),
        addressJigPresetName: addressJigPresetLabel(addressPresets),
        jigPresetName:
          [namePreset?.name, addressJigPresetLabel(addressPresets)].filter(Boolean).join(" + ") || undefined,        name: jigged.name,
        address: jigged.address,
        updatedAt: now,
      };
      break;
    }

    if (merged) {
      updated.push(merged);
    } else {
      failedIds.push(profile.id);
    }
  }

  return { updated, failedIds };
}
