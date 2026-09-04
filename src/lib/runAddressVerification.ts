import { geocodioLookup, getGeocodioSettings, getProfile, listMasterProfiles, saveProfiles } from "./api";
import {
  billingAddressFingerprint,
  profileAddressFingerprint,
  profileHasVerifiableAddress,
  profileNeedsAddressVerify,
  queuedAddressCheck,
  stampFromLookup,
  withMasterMatch,
} from "./addressCheck";
import type { GeocodioLookupResult, MasterProfile, Profile } from "./types";

export const REJIG_UNTIL_PASS_ATTEMPTS = 5;

export interface AddressVerifySummary {
  checked: number;
  skipped: number;
  pass: number;
  warn: number;
  fail: number;
  error: number;
}

export interface VerifyProfileAddressesOptions {
  force?: boolean;
  requireKey?: boolean;
  onProgress?: () => Promise<void>;
}

function emptySummary(): AddressVerifySummary {
  return { checked: 0, skipped: 0, pass: 0, warn: 0, fail: 0, error: 0 };
}

export function formatAddressVerifySummary(summary: AddressVerifySummary): string {
  if (summary.checked === 0) {
    return summary.skipped > 0 ? "Addresses already checked." : "No billing addresses to verify.";
  }
  const parts = [`Checked ${summary.checked}`];
  if (summary.pass) parts.push(`${summary.pass} Pass`);
  if (summary.warn) parts.push(`${summary.warn} Warn`);
  if (summary.fail) parts.push(`${summary.fail} Fail`);
  if (summary.error) parts.push(`${summary.error} Error`);
  return parts.join(" · ");
}

export async function verifyProfileAddresses(
  ids: string[],
  options: VerifyProfileAddressesOptions = {},
): Promise<AddressVerifySummary> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const summary = emptySummary();
  if (uniqueIds.length === 0) return summary;

  const settings = await getGeocodioSettings();
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    if (options.requireKey === false) return summary;
    throw new Error("Set a Geocodio API key in Settings first.");
  }

  const loaded = (
    await Promise.all(
      uniqueIds.map((id) =>
        getProfile(id).catch(() => null),
      ),
    )
  ).filter((profile): profile is Profile => Boolean(profile));

  const targets = loaded.filter((profile) => profileNeedsAddressVerify(profile, Boolean(options.force)));
  summary.skipped = loaded.length - targets.length;
  if (targets.length === 0) return summary;

  const queued = targets.map((profile) => ({
    ...profile,
    addressCheck: queuedAddressCheck(profile),
  }));
  await saveProfiles(queued);
  await options.onProgress?.();

  const groups = new Map<string, Profile[]>();
  for (const profile of queued) {
    const fingerprint = profileAddressFingerprint(profile);
    const bucket = groups.get(fingerprint) ?? [];
    bucket.push(profile);
    groups.set(fingerprint, bucket);
  }

  const masters = await listMasterProfiles();
  const masterById = new Map(masters.map((master) => [master.id, master]));
  const masterLookupByFingerprint = new Map<string, GeocodioLookupResult | null>();

  const lookupMaster = async (master: MasterProfile): Promise<GeocodioLookupResult | null> => {
    if (!profileHasVerifiableAddress(master)) return null;
    const fingerprint = billingAddressFingerprint({
      street: master.address.street,
      unit: "",
      city: master.address.city,
      state: master.address.state,
      postalCode: master.address.postalCode,
    });
    if (masterLookupByFingerprint.has(fingerprint)) {
      return masterLookupByFingerprint.get(fingerprint) ?? null;
    }
    try {
      const result = await geocodioLookup({
        apiKey,
        street: master.address.street,
        city: master.address.city,
        state: master.address.state,
        postalCode: master.address.postalCode,
      });
      masterLookupByFingerprint.set(fingerprint, result);
      return result;
    } catch {
      masterLookupByFingerprint.set(fingerprint, null);
      return null;
    }
  };

  const stamped: Profile[] = [];
  for (const group of groups.values()) {
    const sample = group[0];
    let result: GeocodioLookupResult;
    try {
      result = await geocodioLookup({
        apiKey,
        street: sample.address.street,
        unit: sample.address.unit,
        city: sample.address.city,
        state: sample.address.state,
        postalCode: sample.address.postalCode,
      });
    } catch (error) {
      result = {
        status: "error",
        message: error instanceof Error ? error.message : "Geocodio request failed.",
      };
    }
    for (const profile of group) {
      let check = stampFromLookup(profile, result);
      const master = profile.masterProfileId ? masterById.get(profile.masterProfileId) : undefined;
      if (master && result.status !== "error" && result.propertyKey) {
        const masterResult = await lookupMaster(master);
        if (masterResult?.propertyKey) {
          check = withMasterMatch(check, result.propertyKey === masterResult.propertyKey);
        }
      }
      const next = { ...profile, addressCheck: check };
      stamped.push(next);
      summary.checked += 1;
      const status = next.addressCheck?.status;
      if (status === "pass") summary.pass += 1;
      else if (status === "warn") summary.warn += 1;
      else if (status === "fail") summary.fail += 1;
      else if (status === "error") summary.error += 1;
    }
  }

  await saveProfiles(stamped);
  return summary;
}
