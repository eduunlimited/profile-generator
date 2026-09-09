import { useMemo, useState } from "react";
import { AddressJigCheckboxList } from "./AddressJigCheckboxList";
import { PhoneLastFourJigField } from "./PhoneLastFourJigField";
import { NameMisspellScopeField } from "./NameMisspellScopeField";
import { StreetRandomLettersJigField } from "./StreetRandomLettersJigField";
import { JigAddressPreview } from "./JigAddressPreview";
import {
  RECOMMENDED_ADDRESS_JIG_IDS,
  RECOMMENDED_NAME_JIG_IDS,
} from "../lib/jigRuleLabels";
import { isStreetRandomLetterPresetId, sortJigPresets } from "../lib/jigPresetUtils";
import type {
  JigPreset,
  MasterProfile,
  NameMisspellScope,
  ProfileSummary,
  RejigProfilesOptions,
  RejigProfilesResult,
  StreetAffixMode,
} from "../lib/types";
import type { JigPreviewBase } from "./JigAddressPreview";
import { Field } from "./ui";

interface RejigPanelProps {
  selectedProfiles: ProfileSummary[];
  masterProfiles: MasterProfile[];
  jigPresets: JigPreset[];
  geocodioConfigured?: boolean;
  addressJobStatus?: string | null;
  onRejig: (options: RejigProfilesOptions) => Promise<RejigProfilesResult>;
  onSuccess?: (result: RejigProfilesResult) => void;
}

export function RejigPanel({
  selectedProfiles,
  masterProfiles,
  jigPresets,
  geocodioConfigured = false,
  addressJobStatus = null,
  onRejig,
  onSuccess,
}: RejigPanelProps) {
  const [nameJigPresetId, setNameJigPresetId] = useState("");
  const [nameMisspellScope, setNameMisspellScope] = useState<NameMisspellScope>("both");
  const [streetRandomLettersEnabled, setStreetRandomLettersEnabled] = useState(false);
  const [streetRandomAffixMode, setStreetRandomAffixMode] = useState<StreetAffixMode>("both");
  const [streetRandomCharCount, setStreetRandomCharCount] = useState(3);
  const [addressJigPresetIds, setAddressJigPresetIds] = useState<string[]>([]);
  const [phoneJigLastFour, setPhoneJigLastFour] = useState(false);
  const [untilPass, setUntilPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const namePresets = jigPresets.filter((preset) => preset.nameRules.length > 0);
  const addressPresets = jigPresets.filter(
    (preset) => preset.addressRules.length > 0 && !isStreetRandomLetterPresetId(preset.id),
  );

  const sortedNamePresets = sortJigPresets(namePresets, RECOMMENDED_NAME_JIG_IDS);
  const sortedAddressPresets = sortJigPresets(addressPresets, RECOMMENDED_ADDRESS_JIG_IDS);

  const selectedCount = selectedProfiles.length;

  const previewMaster = useMemo(() => {
    const masterId = selectedProfiles.find((profile) => profile.masterProfileId)?.masterProfileId;
    if (masterId) {
      return masterProfiles.find((master) => master.id === masterId) ?? null;
    }
    return masterProfiles[0] ?? null;
  }, [masterProfiles, selectedProfiles]);

  const previewBase = useMemo((): JigPreviewBase | null => {
    const summary = selectedProfiles[0];
    if (!summary || !previewMaster) return null;
    const tokens = summary.billingFullName.trim().split(/\s+/).filter(Boolean);
    const first = tokens[0] || previewMaster.name.first;
    const last = tokens.slice(1).join(" ") || previewMaster.name.last;
    return {
      name: {
        first,
        last,
        full: summary.billingFullName.trim() || `${first} ${last}`.trim(),
      },
      address: {
        street: summary.billingAddressLine1,
        unit: summary.billingAddressLine2.trim() || undefined,
        city: summary.city,
        state: summary.state,
        postalCode: summary.postalCode ?? "",
        country: previewMaster.address.country,
      },
      phone: summary.billingPhone || previewMaster.phone,
    };
  }, [previewMaster, selectedProfiles]);

  const hasAddressJigSelected = streetRandomLettersEnabled || addressJigPresetIds.length > 0;
  const hasSelectedJig = Boolean(nameJigPresetId) || phoneJigLastFour || hasAddressJigSelected;
  const canRejig = selectedCount > 0 && selectedProfiles.every((profile) => profile.masterProfileId);
  const canSubmit = canRejig && hasSelectedJig;

  const run = async () => {
    if (!canRejig) {
      setStatus("Selected profiles must be linked to a master profile.");
      return;
    }
    if (!hasSelectedJig) {
      setStatus("Select at least one jig to re-jig.");
      return;
    }
    if (untilPass && geocodioConfigured && !hasAddressJigSelected) {
      setStatus("Select at least one address jig to re-jig until pass.");
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const result = await onRejig({
        profileIds: selectedProfiles.map((profile) => profile.id),
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
        untilPass: untilPass && geocodioConfigured,
      });

      if (result.message) {
        setStatus(result.message);
      } else if (result.failedCount > 0) {
        setStatus(
          `Re-jigged ${result.updatedCount} profile(s). ${result.failedCount} could not get a street line 1 under the 3-per-category limit.`,
        );
      } else {
        setStatus(`Re-jigged ${result.updatedCount} profile(s).`);
      }
      onSuccess?.(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Re-jig failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="generate-panel">
      <p className="muted generate-panel-intro">
        {canRejig ? (
          <>
            Re-jig <strong>{selectedCount}</strong> profile{selectedCount === 1 ? "" : "s"}
          </>
        ) : (
          "Selected profiles must be linked to a master profile to re-jig."
        )}
      </p>

      <div className="generate-modal-main">
        <div className="generate-modal-settings">
          <div className="generate-modal-jig-row">
            <div className="generate-modal-name-jigs">
              <Field label="Name jig" hint="One fat-finger typo per selected name part">
                <NameMisspellScopeField
                  enabled={Boolean(nameJigPresetId)}
                  scope={nameMisspellScope}
                  radioName="rejig-name-misspell-scope"
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
            base={previewBase}
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
        <div className="jig-option-block">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={untilPass && geocodioConfigured && hasAddressJigSelected}
              disabled={!geocodioConfigured || !hasAddressJigSelected || busy}
              onChange={(event) => setUntilPass(event.target.checked)}
            />
            <span>Re-jig until pass</span>
          </label>
          <p className="muted jig-option-hint">
            {!geocodioConfigured
              ? "Set a Geocodio API key in Settings first"
              : !hasAddressJigSelected
                ? "Select an address jig to re-jig until pass"
                : "Keeps re-jigging Fail/Warn addresses up to 5 times until Geocodio Pass"}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !canSubmit}
          aria-busy={busy}
          onClick={() => void run()}
        >
          {busy ? (
            <span className="generate-loading-label">
              {untilPass && geocodioConfigured ? "Re-jigging until Pass" : "Re-jigging"}
              <span className="generate-loading-dots" aria-hidden="true" />
            </span>
          ) : (
            <>Re-jig {selectedCount} profile{selectedCount === 1 ? "" : "s"}</>
          )}
        </button>
        {busy && addressJobStatus ? (
          <p className="status-inline generate-modal-status">{addressJobStatus}</p>
        ) : status ? (
          <p className="status-inline generate-modal-status">{status}</p>
        ) : null}
      </div>
    </section>
  );
}
