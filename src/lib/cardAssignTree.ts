import { filterAssignablePoolCards } from "./creditCardUtils";
import {
  CARD_UNCATEGORIZED_CATEGORY_ID,
  cardCategoryId,
  categoriesWithCards,
  createUncategorizedCardCategory,
  sortCardCategories,
} from "./cardCategoryUtils";
import type { CardCategory, CreditCard } from "./types";

export type CardAssignCategory = {
  id: string;
  label: string;
  cards: CreditCard[];
};

export function buildCardAssignCategories(
  cards: CreditCard[],
  categories: CardCategory[],
): CardAssignCategory[] {
  const assignableCards = filterAssignablePoolCards(cards);
  const cardsByCategory = new Map<string, CreditCard[]>();
  for (const card of [...assignableCards].sort((a, b) => a.profileName.localeCompare(b.profileName))) {
    const categoryId = cardCategoryId(card);
    const bucket = cardsByCategory.get(categoryId) ?? [];
    bucket.push(card);
    cardsByCategory.set(categoryId, bucket);
  }

  if (cardsByCategory.size === 0) {
    return [];
  }

  const categoryLookup = new Map(categories.map((category) => [category.id, category]));
  if (!categoryLookup.has(CARD_UNCATEGORIZED_CATEGORY_ID)) {
    categoryLookup.set(CARD_UNCATEGORIZED_CATEGORY_ID, createUncategorizedCardCategory());
  }

  const visibleCategories = categoriesWithCards(
    sortCardCategories([...categoryLookup.values()]),
    assignableCards,
  );

  return visibleCategories
    .map((category) => ({
      id: category.id,
      label: category.name,
      cards: cardsByCategory.get(category.id) ?? [],
    }))
    .filter((category) => category.cards.length > 0);
}
