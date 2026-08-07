import type { AccountCategory, AccountReviewStatus, Credential } from "../lib/types";
import type { CredentialEditField, CredentialMixedFields, CredentialTouchedFields } from "../lib/credentialMassEdit";
import {
  AccountCategorySelect,
  type CategorySelection,
} from "./AccountCategorySelect";
import { AccountSiteSelect } from "./AccountSiteSelect";
import { Field } from "./ui";

const MASS_EDIT_PLACEHOLDER = "Multiple values";

interface AccountFormModalProps {
  open: boolean;
  title: string;
  draft: Credential;
  isEditing: boolean;
  isMassEditing?: boolean;
  massEditCount?: number;
  mixedFields?: CredentialMixedFields;
  touchedFields?: CredentialTouchedFields;
  formCategories: AccountCategory[];
  importCategories: AccountCategory[];
  draftCategorySelection: CategorySelection;
  importCategorySelection: CategorySelection;
  importSite: string;
  importText: string;
  customSitesFromPool: string[];
  canDeleteDraftCategory: boolean;
  status: string | null;
  onClose: () => void;
  onDraftChange: (draft: Credential) => void;
  onDraftCategorySelectionChange: (selection: CategorySelection) => void;
  onImportSiteChange: (site: string) => void;
  onImportCategorySelectionChange: (selection: CategorySelection) => void;
  onImportTextChange: (text: string) => void;
  onFieldTouch?: (field: CredentialEditField) => void;
  onSave: () => void;
  onImport: () => void;
  onStartNew: () => void;
  onDeleteDraftCategory: () => void;
  initialSection?: "add" | "import";
}

export function AccountFormModal({
  open,
  title,
  draft,
  isEditing,
  isMassEditing = false,
  massEditCount = 0,
  mixedFields,
  touchedFields,
  formCategories,
  importCategories,
  draftCategorySelection,
  importCategorySelection,
  importSite,
  importText,
  customSitesFromPool,
  canDeleteDraftCategory,
  status,
  onClose,
  onDraftChange,
  onDraftCategorySelectionChange,
  onImportSiteChange,
  onImportCategorySelectionChange,
  onImportTextChange,
  onFieldTouch,
  onSave,
  onImport,
  onStartNew,
  onDeleteDraftCategory,
  initialSection = "add",
}: AccountFormModalProps) {
  if (!open) return null;

  const showMixed = (field: CredentialEditField) =>
    Boolean(isMassEditing && mixedFields?.[field] && !touchedFields?.[field]);

  const touch = (field: CredentialEditField) => {
    onFieldTouch?.(field);
  };

  const formHeading = isMassEditing
    ? `Edit ${massEditCount} accounts`
    : isEditing
      ? "Edit account"
      : "Add account";

  const saveLabel = isMassEditing
    ? `Update ${massEditCount} account${massEditCount === 1 ? "" : "s"}`
    : isEditing
      ? "Save changes"
      : "Add account";

  const showAddSection = isEditing || isMassEditing || initialSection === "add";
  const showImportSection = !isEditing && !isMassEditing && initialSection === "import";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-wide account-form-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <strong>{title}</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          {showAddSection ? (
          <section className="account-form-section" id={initialSection === "add" ? "account-add" : undefined}>
            <div className="card-header">
              <h2>{formHeading}</h2>
              {isEditing && !isMassEditing ? (
                <div className="button-row compact">
                  <button type="button" className="btn-secondary btn-compact" onClick={onStartNew}>
                    Cancel edit
                  </button>
                </div>
              ) : null}
            </div>
            {isMassEditing ? (
              <p className="muted mass-edit-hint">
                Shared values are shown. Fields left blank vary across the selection — set a value to apply it to
                all selected accounts.
              </p>
            ) : null}
            <div className="form-grid two-col">
              <Field label="Site">
                {showMixed("site") ? (
                  <input
                    className="mass-edit-mixed"
                    readOnly
                    value=""
                    placeholder={MASS_EDIT_PLACEHOLDER}
                    onFocus={() => {
                      touch("site");
                      onDraftChange({ ...draft, site: "" });
                    }}
                  />
                ) : (
                  <AccountSiteSelect
                    site={draft.site}
                    onSiteChange={(site) => {
                      if (isMassEditing) touch("site");
                      onDraftChange({ ...draft, site });
                    }}
                    extraSites={customSitesFromPool}
                  />
                )}
              </Field>
              <Field label="Username">
                <input
                  className={showMixed("username") ? "mass-edit-mixed" : undefined}
                  value={showMixed("username") ? "" : draft.username}
                  onChange={(event) => {
                    if (isMassEditing) touch("username");
                    onDraftChange({ ...draft, username: event.target.value });
                  }}
                  placeholder={showMixed("username") ? MASS_EDIT_PLACEHOLDER : "user@example.com"}
                  autoComplete="off"
                />
              </Field>
              <Field label="Password">
                <input
                  className={showMixed("password") ? "mass-edit-mixed" : undefined}
                  value={showMixed("password") ? "" : draft.password}
                  onChange={(event) => {
                    if (isMassEditing) touch("password");
                    onDraftChange({ ...draft, password: event.target.value });
                  }}
                  placeholder={showMixed("password") ? MASS_EDIT_PLACEHOLDER : undefined}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Category">
                {showMixed("categoryId") ? (
                  <input
                    className="mass-edit-mixed"
                    readOnly
                    value=""
                    placeholder={MASS_EDIT_PLACEHOLDER}
                    onFocus={() => touch("categoryId")}
                  />
                ) : (
                  <AccountCategorySelect
                    categories={formCategories}
                    selection={draftCategorySelection}
                    onSelectionChange={(selection) => {
                      if (isMassEditing) touch("categoryId");
                      onDraftCategorySelectionChange(selection);
                    }}
                  />
                )}
              </Field>
              {canDeleteDraftCategory && !isMassEditing ? (
                <div className="field field-action">
                  <span className="field-heading">&nbsp;</span>
                  <button
                    type="button"
                    className="btn-secondary btn-compact ghost-button danger"
                    onClick={onDeleteDraftCategory}
                  >
                    Delete category
                  </button>
                </div>
              ) : null}
              <Field label="Status">
                {showMixed("accountStatus") ? (
                  <input
                    className="mass-edit-mixed"
                    readOnly
                    value=""
                    placeholder={MASS_EDIT_PLACEHOLDER}
                    onFocus={() => {
                      touch("accountStatus");
                      onDraftChange({ ...draft, accountStatus: "good" });
                    }}
                  />
                ) : (
                  <select
                    value={draft.accountStatus}
                    onChange={(event) => {
                      if (isMassEditing) touch("accountStatus");
                      onDraftChange({
                        ...draft,
                        accountStatus: event.target.value as AccountReviewStatus,
                      });
                    }}
                  >
                    <option value="good">Good</option>
                    <option value="not_good">Not Good</option>
                  </select>
                )}
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                className={showMixed("notes") ? "mass-edit-mixed" : undefined}
                rows={3}
                value={showMixed("notes") ? "" : draft.notes}
                onChange={(event) => {
                  if (isMassEditing) touch("notes");
                  onDraftChange({ ...draft, notes: event.target.value });
                }}
                placeholder={showMixed("notes") ? MASS_EDIT_PLACEHOLDER : "Optional notes about this account"}
              />
            </Field>
            <div className="button-row button-row-spaced">
              <button type="button" className="btn-primary" onClick={() => void onSave()}>
                {saveLabel}
              </button>
            </div>
          </section>
          ) : null}

          {showImportSection ? (
            <>
              <h3
                className="panel-subsection-title"
                id="account-import"
              >
                Bulk import
              </h3>
              <div className="form-grid two-col">
                <Field label="Site">
                  <AccountSiteSelect
                    site={importSite}
                    onSiteChange={onImportSiteChange}
                    extraSites={customSitesFromPool}
                  />
                </Field>
                <Field label="Category">
                  <AccountCategorySelect
                    categories={importCategories}
                    selection={importCategorySelection}
                    onSelectionChange={onImportCategorySelectionChange}
                  />
                </Field>
              </div>
              <Field label="Accounts" hint="One username:password per line">
                <textarea
                  rows={6}
                  value={importText}
                  onChange={(event) => onImportTextChange(event.target.value)}
                  placeholder={"user@mail.com:password123\nanotheruser:pass:with:colons"}
                />
              </Field>
              <div className="button-row">
                <button type="button" className="btn-secondary" onClick={() => void onImport()}>
                  Import accounts
                </button>
              </div>
            </>
          ) : null}
          {status ? <p className="status-inline">{status}</p> : null}
        </div>
      </div>
    </div>
  );
}
