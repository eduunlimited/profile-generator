import { useEffect, useMemo, useState } from "react";
import { AddressJigCheckboxList } from "./AddressJigCheckboxList";
import {
  AccountCategorySelect,
  resolveCategorySelection,
  type CategorySelection,
} from "./AccountCategorySelect";
import { PhoneLastFourJigField } from "./PhoneLastFourJigField";
import { NameMisspellScopeField } from "./NameMisspellScopeField";
import { StreetRandomLettersJigField } from "./StreetRandomLettersJigField";
import { JigAddressPreview } from "./JigAddressPreview";
import {
  RECOMMENDED_ADDRESS_JIG_IDS,
  RECOMMENDED_NAME_JIG_IDS,
} from "../lib/jigRuleLabels";
import { isStreetRandomLetterPresetId, sortJigPresets } from "../lib/jigPresetUtils";
import {
  assertProfileCategoryUnlocked,
  isProfileCategoryLocked,
  nextProfileCategorySortOrder,
  PROFILE_UNCATEGORIZED_CATEGORY_ID,
  sortProfileCategories,
} from "../lib/profileCategoryUtils";
import { filterAssignablePoolCards } from "../lib/creditCardUtils";
import { filterAssignablePoolEmails } from "../lib/emailPoolUtils";
import type {
  Credential,
  CreditCard,
  GenerateFromMasterOptions,
  JigPreset,
  MasterProfile,
  NameMisspellScope,
  PoolEmail,
  ProfileCategory,
  StreetAffixMode,
} from "../lib/types";
import { masterProfileLabel } from "../lib/masterProfileUtils";
import { AccountSiteSelect } from "./AccountSiteSelect";
import { Field } from "./ui";

interface GeneratePanelProps {
  masterProfiles: MasterProfile[];
  initialMasterId?: string | null;
  initialMasterIds?: string[];
  initialCategoryId?: string | null;
  profileCategories: ProfileCategory[];
  jigPresets: JigPreset[];
  creditCards: CreditCard[];
  poolEmails?: PoolEmail[];
  credentials?: Credential[];
  onSaveCategory: (category: ProfileCategory) => Promise<void>;
  onGenerate: (masterIds: string[], options: GenerateFromMasterOptions) => Promise<number>;
  onSuccess?: (count: number, masterIds: string[]) => void;
}

function existingCategorySelection(categoryId?: string): CategorySelection {
  return {
    kind: "existing",
    categoryId: categoryId ?? PROFILE_UNCATEGORIZED_CATEGORY_ID,
  };
}

export function GeneratePanel({
  masterProfiles,
  initialMasterId,
  initialMasterIds,
  initialCategoryId,
  profileCategories,
  jigPresets,
  creditCards,
  poolEmails = [],
  credentials = [],
  onSaveCategory,
  onGenerate,
  onSuccess,
}: GeneratePanelProps) {
  const sortedCategories = useMemo(
    () => sortProfileCategories(profileCategories),
    [profileCategories],
  );

  const [masterIds, setMasterIds] = useState<string[]>(() => {
    const fromList = (initialMasterIds ?? []).filter(Boolean);
    if (fromList.length > 0) return fromList;
    const initial = initialMasterId ?? masterProfiles[0]?.id ?? "";
    return initial ? [initial] : [];
  });
  const [categorySelection, setCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(
      initialCategoryId ?? sortedCategories[0]?.id ?? PROFILE_UNCATEGORIZED_CATEGORY_ID,
    ),
  );
  const [count, setCount] = useState(5);
  const [nameJigPresetId, setNameJigPresetId] = useState("builtin-name-misspell");
  const [nameMisspellScope, setNameMisspellScope] = useState<NameMisspellScope>("both");
  const [streetRandomLettersEnabled, setStreetRandomLettersEnabled] = useState(false);
  const [streetRandomAffixMode, setStreetRandomAffixMode] = useState<StreetAffixMode>("both");
  const [streetRandomCharCount, setStreetRandomCharCount] = useState(3);
  const [addressJigPresetIds, setAddressJigPresetIds] = useState<string[]>(["builtin-random-unit-line"]);
  const [phoneJigLastFour, setPhoneJigLastFour] = useState(false);
  const [creditCardMode, setCreditCardMode] = useState<GenerateFromMasterOptions["creditCardMode"]>("none");
  const [creditCardId, setCreditCardId] = useState("");
  const [emailMode, setEmailMode] = useState<GenerateFromMasterOptions["emailMode"]>("none");
  const [emailId, setEmailId] = useState("");
  const [accountSite, setAccountSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const namePresets = jigPresets.filter((p) => p.nameRules.length > 0);
  const addressPresets = jigPresets.filter(
    (p) => p.addressRules.length > 0 && !isStreetRandomLetterPresetId(p.id),
  );

  const sortedNamePresets = sortJigPresets(namePresets, RECOMMENDED_NAME_JIG_IDS);
  const sortedAddressPresets = sortJigPresets(addressPresets, RECOMMENDED_ADDRESS_JIG_IDS);
  const assignableCreditCards = useMemo(() => filterAssignablePoolCards(creditCards), [creditCards]);
  const assignablePoolEmails = useMemo(() => filterAssignablePoolEmails(poolEmails), [poolEmails]);
  const extraAccountSites = useMemo(
    () => [...new Set(credentials.map((credential) => credential.site.trim()).filter(Boolean))],
    [credentials],
  );

  const selectedMasters = useMemo(
    () => masterProfiles.filter((master) => masterIds.includes(master.id)),
    [masterIds, masterProfiles],
  );
  const previewMaster = selectedMasters[0] ?? null;
  const totalCount = Math.max(0, count) * selectedMasters.length;

  const toggleMaster = (id: string) => {
    setMasterIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  useEffect(() => {
    const known = new Set(masterProfiles.map((master) => master.id));
    setMasterIds((current) => {
      const kept = current.filter((id) => known.has(id));
      if (kept.length > 0) return kept;
      const fromList = (initialMasterIds ?? []).filter((id) => known.has(id));
      if (fromList.length > 0) return fromList;
      if (initialMasterId && known.has(initialMasterId)) return [initialMasterId];
      return masterProfiles[0] ? [masterProfiles[0].id] : [];
    });
  }, [initialMasterId, initialMasterIds, masterProfiles]);

  useEffect(() => {
    if (initialCategoryId && sortedCategories.some((category) => category.id === initialCategoryId)) {
      setCategorySelection(existingCategorySelection(initialCategoryId));
      return;
    }
    if (
      categorySelection.kind === "existing" &&
      !sortedCategories.some((category) => category.id === categorySelection.categoryId) &&
      sortedCategories[0]
    ) {
      setCategorySelection(existingCategorySelection(sortedCategories[0].id));
    }
  }, [categorySelection, initialCategoryId, sortedCategories]);

  const categoryReady =
    categorySelection.kind === "existing" ||
    (categorySelection.kind === "new" && categorySelection.name.trim().length > 0);

  const selectedCategoryLocked =
    categorySelection.kind === "existing" &&
    isProfileCategoryLocked(profileCategories, categorySelection.categoryId);
  const canGenerate = Boolean(
    selectedMasters.length > 0 && categoryReady && masterProfiles.length > 0 && !selectedCategoryLocked,
  );

  const createCategory = async (name: string): Promise<ProfileCategory> => {
    const category: ProfileCategory = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      sortOrder: nextProfileCategorySortOrder(profileCategories),
    };
    await onSaveCategory(category);
    return category;
  };

  const run = async () => {
    if (selectedMasters.length === 0) {
      setStatus("Select at least one master profile.");
      return;
    }
    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(categorySelection, createCategory);
      assertProfileCategoryUnlocked(profileCategories, categoryId, "generate profiles into it");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Group is required.");
      return;
    }
    setBusy(true);
    try {
      const created = await onGenerate(
        selectedMasters.map((master) => master.id),
        {
          count,
          groupId: categoryId,
          nameJigPresetId: nameJigPresetId || undefined,
          nameMisspellScope: nameJigPresetId ? nameMisspellScope : undefined,
          streetRandomLetters: streetRandomLettersEnabled
            ? {
                enabled: true,
                affixMode: streetRandomAffixMode,
                charCount: streetRandomCharCount,
              }
            : undefined,
          addressJigPresetIds: addressJigPresetIds.length > 0 ? addressJigPresetIds : undefined,
          phoneJigLastFour: phoneJigLastFour || undefined,
          creditCardMode,
          creditCardId: creditCardMode === "selected" ? creditCardId : undefined,
          emailMode: emailMode ?? "none",
          emailId: emailMode === "selected" ? emailId : undefined,
          accountSite: accountSite.trim() || undefined,
        },
      );
      setStatus(`Created ${created} jig profile(s) in the selected group.`);
      onSuccess?.(
        created,
        selectedMasters.map((master) => master.id),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="generate-panel">
      <p className="muted generate-panel-intro">
        {selectedMasters.length === 0 ? (
          masterProfiles.length === 0
            ? "Create a master profile before generating jig children."
            : "Select at least one master profile."
        ) : selectedMasters.length === 1 ? (
          <>
            Parent <strong>{masterProfileLabel(selectedMasters[0])}</strong> · {count}{" "}
            {count === 1 ? "profile" : "profiles"} · street line 1 unique in the selected group
          </>
        ) : (
          <>
            <strong>{selectedMasters.length}</strong> masters · {count} each · {totalCount} profiles · street line 1
            unique in the selected group
          </>
        )}
      </p>

      <div className="field generate-modal-masters">
        <span className="field-heading">Master profiles</span>
        {masterProfiles.length === 0 ? (
          <p className="muted">No master profiles</p>
        ) : (
          <div className="checkbox-grid generate-master-checkboxes">
            {masterProfiles.map((master) => (
              <label key={master.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={masterIds.includes(master.id)}
                  onChange={() => toggleMaster(master.id)}
                />
                <span>{masterProfileLabel(master)}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div
        className={[
          "generate-modal-topbar",
          creditCardMode === "selected" ? "generate-modal-topbar-with-card" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Field label="Group">
          <AccountCategorySelect
            categories={sortedCategories}
            selection={categorySelection}
            onSelectionChange={setCategorySelection}
            uncategorizedCategoryId={PROFILE_UNCATEGORIZED_CATEGORY_ID}
            addOptionLabel="+ Add group"
            newPlaceholder="Enter group name"
          />
          {selectedCategoryLocked ? (
            <p className="muted">This group is locked. Unlock it or choose another.</p>
          ) : null}
        </Field>

        <Field label="Account site" hint="Optional pool account link">
          <AccountSiteSelect
            site={accountSite}
            onSiteChange={setAccountSite}
            extraSites={extraAccountSites}
            allowNone
          />
        </Field>

        <Field label="Count" hint="Per selected master">
          <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </Field>

        <Field label="Credit card assignment">
          <select
            value={creditCardMode}
            onChange={(e) => setCreditCardMode(e.target.value as GenerateFromMasterOptions["creditCardMode"])}
          >
            <option value="none">No card</option>
            <option value="random">Random ({assignableCreditCards.length})</option>
            <option value="selected">Selected</option>
          </select>
        </Field>

        {creditCardMode === "selected" ? (
          <Field label="Pool card">
            <select value={creditCardId} onChange={(e) => setCreditCardId(e.target.value)}>
              <option value="">Choose card</option>
              {assignableCreditCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.profileName}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Email assignment">
          <select
            value={emailMode ?? "none"}
            onChange={(e) => setEmailMode(e.target.value as GenerateFromMasterOptions["emailMode"])}
          >
            <option value="none">No email</option>
            <option value="random">Random ({assignablePoolEmails.length})</option>
            <option value="selected">Selected</option>
          </select>
        </Field>

        {emailMode === "selected" ? (
          <Field label="Pool email">
            <select value={emailId} onChange={(e) => setEmailId(e.target.value)}>
              <option value="">Choose email</option>
              {assignablePoolEmails.map((email) => (
                <option key={email.id} value={email.id}>
                  {email.email}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <div className="generate-modal-main">
        <div className="generate-modal-settings">
          <div className="generate-modal-jig-row">
            <div className="generate-modal-name-jigs">
              <Field label="Name jig" hint="One fat-finger typo per selected name part">
                <NameMisspellScopeField
                  enabled={Boolean(nameJigPresetId)}
                  scope={nameMisspellScope}
                  radioName="generate-name-misspell-scope"
                  onEnabledChange={(enabled) =>
                    setNameJigPresetId(enabled ? (sortedNamePresets[0]?.id ?? "builtin-name-misspell") : "")
                  }
                  onScopeChange={setNameMisspellScope}
                />
              </Field>
              <Field label="Phone jig" hint="Keeps area code and prefix; randomizes last 4">
                <PhoneLastFourJigField enabled={phoneJigLastFour} onEnabledChange={setPhoneJigLastFour} />
              </Field>
            </div>

            <Field
              label="Address jigs"
              hint="Street letters, type combo, apt/suite line 2, misspell"
              className="generate-modal-address-jigs"
            >
              <div className="address-jig-options">
                <StreetRandomLettersJigField
                  enabled={streetRandomLettersEnabled}
                  affixMode={streetRandomAffixMode}
                  charCount={streetRandomCharCount}
                  onEnabledChange={setStreetRandomLettersEnabled}
                  onAffixModeChange={setStreetRandomAffixMode}
                  onCharCountChange={setStreetRandomCharCount}
                />
                <AddressJigCheckboxList
                  nested
                  presets={sortedAddressPresets}
                  selectedIds={addressJigPresetIds}
                  onChange={setAddressJigPresetIds}
                />
              </div>
            </Field>
          </div>
        </div>

        <div className="generate-modal-preview">
          <JigAddressPreview
            master={previewMaster}
            nameJigPresetId={nameJigPresetId}
            nameMisspellScope={nameMisspellScope}
            phoneJigLastFour={phoneJigLastFour}
            streetRandomLettersEnabled={streetRandomLettersEnabled}
            streetRandomAffixMode={streetRandomAffixMode}
            streetRandomCharCount={streetRandomCharCount}
            addressJigPresetIds={addressJigPresetIds}
            jigPresets={jigPresets}
          />
          {selectedMasters.length > 1 ? (
            <p className="muted generate-multi-master-preview-note">
              Preview uses {masterProfileLabel(previewMaster!)}. Same jigs apply to every selected master.
            </p>
          ) : null}
        </div>
      </div>

      <div className="generate-modal-footer">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !canGenerate}
          aria-busy={busy}
          onClick={() => void run()}
        >
          {busy ? (
            <span className="generate-loading-label">
              Generating
              <span className="generate-loading-dots" aria-hidden="true" />
            </span>
          ) : (
            <>
              Generate {totalCount} profile{totalCount === 1 ? "" : "s"}
              {selectedMasters.length > 1 ? ` (${count} each)` : ""}
            </>
          )}
        </button>
        {status ? <p className="status-inline generate-modal-status">{status}</p> : null}
      </div>
    </section>
  );
}
