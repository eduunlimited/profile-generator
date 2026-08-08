import type { MasterProfile } from "./types";
import { normalizeUsPhone } from "./phoneUtils";

export function createEmptyMasterProfile(): MasterProfile {
  return {
    id: crypto.randomUUID(),
    profileName: "",
    phone: "",
    name: { first: "", last: "", full: "" },
    address: {
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "United States",
    },
    updatedAt: new Date().toISOString(),
  };
}

export function getMasterProfileValidationError(master: MasterProfile): string | null {
  if (!master.name.first.trim()) return "First name is required.";
  if (!master.name.last.trim()) return "Last name is required.";
  if (!master.phone?.trim()) return "Phone is required.";
  if (!master.address.street.trim()) return "Address line 1 is required.";
  if (!master.address.city.trim()) return "City is required.";
  if (!master.address.state.trim()) return "State is required.";
  if (!master.address.postalCode.trim()) return "Postal code is required.";
  if (!master.address.country.trim()) return "Country is required.";
  return null;
}

export function isMasterProfileComplete(master: MasterProfile): boolean {
  return getMasterProfileValidationError(master) === null;
}

export function defaultMasterProfileName(master: MasterProfile): string {
  const first = master.name.first.trim();
  const last = master.name.last.trim();
  const zip = master.address.postalCode.trim();
  return `${first}-${last}-${zip}`;
}

export function withResolvedMasterProfileName(master: MasterProfile): MasterProfile {
  if (master.profileName?.trim()) {
    return master;
  }
  return { ...master, profileName: defaultMasterProfileName(master) };
}

export function normalizeMasterProfile(master: Partial<MasterProfile>): MasterProfile {
  const empty = createEmptyMasterProfile();
  return {
    ...empty,
    ...master,
    id: master.id ?? empty.id,
    profileName: master.profileName ?? empty.profileName,
    phone: normalizeUsPhone(master.phone ?? ""),
    name: { ...empty.name, ...master.name },
    address: { ...empty.address, ...master.address },
    updatedAt: master.updatedAt ?? empty.updatedAt,
  };
}

export function updateMasterField(
  master: MasterProfile,
  path: string,
  value: string,
): MasterProfile {
  const next = structuredClone(master);
  const parts = path.split(".");
  let cursor: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;

  if (path.startsWith("name.first") || path.startsWith("name.last")) {
    next.name.full = `${next.name.first} ${next.name.last}`.trim();
  }

  if (path === "profileName") {
    next.profileName = value;
  }

  if (path === "phone") {
    next.phone = normalizeUsPhone(value);
  }

  return next;
}

export function masterProfileLabel(master: MasterProfile): string {
  if (master.profileName?.trim()) return master.profileName.trim();
  if (master.name.full.trim()) return master.name.full;
  if (master.name.first || master.name.last) {
    return `${master.name.first} ${master.name.last}`.trim();
  }
  if (master.address.city) return master.address.city;
  return "Master profile";
}

export function masterSidebarCategoryId(masterId: string): string {
  return `master:${masterId}`;
}

export function masterCategorySidebarId(masterId: string, categoryId: string): string {
  return `master:${masterId}:cat:${categoryId}`;
}

export type ProfilesSidebarSelection = {
  masterId: string | null;
  profileCategoryId: string | null;
};

export function parseProfilesSidebarSelection(selectionId: string): ProfilesSidebarSelection {
  if (selectionId === "all") {
    return { masterId: null, profileCategoryId: null };
  }
  if (!selectionId.startsWith("master:")) {
    return { masterId: null, profileCategoryId: selectionId };
  }

  const rest = selectionId.slice("master:".length);
  const categoryMarker = ":cat:";
  const markerIndex = rest.indexOf(categoryMarker);
  if (markerIndex === -1) {
    return { masterId: rest, profileCategoryId: null };
  }

  return {
    masterId: rest.slice(0, markerIndex),
    profileCategoryId: rest.slice(markerIndex + categoryMarker.length),
  };
}

/** @deprecated Use parseProfilesSidebarSelection */
export function parseMasterSidebarCategoryId(categoryId: string): string | null {
  return parseProfilesSidebarSelection(categoryId).masterId;
}

export function isMasterProfilesView(selectionId: string): boolean {
  return parseProfilesSidebarSelection(selectionId).masterId !== null;
}

export function sortMasterProfiles(masters: MasterProfile[]): MasterProfile[] {
  return [...masters].sort(
    (a, b) =>
      masterProfileLabel(a).localeCompare(masterProfileLabel(b)) ||
      a.updatedAt.localeCompare(b.updatedAt),
  );
}
