import { useRef, type ChangeEvent } from "react";
import {
  detectCardBrand,
  formatCardExpiry,
  formatCardNumberDisplay,
  formatCardNumberInput,
  formatExpiryYearInput,
  parseCardExpiry,
} from "../lib/creditCardUtils";
import {
  CARD_IMPORT_FIELD_OPTIONS,
  type CardImportColumnMapping,
  type CardImportFormat,
} from "../lib/cardImport";
import { CARD_UNCATEGORIZED_CATEGORY_ID } from "../lib/cardCategoryUtils";
import type { CardEditField, CardMixedFields, CardTouchedFields } from "../lib/cardMassEdit";
import type { AccountReviewStatus, CardCategory, CreditCard } from "../lib/types";
import { AccountCategorySelect, type CategorySelection } from "./AccountCategorySelect";
import { CardBrandIcon } from "./CardBrandIcon";
import { Field } from "./ui";

const CARD_BRANDS = ["Visa", "Mastercard", "Amex", "Discover"] as const;
const EXPIRY_MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;
const MASS_EDIT_PLACEHOLDER = "Multiple values";

interface CardFormModalProps {
  open: boolean;
  title: string;
  draft: CreditCard;
  isEditing: boolean;
  isMassEditing?: boolean;
  massEditCount?: number;
  mixedFields?: CardMixedFields;
  touchedFields?: CardTouchedFields;
  formCategories: CardCategory[];
  importCategories: CardCategory[];
  draftCategorySelection: CategorySelection;
  importCategorySelection: CategorySelection;
  importFormat: CardImportFormat;
  importText: string;
  importCsvText?: string;
  importCsvFileName?: string;
  importCsvHeaders?: string[] | null;
  importColumnMapping?: CardImportColumnMapping;
  canDeleteDraftCategory: boolean;
  status: string | null;
  onClose: () => void;
  onDraftChange: (draft: CreditCard) => void;
  onDraftCategorySelectionChange: (selection: CategorySelection) => void;
  onImportCategorySelectionChange: (selection: CategorySelection) => void;
  onImportFormatChange: (format: CardImportFormat) => void;
  onImportTextChange: (text: string) => void;
  onImportCsvTextChange: (text: string) => void;
  onCsvFileUpload: (file: File | null) => void;
  onClearCsvImport: () => void;
  onImportColumnMappingChange?: (mapping: CardImportColumnMapping) => void;
  onFieldTouch?: (field: CardEditField) => void;
  onSave: () => void;
  onImport: () => void;
  onStartNew: () => void;
  onDeleteDraftCategory: () => void;
  initialSection?: "add" | "import";
}

export function CardFormModal({
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
  importFormat,
  importText,
  importCsvText = "",
  importCsvFileName = "",
  importCsvHeaders = null,
  importColumnMapping = [],
  canDeleteDraftCategory,
  status,
  onClose,
  onDraftChange,
  onDraftCategorySelectionChange,
  onImportCategorySelectionChange,
  onImportFormatChange,
  onImportTextChange,
  onImportCsvTextChange,
  onCsvFileUpload,
  onClearCsvImport,
  onImportColumnMappingChange,
  onFieldTouch,
  onSave,
  onImport,
  onStartNew,
  onDeleteDraftCategory,
  initialSection = "add",
}: CardFormModalProps) {
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const showMixed = (field: CardEditField) =>
    Boolean(isMassEditing && mixedFields?.[field] && !touchedFields?.[field]);

  const touch = (field: CardEditField) => {
    onFieldTouch?.(field);
  };

  const updateDraft = (patch: Partial<CreditCard>) => {
    const next = { ...draft, ...patch };
    if (patch.number !== undefined) {
      next.brand = detectCardBrand(next.number);
    }
    onDraftChange(next);
  };

  const formHeading = isMassEditing
    ? `Edit ${massEditCount} cards`
    : isEditing
      ? "Edit card"
      : "Add card";

  const saveLabel = isMassEditing
    ? `Update ${massEditCount} card${massEditCount === 1 ? "" : "s"}`
    : isEditing
      ? "Save changes"
      : "Add card";

  const showAddSection = isEditing || isMassEditing || initialSection === "add";
  const showImportSection = !isEditing && !isMassEditing && initialSection === "import";
  const showCsvMapping = importFormat === "csv" && Boolean(importCsvHeaders?.length);
  const hasCsvData = Boolean(importCsvText.trim() || importCsvFileName);

  const handleCsvFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    onCsvFileUpload(file);
    event.target.value = "";
  };

  const updateColumnMapping = (index: number, value: CardImportColumnMapping[number]) => {
    if (!importCsvHeaders || !onImportColumnMappingChange) return;
    const next = [...importColumnMapping];
    while (next.length < importCsvHeaders.length) {
      next.push("");
    }
    next[index] = value;
    onImportColumnMappingChange(next);
  };

  const expiryParts = parseCardExpiry(draft.expiry);

  const updateExpiry = (patch: { month?: string; year?: string }, touchFields: Array<"expiryMonth" | "expiryYear">) => {
    touchFields.forEach((field) => touch(field));
    const month = patch.month ?? expiryParts.month;
    const year = patch.year ?? expiryParts.year;
    updateDraft({ expiry: formatCardExpiry(month, year) });
  };

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
            <section className="account-form-section">
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
                  Shared values are shown. Fields left blank vary across the selection — set a value to apply it
                  to all selected cards.
                </p>
              ) : null}
              <div className="form-grid two-col">
                <Field label="Card name" hint="Required — shown on jig profiles instead of card number">
                  <input
                    className={showMixed("profileName") ? "mass-edit-mixed" : undefined}
                    value={showMixed("profileName") ? "" : draft.profileName}
                    onChange={(event) => {
                      if (isMassEditing) touch("profileName");
                      updateDraft({ profileName: event.target.value });
                    }}
                    placeholder={showMixed("profileName") ? MASS_EDIT_PLACEHOLDER : "Visa checkout A"}
                  />
                </Field>
                <Field label="Brand">
                  {showMixed("brand") ? (
                    <input
                      className="mass-edit-mixed"
                      readOnly
                      value=""
                      placeholder={MASS_EDIT_PLACEHOLDER}
                      onFocus={() => {
                        touch("brand");
                        updateDraft({ brand: "Visa" });
                      }}
                    />
                  ) : (
                    <div className="brand-field-row">
                      <CardBrandIcon brand={draft.brand} size="md" />
                      <select
                        value={draft.brand}
                        onChange={(event) => {
                          if (isMassEditing) touch("brand");
                          updateDraft({ brand: event.target.value });
                        }}
                      >
                        {CARD_BRANDS.map((brand) => (
                          <option key={brand} value={brand}>
                            {brand}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </Field>
                <Field label="Number">
                  <input
                    className={`card-pool-number${showMixed("number") ? " mass-edit-mixed" : ""}`}
                    value={showMixed("number") ? "" : formatCardNumberDisplay(draft.number, draft.brand)}
                    onChange={(event) => {
                      if (isMassEditing) touch("number");
                      updateDraft({ number: formatCardNumberInput(event.target.value, draft.brand) });
                    }}
                    placeholder={showMixed("number") ? MASS_EDIT_PLACEHOLDER : "4111 1111 1111 1111"}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Exp. month">
                  {showMixed("expiryMonth") ? (
                    <input
                      className="mass-edit-mixed"
                      readOnly
                      value=""
                      placeholder={MASS_EDIT_PLACEHOLDER}
                      onFocus={() => {
                        touch("expiryMonth");
                        updateDraft({ expiry: formatCardExpiry("01", expiryParts.year) });
                      }}
                    />
                  ) : (
                    <select
                      value={expiryParts.month}
                      onChange={(event) => {
                        updateExpiry({ month: event.target.value }, ["expiryMonth"]);
                      }}
                    >
                      <option value="">Month</option>
                      {EXPIRY_MONTHS.map((month) => (
                        <option key={month} value={month}>
                          {month}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Exp. year">
                  <input
                    className={showMixed("expiryYear") ? "mass-edit-mixed" : undefined}
                    value={showMixed("expiryYear") ? "" : expiryParts.year}
                    onChange={(event) => {
                      updateExpiry({ year: formatExpiryYearInput(event.target.value) }, ["expiryYear"]);
                    }}
                    placeholder={showMixed("expiryYear") ? MASS_EDIT_PLACEHOLDER : "2028"}
                    inputMode="numeric"
                    maxLength={4}
                  />
                </Field>
                <Field label="CVV">
                  <input
                    className={showMixed("cvv") ? "mass-edit-mixed" : undefined}
                    value={showMixed("cvv") ? "" : draft.cvv}
                    onChange={(event) => {
                      if (isMassEditing) touch("cvv");
                      updateDraft({ cvv: event.target.value });
                    }}
                    placeholder={showMixed("cvv") ? MASS_EDIT_PLACEHOLDER : undefined}
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
                <Field label="Status">
                  {showMixed("accountStatus") ? (
                    <input
                      className="mass-edit-mixed"
                      readOnly
                      value=""
                      placeholder={MASS_EDIT_PLACEHOLDER}
                      onFocus={() => {
                        touch("accountStatus");
                        updateDraft({ accountStatus: "good" });
                      }}
                    />
                  ) : (
                    <select
                      value={draft.accountStatus}
                      onChange={(event) => {
                        if (isMassEditing) touch("accountStatus");
                        updateDraft({ accountStatus: event.target.value as AccountReviewStatus });
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
                  hint="When unchecked, the card may be shared across Target/Walmart account groups (one profile per site)."
                >
                  <label className={`checkbox-row${showMixed("assignmentScope") ? " mass-edit-mixed" : ""}`}>
                    <input
                      type="checkbox"
                      checked={
                        showMixed("assignmentScope")
                          ? false
                          : draft.assignmentScope === "single_profile"
                      }
                      onChange={(event) => {
                        if (isMassEditing) touch("assignmentScope");
                        updateDraft({
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
              {canDeleteDraftCategory && !isMassEditing ? (
                <div className="button-row compact">
                  <button
                    type="button"
                    className="btn-secondary btn-compact ghost-button danger"
                    onClick={onDeleteDraftCategory}
                  >
                    Delete category
                  </button>
                </div>
              ) : null}
              <Field label="Notes">
                <textarea
                  className={showMixed("notes") ? "mass-edit-mixed" : undefined}
                  rows={3}
                  value={showMixed("notes") ? "" : draft.notes}
                  onChange={(event) => {
                    if (isMassEditing) touch("notes");
                    updateDraft({ notes: event.target.value });
                  }}
                  placeholder={showMixed("notes") ? MASS_EDIT_PLACEHOLDER : "Optional notes about this card"}
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
              <h3 className="panel-subsection-title">Import cards</h3>
              <Field
                label={importFormat === "csv" && importColumnMapping.includes("categoryId") ? "Default category" : "Category"}
                hint={
                  importFormat === "csv" && importColumnMapping.includes("categoryId")
                    ? "Used when a row's category cell is empty. New categories are created automatically from CSV values."
                    : importFormat === "csv"
                      ? "Applied to all cards unless you map a CSV column to Category"
                      : "Applied to all imported cards. New categories in JSON are created automatically."
                }
              >
                <AccountCategorySelect
                  categories={importCategories}
                  selection={importCategorySelection}
                  onSelectionChange={onImportCategorySelectionChange}
                />
              </Field>
              <div className="import-format-toggle" role="tablist" aria-label="Import format">
                <button
                  type="button"
                  role="tab"
                  aria-selected={importFormat === "csv"}
                  className={importFormat === "csv" ? "import-format-option active" : "import-format-option"}
                  onClick={() => onImportFormatChange("csv")}
                >
                  CSV
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={importFormat === "json"}
                  className={importFormat === "json" ? "import-format-option active" : "import-format-option"}
                  onClick={() => onImportFormatChange("json")}
                >
                  JSON paste
                </button>
              </div>

              {importFormat === "csv" ? (
                <>
                  <Field
                    label="Upload file"
                    hint="Optional — or paste CSV below"
                  >
                    <div className="import-file-row">
                      <input
                        ref={csvFileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="import-file-input"
                        onChange={handleCsvFileChange}
                      />
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => csvFileInputRef.current?.click()}
                      >
                        Choose file
                      </button>
                      {importCsvFileName ? (
                        <>
                          <span className="import-file-name" title={importCsvFileName}>
                            {importCsvFileName}
                          </span>
                          <button
                            type="button"
                            className="btn-secondary btn-compact ghost-button"
                            onClick={() => {
                              onClearCsvImport();
                              if (csvFileInputRef.current) {
                                csvFileInputRef.current.value = "";
                              }
                            }}
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <span className="muted import-file-placeholder">No file selected</span>
                      )}
                    </div>
                  </Field>
                  <Field
                    label="Paste CSV"
                    hint="Header row optional. Without headers, use: card name, number, exp month, exp year, CVV, card type"
                  >
                    <textarea
                      rows={8}
                      value={importCsvText}
                      onChange={(event) => onImportCsvTextChange(event.target.value)}
                      placeholder={
                        "profileName,number,expiryMonth,expiryYear,cvv,cardType\nVisa A,4111111111111111,12,2028,123,Visa"
                      }
                    />
                  </Field>
                  {showCsvMapping ? (
                    <div className="import-column-mapping">
                      <p className="import-column-mapping-title">Map CSV columns to app fields</p>
                      <div className="import-column-mapping-header">
                        <span>CSV column</span>
                        <span>App field</span>
                      </div>
                      {importCsvHeaders?.map((header, index) => {
                        const selectedField = importColumnMapping[index] ?? "";
                        const usedFields = new Set(
                          importColumnMapping.filter((field, fieldIndex) => field && fieldIndex !== index),
                        );

                        return (
                          <div className="import-column-mapping-row" key={`${header}-${index}`}>
                            <span className="import-column-mapping-source" title={header}>
                              {header || `Column ${index + 1}`}
                            </span>
                            <select
                              value={selectedField}
                              onChange={(event) =>
                                updateColumnMapping(index, event.target.value as CardImportColumnMapping[number])
                              }
                            >
                              <option value="">Skip</option>
                              {CARD_IMPORT_FIELD_OPTIONS.map((option) => (
                                <option
                                  key={option.value}
                                  value={option.value}
                                  disabled={usedFields.has(option.value)}
                                >
                                  {option.label}
                                  {option.required ? " (required)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                <Field label="Paste JSON" hint="Array of card objects">
                  <textarea
                    rows={8}
                    value={importText}
                    onChange={(event) => onImportTextChange(event.target.value)}
                    placeholder={
                      '[{"profileName":"Visa A","number":"4111...","expiryMonth":"12","expiryYear":"2028","cvv":"123","cardType":"Visa"}]'
                    }
                  />
                </Field>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={importFormat === "csv" ? !hasCsvData : !importText.trim()}
                  onClick={() => void onImport()}
                >
                  {importFormat === "csv" ? "Import CSV" : "Import JSON"}
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

export function emptyCard(categoryId?: string): CreditCard {
  return {
    id: crypto.randomUUID(),
    profileName: "",
    number: "",
    expiry: "",
    cvv: "",
    brand: "Visa",
    categoryId: categoryId ?? CARD_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    assignmentScope: "account_group",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}
