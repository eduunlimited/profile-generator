import { useMemo, useState } from "react";
import { buildEmailAssignCategories } from "../lib/emailAssignTree";
import type { EmailCategory, PoolEmail } from "../lib/types";

interface EmailAssignTreeProps {
  emails: PoolEmail[];
  categories: EmailCategory[];
  selectionMode: "single" | "multiple";
  selectedEmailId?: string;
  selectedEmailIds?: string[];
  selectionLimit?: number;
  onSelectedEmailIdChange?: (id: string) => void;
  onSelectedEmailIdsChange?: (ids: string[]) => void;
}

export function EmailAssignTree({
  emails,
  categories,
  selectionMode,
  selectedEmailId = "",
  selectedEmailIds = [],
  selectionLimit = 0,
  onSelectedEmailIdChange,
  onSelectedEmailIdsChange,
}: EmailAssignTreeProps) {
  const assignCategories = useMemo(
    () => buildEmailAssignCategories(emails, categories),
    [emails, categories],
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(assignCategories.map((category) => [category.id, true])),
  );

  const toggleExpand = (categoryId: string) => {
    setExpanded((current) => ({ ...current, [categoryId]: !current[categoryId] }));
  };

  const toggleEmail = (emailId: string) => {
    if (selectionMode === "single") {
      onSelectedEmailIdChange?.(emailId);
      return;
    }

    const current = selectedEmailIds;
    if (current.includes(emailId)) {
      onSelectedEmailIdsChange?.(current.filter((id) => id !== emailId));
      return;
    }
    if (selectionLimit > 0 && current.length >= selectionLimit) {
      return;
    }
    onSelectedEmailIdsChange?.([...current, emailId]);
  };

  if (assignCategories.length === 0) {
    return <p className="muted">No emails available.</p>;
  }

  const atLimit =
    selectionMode === "multiple" && selectionLimit > 0 && selectedEmailIds.length >= selectionLimit;

  return (
    <div className="assign-profile-tree assign-card-tree">
      {assignCategories.map((category) => {
        const isOpen = expanded[category.id] ?? true;

        return (
          <div key={category.id} className="assign-profile-category">
            <div className="assign-profile-category-header">
              <button
                type="button"
                className="assign-tree-toggle"
                aria-expanded={isOpen}
                onClick={() => toggleExpand(category.id)}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <div className="assign-profile-parent-row assign-card-category-label">
                <span className="assign-option-label">
                  <strong>{category.label}</strong>
                  <span className="muted">
                    {" "}
                    · {category.emails.length} email{category.emails.length === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            </div>
            {isOpen ? (
              <div className="assign-profile-children">
                {category.emails.map((email) => {
                  const selectedIndex = selectedEmailIds.indexOf(email.id);
                  const isSelected =
                    selectionMode === "single" ? selectedEmailId === email.id : selectedIndex >= 0;
                  const disabled = selectionMode === "multiple" && !isSelected && atLimit;

                  return (
                    <label
                      key={email.id}
                      className={`assign-option-row assign-profile-child-row card-assign-row${isSelected ? " card-pool-row-editing" : ""}${disabled ? " assign-option-row-disabled" : ""}`}
                    >
                      <input
                        type={selectionMode === "single" ? "radio" : "checkbox"}
                        name={selectionMode === "single" ? "assign-email" : undefined}
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => toggleEmail(email.id)}
                      />
                      <span className="assign-option-content">
                        {selectionMode === "multiple" && isSelected ? (
                          <span className="assign-card-order">{selectedIndex + 1}</span>
                        ) : null}
                        <span className="assign-option-label">{email.email}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
