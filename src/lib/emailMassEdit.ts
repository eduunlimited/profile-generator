import { EMAIL_UNCATEGORIZED_CATEGORY_ID } from "./emailCategoryUtils";
import type { PoolEmail } from "./types";

export type EmailEditField = "email" | "categoryId" | "accountStatus" | "assignmentScope" | "notes";

export type EmailMixedFields = Record<EmailEditField, boolean>;

export type EmailTouchedFields = Record<EmailEditField, boolean>;

export const EMAIL_EDIT_FIELDS: EmailEditField[] = [
  "email",
  "categoryId",
  "accountStatus",
  "assignmentScope",
  "notes",
];

export function emptyEmailTouchedFields(): EmailTouchedFields {
  return {
    email: false,
    categoryId: false,
    accountStatus: false,
    assignmentScope: false,
    notes: false,
  };
}

export function emptyEmailMixedFields(): EmailMixedFields {
  return emptyEmailTouchedFields();
}

function valuesMatch<T>(items: T[], pick: (item: T) => string): boolean {
  if (items.length === 0) return true;
  const first = pick(items[0]);
  return items.every((item) => pick(item) === first);
}

export function buildEmailMassEditDraft(emails: PoolEmail[], ids: string[]): {
  draft: PoolEmail;
  mixedFields: EmailMixedFields;
} {
  const selected = emails.filter((email) => ids.includes(email.id));
  const first = selected[0] ?? emptyMassEditEmail();

  const mixedFields: EmailMixedFields = {
    email: !valuesMatch(selected, (item) => item.email.trim().toLowerCase()),
    categoryId: !valuesMatch(selected, (item) => item.categoryId || EMAIL_UNCATEGORIZED_CATEGORY_ID),
    accountStatus: !valuesMatch(selected, (item) => item.accountStatus),
    assignmentScope: !valuesMatch(selected, (item) => item.assignmentScope ?? "account_group"),
    notes: !valuesMatch(selected, (item) => item.notes.trim()),
  };

  const draft: PoolEmail = {
    id: first.id,
    email: mixedFields.email ? "" : first.email,
    categoryId: mixedFields.categoryId ? EMAIL_UNCATEGORIZED_CATEGORY_ID : first.categoryId,
    accountStatus: mixedFields.accountStatus ? "good" : first.accountStatus,
    assignmentScope: mixedFields.assignmentScope
      ? "account_group"
      : (first.assignmentScope ?? "account_group"),
    notes: mixedFields.notes ? "" : first.notes,
    createdAt: first.createdAt,
  };

  return { draft, mixedFields };
}

export function applyEmailMassEditPatch(
  email: PoolEmail,
  draft: PoolEmail,
  categoryId: string | null,
  touchedFields: EmailTouchedFields,
): PoolEmail {
  return {
    ...email,
    email: touchedFields.email ? draft.email.trim() : email.email,
    categoryId:
      touchedFields.categoryId && categoryId
        ? categoryId
        : email.categoryId || EMAIL_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: touchedFields.accountStatus ? draft.accountStatus : email.accountStatus,
    assignmentScope: touchedFields.assignmentScope
      ? (draft.assignmentScope ?? "account_group")
      : (email.assignmentScope ?? "account_group"),
    notes: touchedFields.notes ? draft.notes.trim() : email.notes,
  };
}

export function hasEmailMassEditChanges(touchedFields: EmailTouchedFields): boolean {
  return EMAIL_EDIT_FIELDS.some((field) => touchedFields[field]);
}

function emptyMassEditEmail(): PoolEmail {
  return {
    id: crypto.randomUUID(),
    email: "",
    categoryId: EMAIL_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    assignmentScope: "account_group",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}
