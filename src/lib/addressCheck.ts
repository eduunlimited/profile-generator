import type { AddressCheck, AddressCheckStatus, GeocodioLookupResult, Profile, ProfileAddress } from "./types";

export function billingAddressFingerprint(address: Pick<ProfileAddress, "street" | "unit" | "city" | "state" | "postalCode">): string {
  return [address.street, address.unit ?? "", address.city, address.state, address.postalCode]
    .map((part) => part.trim().toLowerCase())
    .join("|");
}

export function profileAddressFingerprint(profile: Profile): string {
  return billingAddressFingerprint(profile.address);
}

export function addressCheckIsStale(profile: Profile): boolean {
  if (!profile.addressCheck) return true;
  return profile.addressCheck.fingerprint !== profileAddressFingerprint(profile);
}

export function profileHasVerifiableAddress(profile: Pick<Profile, "address">): boolean {
  const address = profile.address;
  return Boolean(
    address.street.trim() && address.city.trim() && address.state.trim() && address.postalCode.trim(),
  );
}

export function clearStaleAddressCheck(profile: Profile): Profile {
  if (!profile.addressCheck || !addressCheckIsStale(profile)) return profile;
  return { ...profile, addressCheck: undefined };
}

export function profileNeedsAddressVerify(profile: Profile, force = false): boolean {
  if (!profileHasVerifiableAddress(profile)) return false;
  if (force) return true;
  if (!profile.addressCheck || profile.addressCheck.status === "queued") return true;
  return addressCheckIsStale(profile);
}

export function profileHasStoredAddressJig(profile: Profile): boolean {
  return Boolean(profile.addressJigPresetIds?.length || profile.addressJigPresetId);
}

export function isAddressCheckFailOrWarn(profile: Profile): boolean {
  const status = profile.addressCheck?.status;
  return status === "fail" || status === "warn" || status === "error";
}

export function queuedAddressCheck(profile: Profile): AddressCheck {
  return {
    provider: "geocodio",
    status: "queued",
    checkedAt: new Date().toISOString(),
    fingerprint: profileAddressFingerprint(profile),
    displayLabel: "Checking",
    message: "Checking address with Geocodio…",
  };
}

export function progressAddressCheck(
  profile: Profile,
  displayLabel: string,
  message: string,
): AddressCheck {
  return {
    provider: "geocodio",
    status: "queued",
    checkedAt: new Date().toISOString(),
    fingerprint: profileAddressFingerprint(profile),
    displayLabel,
    message,
  };
}

export function errorAddressCheck(profile: Profile, message: string): AddressCheck {
  return {
    provider: "geocodio",
    status: "error",
    checkedAt: new Date().toISOString(),
    fingerprint: profileAddressFingerprint(profile),
    message,
  };
}

export function stampFromLookup(profile: Profile, result: GeocodioLookupResult): AddressCheck {
  const message = [result.message, result.matchedAddress ? `Matched: ${result.matchedAddress}` : ""]
    .filter(Boolean)
    .join(" ");
  return {
    provider: "geocodio",
    status: result.status,
    exactMatch: result.exactMatch,
    accuracy: result.accuracy,
    accuracyType: result.accuracyType,
    checkedAt: new Date().toISOString(),
    fingerprint: profileAddressFingerprint(profile),
    message: message || undefined,
    matchedAddress: result.matchedAddress,
    propertyKey: result.propertyKey,
  };
}

export function withMasterMatch(check: AddressCheck, masterMatch: boolean | undefined): AddressCheck {
  if (masterMatch === undefined) return check;
  const extra = masterMatch ? "Same house as master." : "Geocoded to a different address than the master.";
  const message = [check.message, extra].filter(Boolean).join(" ");
  return { ...check, masterMatch, message };
}

export function geocodioPropertyKey(components: Record<string, unknown> | undefined): string | undefined {
  if (!components) return undefined;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const number = text(components.number);
  const street =
    text(components.formatted_street) ||
    [text(components.predirectional), text(components.street), text(components.suffix)].filter(Boolean).join(" ");
  const city = text(components.city);
  const state = text(components.state_province) || text(components.state);
  const zipDigits = (text(components.postal_code) || text(components.zip)).replace(/\D/g, "").slice(0, 5);
  if (!number && !street) return undefined;
  return [number, street, city, state, zipDigits].map((part) => part.toLowerCase()).join("|");
}

export function addressMasterMatchLabel(masterMatch: boolean | undefined): string {
  if (masterMatch === true) return "Master";
  if (masterMatch === false) return "Not master";
  return "";
}

export function addressCheckLabel(status: AddressCheckStatus | undefined): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "warn":
      return "Warn";
    case "fail":
      return "Fail";
    case "queued":
      return "Queued";
    case "error":
      return "Error";
    default:
      return "Unchecked";
  }
}
