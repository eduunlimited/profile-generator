import type { CardCategory, CreditCard } from "./types";

export const CARD_UNCATEGORIZED_CATEGORY_ID = "uncategorized";

export function createUncategorizedCardCategory(): CardCategory {
  return {
    id: CARD_UNCATEGORIZED_CATEGORY_ID,
    name: "Uncategorized",
    createdAt: new Date(0).toISOString(),
  };
}

export function sortCardCategories(categories: CardCategory[]): CardCategory[] {
  return [...categories].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (a.sortOrder == null && b.sortOrder == null) {
      if (a.id === CARD_UNCATEGORIZED_CATEGORY_ID) return -1;
      if (b.id === CARD_UNCATEGORIZED_CATEGORY_ID) return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function nextCardCategorySortOrder(categories: CardCategory[]): number {
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

export function cardCategoryId(card: CreditCard): string {
  return card.categoryId?.trim() || CARD_UNCATEGORIZED_CATEGORY_ID;
}

export function cardCategoryIdsInUse(cards: CreditCard[]): Set<string> {
  return new Set(cards.map((card) => cardCategoryId(card)));
}

export function cardCategoryCounts(cards: CreditCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const categoryId = cardCategoryId(card);
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }
  return counts;
}

export function categoriesWithCards(categories: CardCategory[], cards: CreditCard[]): CardCategory[] {
  const counts = cardCategoryCounts(cards);
  const knownIds = new Set(categories.map((category) => category.id));
  const resolved = [...categories];

  if ((counts.get(CARD_UNCATEGORIZED_CATEGORY_ID) ?? 0) > 0 && !knownIds.has(CARD_UNCATEGORIZED_CATEGORY_ID)) {
    resolved.push(createUncategorizedCardCategory());
  }

  return sortCardCategories(resolved.filter((category) => (counts.get(category.id) ?? 0) > 0));
}

export function buildCardCategoryNameMap(
  categories: CardCategory[],
  cards: CreditCard[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const category of categories) {
    map.set(category.id, category.name);
  }
  for (const category of categoriesWithCards(categories, cards)) {
    map.set(category.id, category.name);
  }
  return map;
}
