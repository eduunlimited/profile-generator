import type { MasterProfile, Profile, ProfileName } from "./types";

export function resolveProfileNameBase(name: ProfileName): string {
  const fromParts = `${name.first} ${name.last}`.trim();
  return fromParts || name.full.trim();
}

/** First/last for name misspell — fall back to jig/full when parts are empty. */
export function namePartsForMisspell(name: ProfileName): { first: string; last: string } {
  const first = name.first.trim();
  const last = name.last.trim();
  if (first || last) {
    return { first, last };
  }
  const source = (name.jig || name.full).trim();
  if (!source) {
    return { first: "", last: "" };
  }
  const parts = source.split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

/** Deep-enough copy for re-jig so existing jig names are not lost. */
export function cloneProfileName(name: ProfileName): ProfileName {
  return {
    first: name.first,
    last: name.last,
    full: name.full ?? `${name.first} ${name.last}`.trim(),
    ...(name.jig?.trim() ? { jig: name.jig.trim() } : {}),
  };
}

export function defaultProfileName(first: string, last: string, index: number): string {
  const f = first.trim() || "First";
  const l = last.trim() || "Last";
  return `${f}-${l}-${String(index + 1).padStart(2, "0")}`;
}

export function resolveProfileDisplayName(profile: Profile): string {
  if (profile.profileName?.trim()) {
    return profile.profileName.trim();
  }
  return defaultProfileName(profile.name.first, profile.name.last, 0);
}

export function masterProfileNameBase(master: MasterProfile): string {
  if (master.profileName?.trim()) {
    return master.profileName.trim();
  }
  const f = master.name.first.trim() || "First";
  const l = master.name.last.trim() || "Last";
  return `${f}-${l}`;
}

export function collectUsedProfileNames(profiles: Profile[]): Set<string> {
  const used = new Set<string>();
  for (const profile of profiles) {
    const name = profile.profileName?.trim() || resolveProfileDisplayName(profile);
    if (name) {
      used.add(name.toLowerCase());
    }
  }
  return used;
}

export function collectUsedProfileNamesFromSummaries(
  profiles: Array<{ id: string; name: string }>,
  excludeIds: Iterable<string> = [],
): Set<string> {
  const skip = new Set(excludeIds);
  const used = new Set<string>();
  for (const profile of profiles) {
    if (skip.has(profile.id)) continue;
    const name = profile.name.trim();
    if (name) used.add(name.toLowerCase());
  }
  return used;
}

export function nextUniqueProfileName(base: string, usedNames: Set<string>): string {
  const trimmedBase = base.trim() || "Profile";
  let suffix = 1;
  while (usedNames.has(`${trimmedBase}-${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  const name = `${trimmedBase}-${suffix}`;
  usedNames.add(name.toLowerCase());
  return name;
}

export function uniqueCopiedProfileName(name: string, usedNames: Set<string>): string {
  const trimmed = name.trim() || "Profile";
  const key = trimmed.toLowerCase();
  if (!usedNames.has(key)) {
    usedNames.add(key);
    return trimmed;
  }
  return nextUniqueProfileName(trimmed, usedNames);
}

export function resolveGeneratedProfileName(master: MasterProfile, usedNames: Set<string>): string {
  return nextUniqueProfileName(masterProfileNameBase(master), usedNames);
}

function billingUsesShippingFields(profile: Profile): boolean {
  return profile.billingSameAsShipping !== false;
}

export function billingFullName(profile: Profile): string {
  return (profile.name.jig || resolveProfileNameBase(profile.name)).trim();
}

export function billingAddressLines(profile: Profile): {
  line1: string;
  line2: string;
  line3: string;
} {
  if (!billingUsesShippingFields(profile) && profile.address.jig?.trim()) {
    const lines = profile.address.jig
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      line1: lines[0] ?? "",
      line2: lines[1] ?? "",
      line3: lines.slice(2).join(", "),
    };
  }

  const address = profile.address;
  return {
    line1: address.street,
    line2: address.unit ?? "",
    line3: [address.city, address.state, address.postalCode].filter(Boolean).join(", "),
  };
}

export function formatLinkedProfileNames(names: string[]): string {
  const trimmed = names.map((name) => name.trim()).filter(Boolean);
  if (trimmed.length === 0) return "—";
  return trimmed.join(", ");
}

export function sortProfilesByName<T extends { name: string }>(profiles: T[]): T[] {
  return [...profiles].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  );
}
