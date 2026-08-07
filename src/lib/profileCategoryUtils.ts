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

export function profileCategoryIdsInUse(profiles: ProfileSummary[]): Set<string> {
  return new Set(profiles.map((profile) => profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID));
}

export function categoriesWithProfiles(
  categories: ProfileCategory[],
  profiles: ProfileSummary[],
): ProfileCategory[] {
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    const categoryId = profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID;
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }
  return sortProfileCategories(categories.filter((category) => (counts.get(category.id) ?? 0) > 0));
}
