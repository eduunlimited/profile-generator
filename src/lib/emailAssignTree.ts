import { filterAssignablePoolEmails } from "./emailPoolUtils";
import {
  EMAIL_UNCATEGORIZED_CATEGORY_ID,
  emailCategoryId,
  categoriesWithEmails,
  createUncategorizedEmailCategory,
  sortEmailCategories,
} from "./emailCategoryUtils";
import type { EmailCategory, PoolEmail } from "./types";

export type EmailAssignCategory = {
  id: string;
  label: string;
  emails: PoolEmail[];
};

export function buildEmailAssignCategories(
  emails: PoolEmail[],
  categories: EmailCategory[],
): EmailAssignCategory[] {
  const assignableEmails = filterAssignablePoolEmails(emails);
  const emailsByCategory = new Map<string, PoolEmail[]>();
  for (const email of [...assignableEmails].sort((a, b) => a.email.localeCompare(b.email))) {
    const categoryId = emailCategoryId(email);
    const bucket = emailsByCategory.get(categoryId) ?? [];
    bucket.push(email);
    emailsByCategory.set(categoryId, bucket);
  }

  if (emailsByCategory.size === 0) {
    return [];
  }

  const categoryLookup = new Map(categories.map((category) => [category.id, category]));
  if (!categoryLookup.has(EMAIL_UNCATEGORIZED_CATEGORY_ID)) {
    categoryLookup.set(EMAIL_UNCATEGORIZED_CATEGORY_ID, createUncategorizedEmailCategory());
  }

  const visibleCategories = categoriesWithEmails(
    sortEmailCategories([...categoryLookup.values()]),
    assignableEmails,
  );

  return visibleCategories
    .map((category) => ({
      id: category.id,
      label: category.name,
      emails: emailsByCategory.get(category.id) ?? [],
    }))
    .filter((category) => category.emails.length > 0);
}
