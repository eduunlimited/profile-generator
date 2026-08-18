import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  buildImportedProfiles,
  parseProfileImportText,
  readProfileImportFile,
  type ProfileImportFormat,
} from "../lib/profileImport";
import { masterProfileLabel } from "../lib/masterProfileUtils";
import {
  assertProfileCategoryUnlocked,
  createUncategorizedProfileCategory,
  nextProfileCategorySortOrder,
  PROFILE_UNCATEGORIZED_CATEGORY_ID,
  sortProfileCategories,
} from "../lib/profileCategoryUtils";
import type { Credential, MasterProfile, Profile, ProfileCategory, ProfileSummary } from "../lib/types";
import { AccountCategorySelect, resolveCategorySelection, type CategorySelection } from "./AccountCategorySelect";
import { AccountSiteSelect } from "./AccountSiteSelect";
import { Field } from "./ui";

interface ImportProfilesModalProps {
  open: boolean;
  masterProfiles: MasterProfile[];
  profiles: ProfileSummary[];
  categories: ProfileCategory[];
  credentials?: Credential[];
  initialMasterId?: string | null;
  initialCategoryId?: string | null;
  onSaveCategory: (category: ProfileCategory) => Promise<void>;
  onClose: () => void;
  onImport: (profiles: Profile[]) => Promise<void>;
}

function buildImportCategoryOptions(
  categories: ProfileCategory[],
  masterProfileId: string,
  profiles: ProfileSummary[],
): ProfileCategory[] {
  const uncategorized =
    categories.find((category) => category.id === PROFILE_UNCATEGORIZED_CATEGORY_ID) ??
    createUncategorizedProfileCategory();

  const byId = new Map<string, ProfileCategory>();
  byId.set(PROFILE_UNCATEGORIZED_CATEGORY_ID, uncategorized);
  for (const category of categories) {
    if (category.id !== PROFILE_UNCATEGORIZED_CATEGORY_ID) {
      byId.set(category.id, category);
    }
  }

  const options = sortProfileCategories([...byId.values()]);
  if (!masterProfileId) {
    return options;
  }

  const usedUnderMaster = new Set(
    profiles
      .filter((profile) => profile.masterProfileId === masterProfileId)
      .map((profile) => {
        const categoryId = profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID;
        return byId.has(categoryId) ? categoryId : PROFILE_UNCATEGORIZED_CATEGORY_ID;
      }),
  );

  const masterCategories = options.filter((category) => usedUnderMaster.has(category.id));
  const otherCategories = options.filter((category) => !usedUnderMaster.has(category.id));
  return [...masterCategories, ...otherCategories];
}

export function ImportProfilesModal({
  open,
  masterProfiles,
  profiles,
  categories,
  credentials = [],
  initialMasterId = null,
  initialCategoryId = null,
  onSaveCategory,
  onClose,
  onImport,
}: ImportProfilesModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importFormat, setImportFormat] = useState<ProfileImportFormat>("json");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [masterProfileId, setMasterProfileId] = useState("");
  const [categorySelection, setCategorySelection] = useState<CategorySelection>(() => ({
    kind: "existing",
    categoryId: PROFILE_UNCATEGORIZED_CATEGORY_ID,
  }));
  const [accountSite, setAccountSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const importCategoryOptions = useMemo(
    () => buildImportCategoryOptions(categories, masterProfileId, profiles),
    [categories, masterProfileId, profiles],
  );

  const selectedMaster = masterProfiles.find((master) => master.id === masterProfileId) ?? null;

  const credentialSites = useMemo(
    () => [...new Set(credentials.map((credential) => credential.site.trim()).filter(Boolean))],
    [credentials],
  );

  useEffect(() => {
    if (!open) return;
    setAccountSite("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (masterProfiles.length === 0) {
      setMasterProfileId("");
      return;
    }
    const preferredId =
      initialMasterId && masterProfiles.some((master) => master.id === initialMasterId)
        ? initialMasterId
        : masterProfiles[0]?.id ?? "";
    setMasterProfileId((current) =>
      current && masterProfiles.some((master) => master.id === current) ? current : preferredId,
    );
  }, [initialMasterId, masterProfiles, open]);

  useEffect(() => {
    if (!open) return;
    setCategorySelection((current) => {
      if (current.kind === "new") return current;

      const preferredId =
        initialCategoryId && importCategoryOptions.some((category) => category.id === initialCategoryId)
          ? initialCategoryId
          : null;

      if (preferredId) {
        return { kind: "existing", categoryId: preferredId };
      }

      const stillValid = importCategoryOptions.some((category) => category.id === current.categoryId);
      if (stillValid) return current;
      return { kind: "existing", categoryId: PROFILE_UNCATEGORIZED_CATEGORY_ID };
    });
  }, [importCategoryOptions, initialCategoryId, open]);

  if (!open) return null;

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const result = await readProfileImportFile(file);
    resetFileInput();
    if ("error" in result) {
      setStatus(result.error);
      return;
    }

    setImportFormat(result.format);
    setImportText(result.text);
    setImportFileName(result.fileName);
    setStatus(null);
  };

  const createCategory = async (name: string): Promise<ProfileCategory> => {
    const category: ProfileCategory = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      sortOrder: nextProfileCategorySortOrder(categories),
    };
    await onSaveCategory(category);
    return category;
  };

  const handleImport = async () => {
    if (masterProfiles.length === 0) {
      setStatus("Create a master profile before importing jig profiles.");
      return;
    }
    if (!masterProfileId) {
      setStatus("Select a master profile to import into.");
      return;
    }

    const { items, errors: parseErrors } = parseProfileImportText(importText, importFormat);
    if (parseErrors.length > 0) {
      setStatus(parseErrors.join(" "));
      return;
    }

    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(categorySelection, createCategory);
      assertProfileCategoryUnlocked(categories, categoryId, "import profiles into it");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Category is required.");
      return;
    }

    const { profiles: importedProfiles, errors: buildErrors } = buildImportedProfiles(items, {
      masterProfileId,
      categoryId,
      accountSite,
    });

    if (buildErrors.length > 0) {
      setStatus(buildErrors.join(" "));
      return;
    }

    if (importedProfiles.length === 0) {
      setStatus("No profiles to import.");
      return;
    }

    setBusy(true);
    try {
      await onImport(importedProfiles);
      setStatus(`Imported ${importedProfiles.length} profile(s).`);
      setImportText("");
      setImportFileName("");
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog modal-dialog-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>Import profiles</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="card">
          <p className="muted">
            Import AYCD Profile Builder JSON (billingAddress / paymentDetails) or Stellar AIO exports
            (.json or semicolon-delimited .csv). Billing name, email, address, phone, and card data are
            loaded into jig profiles.
          </p>

          {masterProfiles.length === 0 ? (
            <p className="status-inline distribute-warning">
              Create a master profile first — imported jig profiles must belong to a master.
            </p>
          ) : null}

          <div className="import-profiles-form-grid">
            {masterProfiles.length > 0 ? (
              <Field
                className="import-field-master"
                label="Master profile"
                hint="Required — imported profiles become jig children of this master"
              >
                <select value={masterProfileId} onChange={(event) => setMasterProfileId(event.target.value)} required>
                  {masterProfiles.map((master) => (
                    <option key={master.id} value={master.id}>
                      {masterProfileLabel(master)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <Field
              className="import-field-category"
              label="Category"
              hint={
                selectedMaster
                  ? `Categories used under ${masterProfileLabel(selectedMaster)} appear first`
                  : "Applied to all imported profiles"
              }
            >
              <AccountCategorySelect
                categories={importCategoryOptions}
                selection={categorySelection}
                onSelectionChange={setCategorySelection}
                uncategorizedCategoryId={PROFILE_UNCATEGORIZED_CATEGORY_ID}
              />
            </Field>

            <Field
              className="import-field-site"
              label="Account site"
              hint="Email + site account link for imported profiles"
            >
              <AccountSiteSelect
                site={accountSite}
                onSiteChange={setAccountSite}
                extraSites={credentialSites}
                allowNone
              />
            </Field>
          </div>

          <div className="import-format-toggle" role="tablist" aria-label="Import format">
            <button
              type="button"
              role="tab"
              aria-selected={importFormat === "json"}
              className={importFormat === "json" ? "import-format-option active" : "import-format-option"}
              onClick={() => setImportFormat("json")}
            >
              JSON
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={importFormat === "csv"}
              className={importFormat === "csv" ? "import-format-option active" : "import-format-option"}
              onClick={() => setImportFormat("csv")}
            >
              CSV
            </button>
          </div>

          <Field label="Upload file">
            <div className="import-file-row">
              <button type="button" className="btn-secondary btn-compact" onClick={() => fileInputRef.current?.click()}>
                Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,application/json,text/csv"
                className="import-file-input"
                onChange={(event) => void handleFileChange(event)}
              />
              {importFileName ? (
                <span className="import-file-name" title={importFileName}>
                  {importFileName}
                </span>
              ) : (
                <span className="muted import-file-placeholder">No file selected</span>
              )}
            </div>
          </Field>

          <Field label={importFormat === "json" ? "Paste JSON" : "Paste CSV"}>
            <textarea
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                setStatus(null);
              }}
              placeholder={
                importFormat === "json"
                  ? "Paste an AYCD Profile Builder JSON array or Stellar AIO export..."
                  : "Paste a Stellar AIO CSV export with PROFILE_NAME;EMAIL;... headers..."
              }
              rows={12}
            />
          </Field>

          <div className="button-row compact">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !importText.trim() || masterProfiles.length === 0 || !masterProfileId}
              onClick={() => void handleImport()}
            >
              {busy ? "Importing..." : "Import profiles"}
            </button>
          </div>

          {status ? <p className="status-inline">{status}</p> : null}
        </section>
      </div>
    </div>
  );
}
