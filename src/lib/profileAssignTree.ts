import type { MasterProfile, ProfileSummary } from "./types";
import { masterProfileLabel } from "./masterProfileUtils";
import { sortProfilesByName } from "./profileNameUtils";

export type ProfileAssignCategory = {
  id: string;
  label: string;
  profiles: ProfileSummary[];
};

export function sortProfilesForAssign(profiles: ProfileSummary[]): ProfileSummary[] {
  return sortProfilesByName(profiles);
}

export function masterAssignCategoryId(masterProfileId: string): string {
  return `master:${masterProfileId}`;
}

export function buildProfileAssignCategories(
  profiles: ProfileSummary[],
  masters: MasterProfile[],
): ProfileAssignCategory[] {
  const sorted = sortProfilesForAssign(profiles);
  const categories: ProfileAssignCategory[] = [];
  const bucketedIds = new Set<string>();

  for (const master of masters) {
    const masterChildren = sorted.filter((profile) => profile.masterProfileId === master.id);
    if (masterChildren.length === 0) continue;
    masterChildren.forEach((profile) => bucketedIds.add(profile.id));
    categories.push({
      id: masterAssignCategoryId(master.id),
      label: masterProfileLabel(master),
      profiles: masterChildren,
    });
  }

  const ungrouped = sorted.filter((profile) => !bucketedIds.has(profile.id));
  if (ungrouped.length > 0) {
    categories.push({
      id: "ungrouped",
      label: "Other profiles",
      profiles: ungrouped,
    });
  }

  return categories;
}

export function resolveAssignProfileIds(
  categories: ProfileAssignCategory[],
  selectedProfileIds: string[],
  selectedParentCategoryIds: string[],
  credentialCount: number,
): string[] {
  if (credentialCount <= 0) {
    return [];
  }

  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const resolved: string[] = [];
  const seen = new Set<string>();

  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    resolved.push(id);
  };

  for (const categoryId of selectedParentCategoryIds) {
    const category = categoryMap.get(categoryId);
    if (!category) continue;
    const take = Math.min(credentialCount, category.profiles.length);
    for (let index = 0; index < take; index += 1) {
      add(category.profiles[index].id);
    }
  }

  for (const profileId of selectedProfileIds) {
    const parentSelected = selectedParentCategoryIds.some((categoryId) => {
      const category = categoryMap.get(categoryId);
      return category?.profiles.some((profile) => profile.id === profileId);
    });
    if (!parentSelected) {
      add(profileId);
    }
  }

  return resolved;
}

export function isProfileInParentSelection(
  categoryId: string,
  profileIndex: number,
  selectedParentCategoryIds: string[],
  credentialCount: number,
): boolean {
  if (!selectedParentCategoryIds.includes(categoryId)) return false;
  return profileIndex < credentialCount;
}
