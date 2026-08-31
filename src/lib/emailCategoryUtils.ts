import type { EmailCategory, PoolEmail } from "./types";

export const EMAIL_UNCATEGORIZED_CATEGORY_ID = "uncategorized";

export function createUncategorizedEmailCategory(): EmailCategory {
  return {
    id: EMAIL_UNCATEGORIZED_CATEGORY_ID,
    name: "Uncategorized",
    createdAt: new Date(0).toISOString(),
  };
}

export function sortEmailCategories(categories: EmailCategory[]): EmailCategory[] {
  return [...categories].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (a.sortOrder == null && b.sortOrder == null) {
      if (a.id === EMAIL_UNCATEGORIZED_CATEGORY_ID) return -1;
      if (b.id === EMAIL_UNCATEGORIZED_CATEGORY_ID) return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function nextEmailCategorySortOrder(categories: EmailCategory[]): number {
  let max = -1;
  for (const category of categories) {
    if (category.sortOrder != null && category.sortOrder > max) {
      max = category.sortOrder;
    }
  }
  return max + 1;
}

export function reorderEmailCategoryIds(
  currentOrder: string[],
  draggedId: string,
  targetId: string,
): string[] {
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

export function emailCategoryId(email: PoolEmail): string {
  return email.categoryId?.trim() || EMAIL_UNCATEGORIZED_CATEGORY_ID;
}

export function emailCategoryCounts(emails: PoolEmail[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const email of emails) {
    const categoryId = emailCategoryId(email);
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }
  return counts;
}

export function categoriesWithEmails(categories: EmailCategory[], emails: PoolEmail[]): EmailCategory[] {
  const counts = emailCategoryCounts(emails);
  const knownIds = new Set(categories.map((category) => category.id));
  const resolved = [...categories];

  if ((counts.get(EMAIL_UNCATEGORIZED_CATEGORY_ID) ?? 0) > 0 && !knownIds.has(EMAIL_UNCATEGORIZED_CATEGORY_ID)) {
    resolved.push(createUncategorizedEmailCategory());
  }

  return sortEmailCategories(resolved);
}

export function buildEmailCategoryNameMap(
  categories: EmailCategory[],
  emails: PoolEmail[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const category of categories) {
    map.set(category.id, category.name);
  }
  for (const category of categoriesWithEmails(categories, emails)) {
    map.set(category.id, category.name);
  }
  return map;
}
