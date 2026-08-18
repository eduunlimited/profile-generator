import { useMemo, useState } from "react";
import { formatCardNumberDisplay } from "../lib/creditCardUtils";
import { buildCardAssignCategories } from "../lib/cardAssignTree";
import type { CardCategory, CreditCard } from "../lib/types";
import { CardBrandIcon } from "./CardBrandIcon";

interface CardAssignTreeProps {
  cards: CreditCard[];
  categories: CardCategory[];
  selectionMode: "single" | "multiple";
  selectedCardId?: string;
  selectedCardIds?: string[];
  selectionLimit?: number;
  onSelectedCardIdChange?: (id: string) => void;
  onSelectedCardIdsChange?: (ids: string[]) => void;
}

export function CardAssignTree({
  cards,
  categories,
  selectionMode,
  selectedCardId = "",
  selectedCardIds = [],
  selectionLimit = 0,
  onSelectedCardIdChange,
  onSelectedCardIdsChange,
}: CardAssignTreeProps) {
  const assignCategories = useMemo(
    () => buildCardAssignCategories(cards, categories),
    [cards, categories],
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(assignCategories.map((category) => [category.id, true])),
  );

  const toggleExpand = (categoryId: string) => {
    setExpanded((current) => ({ ...current, [categoryId]: !current[categoryId] }));
  };

  const toggleCard = (cardId: string) => {
    if (selectionMode === "single") {
      onSelectedCardIdChange?.(cardId);
      return;
    }

    const current = selectedCardIds;
    if (current.includes(cardId)) {
      onSelectedCardIdsChange?.(current.filter((id) => id !== cardId));
      return;
    }
    if (selectionLimit > 0 && current.length >= selectionLimit) {
      return;
    }
    onSelectedCardIdsChange?.([...current, cardId]);
  };

  if (assignCategories.length === 0) {
    return <p className="muted">No cards available.</p>;
  }

  const atLimit = selectionMode === "multiple" && selectionLimit > 0 && selectedCardIds.length >= selectionLimit;

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
                    · {category.cards.length} card{category.cards.length === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            </div>
            {isOpen ? (
              <div className="assign-profile-children">
                {category.cards.map((card) => {
                  const selectedIndex = selectedCardIds.indexOf(card.id);
                  const isSelected =
                    selectionMode === "single" ? selectedCardId === card.id : selectedIndex >= 0;
                  const disabled = selectionMode === "multiple" && !isSelected && atLimit;

                  return (
                    <label
                      key={card.id}
                      className={`assign-option-row assign-profile-child-row card-assign-row${isSelected ? " card-pool-row-editing" : ""}${disabled ? " assign-option-row-disabled" : ""}`}
                    >
                      <input
                        type={selectionMode === "single" ? "radio" : "checkbox"}
                        name={selectionMode === "single" ? "assign-card" : undefined}
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => toggleCard(card.id)}
                      />
                      <span className="assign-option-content">
                        {selectionMode === "multiple" && isSelected ? (
                          <span className="assign-card-order">{selectedIndex + 1}</span>
                        ) : (
                          <span className="card-pool-col-brand">
                            <CardBrandIcon brand={card.brand} size="sm" />
                          </span>
                        )}
                        <span className="assign-option-label">
                          {card.profileName}
                          <span className="muted card-pool-number">
                            {" "}
                            · {formatCardNumberDisplay(card.number, card.brand) || "—"}
                          </span>
                        </span>
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
