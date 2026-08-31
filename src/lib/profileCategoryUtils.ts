import type { ProfileCategory, ProfileSummary } from "./types";

export const PROFILE_UNCATEGORIZED_CATEGORY_ID = "uncategorized";

export function createUncategorizedProfileCategory(): ProfileCategory {
  return {
    id: PROFILE_UNCATEGORIZED_CATEGORY_ID,
    name: "Uncategorized",
    createdAt: new Date(0).toISOString(),
  };
}

export function sortProfileCategories(categories: ProfileCategory[]): ProfileCategory[] {
  return [...categories].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (a.sortOrder == null && b.sortOrder == null) {
      if (a.id === PROFILE_UNCATEGORIZED_CATEGORY_ID) return -1;
      if (b.id === PROFILE_UNCATEGORIZED_CATEGORY_ID) return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function nextProfileCategorySortOrder(categories: ProfileCategory[]): number {
  let max = -1;
  for (const category of categories) {
    if (category.sortOrder != null && category.sortOrder > max) {
      max = category.sortOrder;
    }
  }
  return max + 1;
}

export function reorderCategoryIds(currentOrder: string[], draggedId: string, targetId: string): string[] {
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

export function profileCategoryId(profile: Pick<ProfileSummary, "categoryId">): string {
  return profile.categoryId?.trim() || PROFILE_UNCATEGORIZED_CATEGORY_ID;
}

export function isProfileCategoryLocked(
  categories: Array<Pick<ProfileCategory, "id" | "locked">>,
  categoryId?: string,
): boolean {
  const id = categoryId?.trim() || PROFILE_UNCATEGORIZED_CATEGORY_ID;
  return Boolean(categories.find((category) => category.id === id)?.locked);
}

export function assertProfileCategoryUnlocked(
  categories: Array<Pick<ProfileCategory, "id" | "name" | "locked">>,
  categoryId: string | undefined,
  action: string,
): void {
  if (!isProfileCategoryLocked(categories, categoryId)) {
    return;
  }
  const id = categoryId?.trim() || PROFILE_UNCATEGORIZED_CATEGORY_ID;
  const name = categories.find((category) => category.id === id)?.name ?? "This category";
  throw new Error(`${name} is locked. Unlock it before you ${action}.`);
}

export function assertProfilesUnlocked(
  categories: Array<Pick<ProfileCategory, "id" | "name" | "locked">>,
  profiles: Array<Pick<ProfileSummary, "categoryId">>,
  action: string,
): void {
  for (const profile of profiles) {
    assertProfileCategoryUnlocked(categories, profile.categoryId, action);
  }
}

export function createMissingProfileCategory(id: string): ProfileCategory {
  return {
    id,
    name: "Missing category",
    createdAt: new Date(0).toISOString(),
  };
}

export function categoriesWithProfiles(
  categories: ProfileCategory[],
  profiles: ProfileSummary[],
): ProfileCategory[] {
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    const categoryId = profileCategoryId(profile);
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }
  const knownIds = new Set(categories.map((category) => category.id));
  const resolved = [...categories];

  if (
    (counts.get(PROFILE_UNCATEGORIZED_CATEGORY_ID) ?? 0) > 0 &&
    !knownIds.has(PROFILE_UNCATEGORIZED_CATEGORY_ID)
  ) {
    resolved.push(createUncategorizedProfileCategory());
  }

  return sortProfileCategories(resolved);
}
