import type { MasterProfile, Profile } from "./types";

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

export function resolveGeneratedProfileName(master: MasterProfile, index: number): string {
  if (master.profileName?.trim()) {
    return master.profileName.trim();
  }
  return defaultProfileName(master.name.first, master.name.last, index);
}

export function billingFullName(profile: Profile): string {
  return (profile.name.jig || profile.name.full || `${profile.name.first} ${profile.name.last}`).trim();
}

export function billingAddressLines(profile: Profile): {
  line1: string;
  line2: string;
  line3: string;
} {
  if (profile.address.jig?.trim()) {
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
