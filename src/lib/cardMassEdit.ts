import { CARD_UNCATEGORIZED_CATEGORY_ID } from "./cardCategoryUtils";
import { formatCardExpiry, parseCardExpiry } from "./creditCardUtils";
import type { CreditCard } from "./types";

export type CardEditField =
  | "profileName"
  | "brand"
  | "number"
  | "expiryMonth"
  | "expiryYear"
  | "cvv"
  | "categoryId"
  | "accountStatus"
  | "assignmentScope"
  | "notes";

export type CardMixedFields = Record<CardEditField, boolean>;

export type CardTouchedFields = Record<CardEditField, boolean>;

export const CARD_EDIT_FIELDS: CardEditField[] = [
  "profileName",
  "brand",
  "number",
  "expiryMonth",
  "expiryYear",
  "cvv",
  "categoryId",
  "accountStatus",
  "assignmentScope",
  "notes",
];

export function emptyCardTouchedFields(): CardTouchedFields {
  return {
    profileName: false,
    brand: false,
    number: false,
    expiryMonth: false,
    expiryYear: false,
    cvv: false,
    categoryId: false,
    accountStatus: false,
    assignmentScope: false,
    notes: false,
  };
}

export function emptyCardMixedFields(): CardMixedFields {
  return emptyCardTouchedFields();
}

function valuesMatch<T>(items: T[], pick: (item: T) => string): boolean {
  if (items.length === 0) return true;
  const first = pick(items[0]);
  return items.every((item) => pick(item) === first);
}

export function buildCardMassEditDraft(
  cards: CreditCard[],
  ids: string[],
): {
  draft: CreditCard;
  mixedFields: CardMixedFields;
} {
  const selected = cards.filter((card) => ids.includes(card.id));
  const first = selected[0] ?? emptyMassEditCard();

  const mixedFields: CardMixedFields = {
    profileName: !valuesMatch(selected, (card) => card.profileName.trim()),
    brand: !valuesMatch(selected, (card) => card.brand.trim()),
    number: !valuesMatch(selected, (card) => card.number),
    expiryMonth: !valuesMatch(selected, (card) => parseCardExpiry(card.expiry).month),
    expiryYear: !valuesMatch(selected, (card) => parseCardExpiry(card.expiry).year),
    cvv: !valuesMatch(selected, (card) => card.cvv),
    categoryId: !valuesMatch(selected, (card) => card.categoryId || CARD_UNCATEGORIZED_CATEGORY_ID),
    accountStatus: !valuesMatch(selected, (card) => card.accountStatus),
    assignmentScope: !valuesMatch(selected, (card) => card.assignmentScope ?? "account_group"),
    notes: !valuesMatch(selected, (card) => card.notes.trim()),
  };

  const draft: CreditCard = {
    id: first.id,
    profileName: mixedFields.profileName ? "" : first.profileName,
    brand: mixedFields.brand ? "Visa" : first.brand,
    number: mixedFields.number ? "" : first.number,
    expiry: mixedFields.expiryMonth || mixedFields.expiryYear ? "" : first.expiry,
    cvv: mixedFields.cvv ? "" : first.cvv,
    categoryId: mixedFields.categoryId ? CARD_UNCATEGORIZED_CATEGORY_ID : first.categoryId,
    accountStatus: mixedFields.accountStatus ? "good" : first.accountStatus,
    assignmentScope: mixedFields.assignmentScope
      ? "account_group"
      : (first.assignmentScope ?? "account_group"),
    notes: mixedFields.notes ? "" : first.notes,
    createdAt: first.createdAt,
  };

  return { draft, mixedFields };
}

export function applyCardMassEditPatch(
  card: CreditCard,
  draft: CreditCard,
  categoryId: string | null,
  touchedFields: CardTouchedFields,
): CreditCard {
  let expiry = card.expiry;
  if (touchedFields.expiryMonth || touchedFields.expiryYear) {
    const current = parseCardExpiry(card.expiry);
    const draftParts = parseCardExpiry(draft.expiry);
    expiry = formatCardExpiry(
      touchedFields.expiryMonth ? draftParts.month : current.month,
      touchedFields.expiryYear ? draftParts.year : current.year,
    );
  }

  return {
    ...card,
    profileName: touchedFields.profileName ? draft.profileName.trim() : card.profileName,
    brand: touchedFields.brand ? draft.brand : card.brand,
    number: touchedFields.number ? draft.number : card.number,
    expiry,
    cvv: touchedFields.cvv ? draft.cvv : card.cvv,
    categoryId:
      touchedFields.categoryId && categoryId ? categoryId : card.categoryId || CARD_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: touchedFields.accountStatus ? draft.accountStatus : card.accountStatus,
    assignmentScope: touchedFields.assignmentScope
      ? (draft.assignmentScope ?? "account_group")
      : (card.assignmentScope ?? "account_group"),
    notes: touchedFields.notes ? draft.notes.trim() : card.notes,
  };
}

export function hasCardMassEditChanges(touchedFields: CardTouchedFields): boolean {
  return CARD_EDIT_FIELDS.some((field) => touchedFields[field]);
}

function emptyMassEditCard(): CreditCard {
  return {
    id: crypto.randomUUID(),
    profileName: "",
    brand: "Visa",
    number: "",
    expiry: "",
    cvv: "",
    categoryId: CARD_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    assignmentScope: "account_group",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}
