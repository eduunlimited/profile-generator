import { useEffect, useState } from "react";
import { AddressJigCheckboxList } from "./AddressJigCheckboxList";
import {
  RECOMMENDED_ADDRESS_JIG_IDS,
  RECOMMENDED_NAME_JIG_IDS,
} from "../lib/jigRuleLabels";
import { sortJigPresets } from "../lib/jigPresetUtils";
import type {
  CreditCard,
  GenerateFromMasterOptions,
  JigPreset,
  MasterProfile,
} from "../lib/types";
import { masterProfileLabel } from "../lib/masterProfileUtils";
import { Field } from "./ui";

interface GeneratePanelProps {
  masterProfiles: MasterProfile[];
  initialMasterId: string | null;
  jigPresets: JigPreset[];
  creditCards: CreditCard[];
  onGenerate: (masterId: string, options: GenerateFromMasterOptions) => Promise<number>;
  onSuccess?: (count: number, masterId: string) => void;
}

export function GeneratePanel({
  masterProfiles,
  initialMasterId,
  jigPresets,
  creditCards,
  onGenerate,
  onSuccess,
}: GeneratePanelProps) {
  const [masterId, setMasterId] = useState(
    initialMasterId ?? masterProfiles[0]?.id ?? "",
  );
  const [count, setCount] = useState(5);
  const [nameJigPresetId, setNameJigPresetId] = useState("builtin-name-misspell");
  const [addressJigPresetIds, setAddressJigPresetIds] = useState<string[]>(["builtin-random-unit-line"]);
  const [creditCardMode, setCreditCardMode] = useState<GenerateFromMasterOptions["creditCardMode"]>("random");
  const [creditCardId, setCreditCardId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const namePresets = jigPresets.filter((p) => p.nameRules.length > 0);
  const addressPresets = jigPresets.filter((p) => p.addressRules.length > 0);

  const sortedNamePresets = sortJigPresets(namePresets, RECOMMENDED_NAME_JIG_IDS);
  const sortedAddressPresets = sortJigPresets(addressPresets, RECOMMENDED_ADDRESS_JIG_IDS);

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

  const run = async () => {
    if (!selectedMaster) {
      setStatus("Create a master profile first.");
      return;
    }
    setBusy(true);
    try {
      const created = await onGenerate(selectedMaster.id, {
        count,
        nameJigPresetId: nameJigPresetId || undefined,
        addressJigPresetIds: addressJigPresetIds.length > 0 ? addressJigPresetIds : undefined,
        creditCardMode,
        creditCardId: creditCardMode === "selected" ? creditCardId : undefined,
      });
      setStatus(`Created ${created} jig profile(s) linked to master.`);
      onSuccess?.(created, selectedMaster.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Generate jig profiles</h2>
          <p className="muted">
            {selectedMaster ? (
              <>
                Parent: <strong>{masterProfileLabel(selectedMaster)}</strong> — child profiles will be linked to
                this master. Set each profile&apos;s account site to link it to a pool account when emails match.
              </>
            ) : (
              "Create a master profile before generating jig children."
            )}
          </p>
        </div>
      </div>

      <div className="form-grid two-col">
        {masterProfiles.length > 1 ? (
          <Field label="Master profile" className="form-grid-span">
            <select value={masterId} onChange={(event) => setMasterId(event.target.value)}>
              {masterProfiles.map((master) => (
                <option key={master.id} value={master.id}>
                  {masterProfileLabel(master)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="How many profiles?">
          <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </Field>

        <Field label="Name jig" hint="Misspellings, extra letters, phonetic swaps">
          <select value={nameJigPresetId} onChange={(e) => setNameJigPresetId(e.target.value)}>
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

        <Field label="Credit card assignment">
          <select value={creditCardMode} onChange={(e) => setCreditCardMode(e.target.value as GenerateFromMasterOptions["creditCardMode"])}>
            <option value="none">No card / synthetic fallback</option>
            <option value="random">Random from pool ({creditCards.length})</option>
            <option value="selected">Selected card</option>
          </select>
        </Field>

        {creditCardMode === "selected" ? (
          <Field label="Select card">
            <select value={creditCardId} onChange={(e) => setCreditCardId(e.target.value)}>
              <option value="">Choose card</option>
              {creditCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.profileName}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <div className="button-row compact">
        <button type="button" className="btn-primary" disabled={busy || !selectedMaster} onClick={() => void run()}>
          Generate {count} profiles
        </button>
      </div>
      {status ? <p className="status-inline">{status}</p> : null}
    </section>
  );
}
