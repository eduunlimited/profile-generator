import { useEffect, useRef } from "react";
import { UNCATEGORIZED_CATEGORY_ID } from "../lib/accountCategoryUtils";
import type { AccountCategory } from "../lib/types";

export const ADD_CATEGORY_OPTION = "__add_category__";

export type CategorySelection =
  | { kind: "existing"; categoryId: string }
  | { kind: "new"; name: string };

export type CategoryOption = Pick<AccountCategory, "id" | "name">;

interface AccountCategorySelectProps {
  categories: CategoryOption[];
  selection: CategorySelection;
  onSelectionChange: (selection: CategorySelection) => void;
  uncategorizedCategoryId?: string;
}

export function AccountCategorySelect({
  categories,
  selection,
  onSelectionChange,
  uncategorizedCategoryId = UNCATEGORIZED_CATEGORY_ID,
}: AccountCategorySelectProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selection.kind === "new") {
      inputRef.current?.focus();
    }
  }, [selection.kind]);

  if (selection.kind === "new") {
    return (
      <input
        ref={inputRef}
        className="inline-combobox-control"
        value={selection.name}
        placeholder="Enter category name"
        autoComplete="off"
        onChange={(event) => onSelectionChange({ kind: "new", name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onSelectionChange({ kind: "existing", categoryId: uncategorizedCategoryId });
          }
        }}
      />
    );
  }

  return (
    <select
      className="inline-combobox-control"
      value={selection.categoryId}
      onChange={(event) => {
        const value = event.target.value;
        if (value === ADD_CATEGORY_OPTION) {
          onSelectionChange({ kind: "new", name: "" });
          return;
        }
        onSelectionChange({ kind: "existing", categoryId: value });
      }}
    >
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
      <option value={ADD_CATEGORY_OPTION}>+ Add category</option>
    </select>
  );
}

export async function resolveCategorySelection(
  selection: CategorySelection,
  createCategory: (name: string) => Promise<CategoryOption & { id: string }>,
): Promise<string> {
  if (selection.kind === "existing") {
    return selection.categoryId;
  }

  const name = selection.name.trim();
  if (!name) {
    throw new Error("Category name is required.");
  }

  const category = await createCategory(name);
  return category.id;
}
