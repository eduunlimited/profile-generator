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
import { Field } from "./ui";

interface GeneratePanelProps {
  masterProfiles: MasterProfile[];
  initialMasterId: string | null;
  initialCategoryId?: string | null;
  profileCategories: ProfileCategory[];
  jigPresets: JigPreset[];
  creditCards: CreditCard[];
  poolEmails?: PoolEmail[];
  onSaveCategory: (category: ProfileCategory) => Promise<void>;
  onGenerate: (masterId: string, options: GenerateFromMasterOptions) => Promise<number>;
  onSuccess?: (count: number, masterId: string) => void;
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
  initialCategoryId,
  profileCategories,
  jigPresets,
  creditCards,
  poolEmails = [],
  onSaveCategory,
  onGenerate,
  onSuccess,
}: GeneratePanelProps) {
  const sortedCategories = useMemo(
    () => sortProfileCategories(profileCategories),
    [profileCategories],
  );

  const [masterId, setMasterId] = useState(
    initialMasterId ?? masterProfiles[0]?.id ?? "",
  );
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

  const selectedMaster =
    masterProfiles.find((master) => master.id === masterId) ?? masterProfiles[0] ?? null;

  useEffect(() => {
    if (initialMasterId && masterProfiles.some((master) => master.id === initialMasterId)) {
      setMasterId(initialMasterId);
      return;
    }
    if (!masterProfiles.some((master) => master.id === masterId) && masterProfiles[0]) {
      setMasterId(masterProfiles[0].id);
    }
  }, [initialMasterId, masterId, masterProfiles]);

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
  const canGenerate = Boolean(selectedMaster && categoryReady && masterProfiles.length > 0 && !selectedCategoryLocked);

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
    if (!selectedMaster) {
      setStatus("Create a master profile first.");
      return;
    }
    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(categorySelection, createCategory);
      assertProfileCategoryUnlocked(profileCategories, categoryId, "generate profiles into it");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Category is required.");
      return;
    }
    setBusy(true);
    try {
      const created = await onGenerate(selectedMaster.id, {
        count,
        categoryId,
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
      });
      setStatus(`Created ${created} jig profile(s) in the selected category.`);
      onSuccess?.(created, selectedMaster.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="generate-panel">
      <p className="muted generate-panel-intro">
        {selectedMaster ? (
          <>
            Parent <strong>{masterProfileLabel(selectedMaster)}</strong> · street line 1 must be unique within the
            selected category
          </>
        ) : (
          "Create a master profile before generating jig children."
        )}
      </p>

      <div
        className={[
          "generate-modal-topbar",
          creditCardMode === "selected" ? "generate-modal-topbar-with-card" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Field label="Master profile">
          <select
            value={masterId}
            disabled={masterProfiles.length === 0}
            onChange={(event) => setMasterId(event.target.value)}
          >
            {masterProfiles.length === 0 ? <option value="">No master profiles</option> : null}
            {masterProfiles.map((master) => (
              <option key={master.id} value={master.id}>
                {masterProfileLabel(master)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Category">
          <AccountCategorySelect
            categories={sortedCategories}
            selection={categorySelection}
            onSelectionChange={setCategorySelection}
            uncategorizedCategoryId={PROFILE_UNCATEGORIZED_CATEGORY_ID}
          />
          {selectedCategoryLocked ? (
            <p className="muted">This category is locked. Unlock it or choose another.</p>
          ) : null}
        </Field>

        <Field label="Count">
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
                <div className="jig-option-block">
                  <select value={nameJigPresetId} onChange={(e) => setNameJigPresetId(e.target.value)}>
                    <option value="">None (use master name)</option>
                    {sortedNamePresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                  <NameMisspellScopeField
                    enabled={Boolean(nameJigPresetId)}
                    scope={nameMisspellScope}
                    onScopeChange={setNameMisspellScope}
                  />
                </div>
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
            master={selectedMaster}
            nameJigPresetId={nameJigPresetId}
            nameMisspellScope={nameMisspellScope}
            phoneJigLastFour={phoneJigLastFour}
            streetRandomLettersEnabled={streetRandomLettersEnabled}
            streetRandomAffixMode={streetRandomAffixMode}
            streetRandomCharCount={streetRandomCharCount}
            addressJigPresetIds={addressJigPresetIds}
            jigPresets={jigPresets}
          />
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
            <>Generate {count} profiles</>
          )}
        </button>
        {status ? <p className="status-inline generate-modal-status">{status}</p> : null}
      </div>
    </section>
  );
}
