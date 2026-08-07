import { useState } from "react";
import { AddressJigCheckboxList } from "./AddressJigCheckboxList";
import {
  RECOMMENDED_ADDRESS_JIG_IDS,
  RECOMMENDED_NAME_JIG_IDS,
} from "../lib/jigRuleLabels";
import { sortJigPresets } from "../lib/jigPresetUtils";
import type { JigPreset, RejigProfilesOptions, RejigProfilesResult } from "../lib/types";
import { Field } from "./ui";

interface RejigPanelProps {
  selectedCount: number;
  jigPresets: JigPreset[];
  onRejig: (options: RejigProfilesOptions) => Promise<RejigProfilesResult>;
  onSuccess?: (result: RejigProfilesResult) => void;
}

export function RejigPanel({ selectedCount, jigPresets, onRejig, onSuccess }: RejigPanelProps) {
  const [nameJigPresetId, setNameJigPresetId] = useState("builtin-name-misspell");
  const [addressJigPresetIds, setAddressJigPresetIds] = useState<string[]>(["builtin-random-unit-line"]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const namePresets = jigPresets.filter((preset) => preset.nameRules.length > 0);
  const addressPresets = jigPresets.filter((preset) => preset.addressRules.length > 0);

  const sortedNamePresets = sortJigPresets(namePresets, RECOMMENDED_NAME_JIG_IDS);
  const sortedAddressPresets = sortJigPresets(addressPresets, RECOMMENDED_ADDRESS_JIG_IDS);

  const run = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onRejig({
        profileIds: [],
        nameJigPresetId: nameJigPresetId || undefined,
        addressJigPresetIds: addressJigPresetIds.length > 0 ? addressJigPresetIds : undefined,
      });
      if (result.failedCount > 0) {
        setStatus(
          `Re-jigged ${result.updatedCount} profile(s). ${result.failedCount} could not get a unique jig — try different presets.`,
        );
      } else {
        setStatus(`Re-jigged ${result.updatedCount} profile(s) with no duplicate jigs.`);
      }
      onSuccess?.(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Re-jig failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Re-jig selected profiles</h2>
          <p className="muted">
            Apply new jigs to <strong>{selectedCount}</strong> selected profile
            {selectedCount === 1 ? "" : "s"}. New jigs will not repeat any profile left unselected.
            When all profiles are selected, jigs will not repeat within the batch.
          </p>
        </div>
      </div>

      <div className="form-grid two-col">
        <Field label="Name jig" hint="Misspellings, extra letters, phonetic swaps" className="form-grid-span">
          <select value={nameJigPresetId} onChange={(event) => setNameJigPresetId(event.target.value)}>
            <option value="">None (use master name)</option>
            {sortedNamePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </Field>

        <AddressJigCheckboxList
          className="form-grid-span"
          presets={sortedAddressPresets}
          selectedIds={addressJigPresetIds}
          onChange={setAddressJigPresetIds}
        />
      </div>

      <div className="button-row compact">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || selectedCount === 0 || (!nameJigPresetId && addressJigPresetIds.length === 0)}
          onClick={() => void run()}
        >
          Re-jig {selectedCount} profile{selectedCount === 1 ? "" : "s"}
        </button>
      </div>
      {status ? <p className="status-inline">{status}</p> : null}
    </section>
  );
}
