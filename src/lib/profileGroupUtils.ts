import type { ProfileGroup, ProfileSummary } from "./types";

/** Sentinel id kept as "uncategorized" so existing rows still resolve. */
export const PROFILE_UNGROUPED_GROUP_ID = "uncategorized";
/** @deprecated Use PROFILE_UNGROUPED_GROUP_ID */
export const PROFILE_UNCATEGORIZED_CATEGORY_ID = PROFILE_UNGROUPED_GROUP_ID;

export function createUngroupedProfileGroup(): ProfileGroup {
  return {
    id: PROFILE_UNGROUPED_GROUP_ID,
    name: "Ungrouped",
    createdAt: new Date(0).toISOString(),
  };
}

/** @deprecated Use createUngroupedProfileGroup */
export const createUncategorizedProfileCategory = createUngroupedProfileGroup;

export function sortProfileGroups(groups: ProfileGroup[]): ProfileGroup[] {
  return [...groups].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (a.sortOrder == null && b.sortOrder == null) {
      if (a.id === PROFILE_UNGROUPED_GROUP_ID) return -1;
      if (b.id === PROFILE_UNGROUPED_GROUP_ID) return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/** @deprecated Use sortProfileGroups */
export const sortProfileCategories = sortProfileGroups;

export function nextProfileGroupSortOrder(groups: ProfileGroup[]): number {
  let max = -1;
  for (const group of groups) {
    if (group.sortOrder != null && group.sortOrder > max) {
      max = group.sortOrder;
    }
  }
  return max + 1;
}

/** @deprecated Use nextProfileGroupSortOrder */
export const nextProfileCategorySortOrder = nextProfileGroupSortOrder;

export function reorderGroupIds(currentOrder: string[], draggedId: string, targetId: string): string[] {
  const fromIndex = currentOrder.indexOf(draggedId);
  const toIndex = currentOrder.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return currentOrder;
  }

  const next = [...currentOrder];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, draggedId);
  return next;
}

/** @deprecated Use reorderGroupIds */
export const reorderCategoryIds = reorderGroupIds;

export function resolveStoredProfileGroupId(value?: string | null): string {
  return value?.trim() || PROFILE_UNGROUPED_GROUP_ID;
}

export function profileGroupId(profile: Pick<ProfileSummary, "groupId" | "categoryId">): string {
  return resolveStoredProfileGroupId(profile.groupId || profile.categoryId);
}

/** @deprecated Use profileGroupId */
export const profileCategoryId = profileGroupId;

export function isProfileGroupLocked(
  groups: Array<Pick<ProfileGroup, "id" | "locked">>,
  groupId?: string,
): boolean {
  const id = resolveStoredProfileGroupId(groupId);
  return Boolean(groups.find((group) => group.id === id)?.locked);
}

/** @deprecated Use isProfileGroupLocked */
export const isProfileCategoryLocked = isProfileGroupLocked;

export function assertProfileGroupUnlocked(
  groups: Array<Pick<ProfileGroup, "id" | "name" | "locked">>,
  groupId: string | undefined,
  action: string,
): void {
  if (!isProfileGroupLocked(groups, groupId)) {
    return;
  }
  const id = resolveStoredProfileGroupId(groupId);
  const name = groups.find((group) => group.id === id)?.name ?? "This group";
  throw new Error(`${name} is locked. Unlock it before you ${action}.`);
}

/** @deprecated Use assertProfileGroupUnlocked */
export const assertProfileCategoryUnlocked = assertProfileGroupUnlocked;

export function assertProfilesUnlocked(
  groups: Array<Pick<ProfileGroup, "id" | "name" | "locked">>,
  profiles: Array<Pick<ProfileSummary, "groupId" | "categoryId">>,
  action: string,
): void {
  for (const profile of profiles) {
    assertProfileGroupUnlocked(groups, profileGroupId(profile), action);
  }
}

export function createMissingProfileGroup(id: string): ProfileGroup {
  return {
    id,
    name: "Missing group",
    createdAt: new Date(0).toISOString(),
  };
}

/** @deprecated Use createMissingProfileGroup */
export const createMissingProfileCategory = createMissingProfileGroup;

export function groupsWithProfiles(
  groups: ProfileGroup[],
  profiles: ProfileSummary[],
): ProfileGroup[] {
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    const id = profileGroupId(profile);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const knownIds = new Set(groups.map((group) => group.id));
  const resolved = [...groups];

  if ((counts.get(PROFILE_UNGROUPED_GROUP_ID) ?? 0) > 0 && !knownIds.has(PROFILE_UNGROUPED_GROUP_ID)) {
    resolved.push(createUngroupedProfileGroup());
  }

  return sortProfileGroups(resolved);
}

/** @deprecated Use groupsWithProfiles */
export const categoriesWithProfiles = groupsWithProfiles;
