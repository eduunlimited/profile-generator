import { UNCATEGORIZED_CATEGORY_ID } from "./accountCategoryUtils";
import type { Credential } from "./types";

export type CredentialEditField =
  | "site"
  | "username"
  | "password"
  | "categoryId"
  | "accountStatus"
  | "notes";

export type CredentialMixedFields = Record<CredentialEditField, boolean>;

export type CredentialTouchedFields = Record<CredentialEditField, boolean>;

export const CREDENTIAL_EDIT_FIELDS: CredentialEditField[] = [
  "site",
  "username",
  "password",
  "categoryId",
  "accountStatus",
  "notes",
];

export function emptyTouchedFields(): CredentialTouchedFields {
  return {
    site: false,
    username: false,
    password: false,
    categoryId: false,
    accountStatus: false,
    notes: false,
  };
}

export function emptyMixedFields(): CredentialMixedFields {
  return emptyTouchedFields();
}

function valuesMatch<T>(items: T[], pick: (item: T) => string): boolean {
  if (items.length === 0) return true;
  const first = pick(items[0]);
  return items.every((item) => pick(item) === first);
}

export function buildMassEditDraft(
  credentials: Credential[],
  ids: string[],
): {
  draft: Credential;
  mixedFields: CredentialMixedFields;
} {
  const selected = credentials.filter((credential) => ids.includes(credential.id));
  const first = selected[0] ?? emptyMassEditCredential();

  const mixedFields: CredentialMixedFields = {
    site: !valuesMatch(selected, (credential) => credential.site.trim()),
    username: !valuesMatch(selected, (credential) => credential.username.trim()),
    password: !valuesMatch(selected, (credential) => credential.password),
    categoryId: !valuesMatch(
      selected,
      (credential) => credential.categoryId || UNCATEGORIZED_CATEGORY_ID,
    ),
    accountStatus: !valuesMatch(selected, (credential) => credential.accountStatus),
    notes: !valuesMatch(selected, (credential) => credential.notes.trim()),
  };

  const categorySelectionId = mixedFields.categoryId
    ? UNCATEGORIZED_CATEGORY_ID
    : first.categoryId || UNCATEGORIZED_CATEGORY_ID;

  const draft: Credential = {
    id: first.id,
    site: mixedFields.site ? "" : first.site,
    username: mixedFields.username ? "" : first.username,
    password: mixedFields.password ? "" : first.password,
    categoryId: categorySelectionId,
    accountStatus: mixedFields.accountStatus ? "good" : first.accountStatus,
    notes: mixedFields.notes ? "" : first.notes,
    createdAt: first.createdAt,
  };

  return { draft, mixedFields };
}

export function applyMassEditPatch(
  credential: Credential,
  draft: Credential,
  categoryId: string | null,
  touchedFields: CredentialTouchedFields,
): Credential {
  return {
    ...credential,
    site: touchedFields.site ? draft.site.trim() : credential.site,
    username: touchedFields.username ? draft.username.trim() : credential.username,
    password: touchedFields.password ? draft.password : credential.password,
    categoryId:
      touchedFields.categoryId && categoryId ? categoryId : credential.categoryId || UNCATEGORIZED_CATEGORY_ID,
    accountStatus: touchedFields.accountStatus ? draft.accountStatus : credential.accountStatus,
    notes: touchedFields.notes ? draft.notes.trim() : credential.notes,
  };
}

export function hasMassEditChanges(touchedFields: CredentialTouchedFields): boolean {
  return CREDENTIAL_EDIT_FIELDS.some((field) => touchedFields[field]);
}

function emptyMassEditCredential(): Credential {
  return {
    id: crypto.randomUUID(),
    site: "",
    username: "",
    password: "",
    categoryId: UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}
