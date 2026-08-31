import type { EmailCategory, PoolEmail } from "../lib/types";
import type { EmailEditField, EmailMixedFields, EmailTouchedFields } from "../lib/emailMassEdit";
import { AccountCategorySelect, type CategorySelection } from "./AccountCategorySelect";
import { Field } from "./ui";

const MASS_EDIT_PLACEHOLDER = "Multiple values";

interface EmailFormModalProps {
  open: boolean;
  title: string;
  draft: PoolEmail;
  isEditing: boolean;
  isMassEditing?: boolean;
  massEditCount?: number;
  mixedFields?: EmailMixedFields;
  touchedFields?: EmailTouchedFields;
  formCategories: EmailCategory[];
  importCategories: EmailCategory[];
  draftCategorySelection: CategorySelection;
  importCategorySelection: CategorySelection;
  importText: string;
  canDeleteDraftCategory: boolean;
  status: string | null;
  onClose: () => void;
  onDraftChange: (draft: PoolEmail) => void;
  onDraftCategorySelectionChange: (selection: CategorySelection) => void;
  onImportCategorySelectionChange: (selection: CategorySelection) => void;
  onImportTextChange: (text: string) => void;
  onFieldTouch?: (field: EmailEditField) => void;
  onSave: () => void;
  onImport: () => void;
  onStartNew: () => void;
  onDeleteDraftCategory: () => void;
  initialSection?: "add" | "import";
}

export function EmailFormModal({
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
  importText,
  canDeleteDraftCategory,
  status,
  onClose,
  onDraftChange,
  onDraftCategorySelectionChange,
  onImportCategorySelectionChange,
  onImportTextChange,
  onFieldTouch,
  onSave,
  onImport,
  onStartNew,
  onDeleteDraftCategory,
  initialSection = "add",
}: EmailFormModalProps) {
  if (!open) return null;

  const showMixed = (field: EmailEditField) =>
    Boolean(isMassEditing && mixedFields?.[field] && !touchedFields?.[field]);

  const touch = (field: EmailEditField) => {
    onFieldTouch?.(field);
  };

  const formHeading = isMassEditing
    ? `Edit ${massEditCount} emails`
    : isEditing
      ? "Edit email"
      : "Add email";

  const saveLabel = isMassEditing
    ? `Update ${massEditCount} email${massEditCount === 1 ? "" : "s"}`
    : isEditing
      ? "Save changes"
      : "Add email";

  const showAddSection = isEditing || isMassEditing || initialSection === "add";
  const showImportSection = !isEditing && !isMassEditing && initialSection === "import";

  return (
    <div className="modal-overlay">
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
            <section className="account-form-section" id={initialSection === "add" ? "email-add" : undefined}>
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
                  all selected emails.
                </p>
              ) : null}
              <div className="form-grid two-col">
                <Field label="Email">
                  <input
                    className={showMixed("email") ? "mass-edit-mixed" : undefined}
                    value={showMixed("email") ? "" : draft.email}
                    onChange={(event) => {
                      if (isMassEditing) touch("email");
                      onDraftChange({ ...draft, email: event.target.value });
                    }}
                    placeholder={showMixed("email") ? MASS_EDIT_PLACEHOLDER : "user@example.com"}
                    autoComplete="off"
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
                          accountStatus: event.target.value as PoolEmail["accountStatus"],
                        });
                      }}
                    >
                      <option value="good">Good</option>
                      <option value="not_good">Not Good</option>
                    </select>
                  )}
                </Field>
                <Field
                  label="Assignment"
                  className="form-grid-span"
                  hint="When unchecked, the email may be assigned once per profile category and reused in other categories. When checked, it can only be on a single profile."
                >
                  <label className={`checkbox-row${showMixed("assignmentScope") ? " mass-edit-mixed" : ""}`}>
                    <input
                      type="checkbox"
                      checked={
                        showMixed("assignmentScope") ? false : draft.assignmentScope === "single_profile"
                      }
                      onChange={(event) => {
                        if (isMassEditing) touch("assignmentScope");
                        onDraftChange({
                          ...draft,
                          assignmentScope: event.target.checked ? "single_profile" : "account_group",
                        });
                      }}
                    />
                    <span>
                      Assign only to 1 profile
                      {showMixed("assignmentScope") ? ` (${MASS_EDIT_PLACEHOLDER})` : ""}
                    </span>
                  </label>
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
                  placeholder={showMixed("notes") ? MASS_EDIT_PLACEHOLDER : "Optional notes about this email"}
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
              <h3 className="panel-subsection-title" id="email-import">
                Bulk import
              </h3>
              <Field label="Category">
                <AccountCategorySelect
                  categories={importCategories}
                  selection={importCategorySelection}
                  onSelectionChange={onImportCategorySelectionChange}
                />
              </Field>
              <Field label="Emails" hint="One email address per line">
                <textarea
                  rows={8}
                  value={importText}
                  onChange={(event) => onImportTextChange(event.target.value)}
                  placeholder={"user1@example.com\nuser2@example.com"}
                />
              </Field>
              <div className="button-row">
                <button type="button" className="btn-secondary" onClick={() => void onImport()}>
                  Import emails
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
