import { useState } from "react";
import {
  ADDRESS_RULE_LABELS,
  AFFIX_MODE_LABELS,
  NAME_RULE_LABELS,
} from "../lib/jigRuleLabels";
import type { AddressRule, JigPreset, NameRule, StreetAffixMode } from "../lib/types";
import { EmptyState, Field } from "./ui";

interface JigPresetsPanelProps {
  presets: JigPreset[];
  onSave: (preset: JigPreset) => Promise<void>;
}

const NAME_RULE_TYPES: NameRule["type"][] = ["nameMisspell"];

const ADDRESS_RULE_TYPES: AddressRule["type"][] = [
  "streetRandomLetters",
  "streetTypeCombo",
  "randomUnitLine",
  "addUnit",
  "addSuite",
  "misspellField",
  "splitLines",
];

function defaultNameRule(type: NameRule["type"]): NameRule {
  switch (type) {
    case "truncate":
      return { type, maxLength: 25 };
    case "appendSuffix":
      return { type, suffix: " Jr" };
    case "misspell":
    case "nameMisspell":
    case "prefixRandom":
    case "suffixRandom":
    case "insertRandomLetters":
      return { type, charCount: 2 };
    default:
      return { type };
  }
}

function defaultAddressRule(type: AddressRule["type"]): AddressRule {
  switch (type) {
    case "truncateField":
      return { type, field: "street", maxLength: 35 };
    case "addUnit":
      return { type, unitFormat: "Apt {random}" };
    case "addSuite":
      return { type, unitFormat: "Suite {random}" };
    case "misspellField":
      return { type, field: "street", charCount: 2 };
    case "streetRandomLetters":
      return { type, field: "street", charCount: 3, affixMode: "both" };
    case "prefixRandom":
    case "suffixRandom":
      return { type, field: "street", charCount: 2 };
    default:
      return { type };
  }
}

function ruleUsesCharCount(type: NameRule["type"] | AddressRule["type"]): boolean {
  return [
    "misspell",
    "nameMisspell",
    "prefixRandom",
    "suffixRandom",
    "insertRandomLetters",
    "misspellField",
    "streetRandomLetters",
  ].includes(type);
}

function emptyPreset(): JigPreset {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    nameRules: [],
    addressRules: [],
  };
}

export function JigPresetsPanel({ presets, onSave }: JigPresetsPanelProps) {
  const [draft, setDraft] = useState<JigPreset>(() => emptyPreset());
  const [busy, setBusy] = useState(false);
  const isEditing = presets.some((preset) => preset.id === draft.id);

  const startNew = () => {
    setDraft(emptyPreset());
  };

  const addNameRule = () => {
    setDraft((current) => ({
      ...current,
      nameRules: [...current.nameRules, defaultNameRule("nameMisspell")],
    }));
  };

  const addAddressRule = () => {
    setDraft((current) => ({
      ...current,
      addressRules: [...current.addressRules, defaultAddressRule("streetRandomLetters")],
    }));
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      await onSave(draft);
      startNew();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-grid jigs-panel">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Jig presets</h2>
            <p className="muted">
              Name misspellings, street type combo, street letter noise, and random apt/suite on line 2.
            </p>
          </div>
          <button type="button" className="btn-secondary btn-compact" onClick={startNew}>
            New preset
          </button>
        </div>
        {presets.length === 0 ? (
          <EmptyState title="No presets yet" description="Built-in presets seed on first launch." />
        ) : (
          <div className="preset-list">
            {presets.map((preset) => (
              <article key={preset.id} className="nested-card">
                <h3>{preset.name}</h3>
                {preset.description ? <p className="muted">{preset.description}</p> : null}
                <p>
                  {preset.nameRules.length} name rules · {preset.addressRules.length} address rules
                </p>
                <button type="button" className="ghost-button" onClick={() => setDraft(preset)}>
                  Edit
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card jigs-form-panel">
        <div className="card-header">
          <h2>{isEditing ? `Edit ${draft.name}` : "New jig preset"}</h2>
          <div className="button-row compact">
            <button type="button" className="btn-secondary btn-compact" onClick={startNew}>
              New preset
            </button>
            {isEditing ? (
              <button type="button" className="btn-secondary btn-compact" onClick={startNew}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
        <div className="form-grid">
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Description">
            <input
              value={draft.description ?? ""}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>
        </div>

        <h3 className="panel-subsection-title">Name rules</h3>
        <div className="rule-list">
          {draft.nameRules.map((rule, index) => (
            <div key={`name-${index}`} className="rule-row">
              <select
                value={rule.type}
                onChange={(event) => {
                  const nameRules = [...draft.nameRules];
                  nameRules[index] = defaultNameRule(event.target.value as NameRule["type"]);
                  setDraft({ ...draft, nameRules });
                }}
              >
                {NAME_RULE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {NAME_RULE_LABELS[type]}
                  </option>
                ))}
              </select>
              {rule.type === "truncate" ? (
                <input
                  type="number"
                  value={rule.maxLength ?? 25}
                  onChange={(event) => {
                    const nameRules = [...draft.nameRules];
                    nameRules[index] = { ...rule, maxLength: Number(event.target.value) };
                    setDraft({ ...draft, nameRules });
                  }}
                />
              ) : null}
              {rule.type === "appendSuffix" ? (
                <input
                  value={rule.suffix ?? ""}
                  placeholder="Suffix"
                  onChange={(event) => {
                    const nameRules = [...draft.nameRules];
                    nameRules[index] = { ...rule, suffix: event.target.value };
                    setDraft({ ...draft, nameRules });
                  }}
                />
              ) : null}
              {ruleUsesCharCount(rule.type) ? (
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={rule.charCount ?? 2}
                  onChange={(event) => {
                    const nameRules = [...draft.nameRules];
                    nameRules[index] = { ...rule, charCount: Number(event.target.value) };
                    setDraft({ ...draft, nameRules });
                  }}
                  title="Passes / letter count"
                />
              ) : null}
              <button
                type="button"
                className="ghost-button danger"
                onClick={() =>
                  setDraft({
                    ...draft,
                    nameRules: draft.nameRules.filter((_, ruleIndex) => ruleIndex !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="button-row">
          <button type="button" className="btn-secondary" onClick={addNameRule}>
            Add name rule
          </button>
        </div>

        <h3 className="panel-subsection-title">Address rules</h3>
        <div className="rule-list">
          {draft.addressRules.map((rule, index) => (
            <div key={`address-${index}`} className="rule-row">
              <select
                value={rule.type}
                onChange={(event) => {
                  const addressRules = [...draft.addressRules];
                  addressRules[index] = defaultAddressRule(event.target.value as AddressRule["type"]);
                  setDraft({ ...draft, addressRules });
                }}
              >
                {ADDRESS_RULE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ADDRESS_RULE_LABELS[type]}
                  </option>
                ))}
              </select>
              {rule.type === "truncateField" || rule.type === "misspellField" ? (
                <>
                  <select
                    value={rule.field ?? "street"}
                    onChange={(event) => {
                      const addressRules = [...draft.addressRules];
                      addressRules[index] = {
                        ...rule,
                        field: event.target.value as AddressRule["field"],
                      };
                      setDraft({ ...draft, addressRules });
                    }}
                  >
                    <option value="street">street</option>
                    <option value="city">city</option>
                    <option value="state">state</option>
                    <option value="postalCode">postalCode</option>
                  </select>
                  {rule.type === "truncateField" ? (
                    <input
                      type="number"
                      value={rule.maxLength ?? 35}
                      onChange={(event) => {
                        const addressRules = [...draft.addressRules];
                        addressRules[index] = { ...rule, maxLength: Number(event.target.value) };
                        setDraft({ ...draft, addressRules });
                      }}
                    />
                  ) : (
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={rule.charCount ?? 2}
                      onChange={(event) => {
                        const addressRules = [...draft.addressRules];
                        addressRules[index] = { ...rule, charCount: Number(event.target.value) };
                        setDraft({ ...draft, addressRules });
                      }}
                      title="Misspell passes"
                    />
                  )}
                </>
              ) : null}
              {rule.type === "streetRandomLetters" ? (
                <>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={rule.charCount ?? 3}
                    onChange={(event) => {
                      const addressRules = [...draft.addressRules];
                      addressRules[index] = { ...rule, charCount: Number(event.target.value) };
                      setDraft({ ...draft, addressRules });
                    }}
                    title="Letter count"
                  />
                  <select
                    value={rule.affixMode ?? "both"}
                    onChange={(event) => {
                      const addressRules = [...draft.addressRules];
                      addressRules[index] = {
                        ...rule,
                        affixMode: event.target.value as StreetAffixMode,
                      };
                      setDraft({ ...draft, addressRules });
                    }}
                  >
                    {(Object.keys(AFFIX_MODE_LABELS) as StreetAffixMode[]).map((mode) => (
                      <option key={mode} value={mode}>
                        {AFFIX_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              {rule.type === "addUnit" || rule.type === "addSuite" ? (
                <>
                  <input
                    value={rule.unitFormat ?? (rule.type === "addSuite" ? "Suite {random}" : "Apt {random}")}
                    placeholder="Apt {n} / Room {random} / 1{letter}"
                    title="Tokens: {n} or {random} (1–100), {letter} (A–Z)"
                    onChange={(event) => {
                      const addressRules = [...draft.addressRules];
                      addressRules[index] = { ...rule, unitFormat: event.target.value };
                      setDraft({ ...draft, addressRules });
                    }}
                  />
                  <span className="muted">Tokens: {"{n}"} / {"{random}"} (1–100), {"{letter}"} (A–Z)</span>
                </>
              ) : null}
              {["prefixRandom", "suffixRandom"].includes(rule.type) ? (
                <>
                  <select
                    value={rule.field ?? "street"}
                    onChange={(event) => {
                      const addressRules = [...draft.addressRules];
                      addressRules[index] = {
                        ...rule,
                        field: event.target.value as AddressRule["field"],
                      };
                      setDraft({ ...draft, addressRules });
                    }}
                  >
                    <option value="street">street</option>
                    <option value="city">city</option>
                    <option value="state">state</option>
                    <option value="postalCode">postalCode</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={rule.charCount ?? 2}
                    onChange={(event) => {
                      const addressRules = [...draft.addressRules];
                      addressRules[index] = { ...rule, charCount: Number(event.target.value) };
                      setDraft({ ...draft, addressRules });
                    }}
                  />
                </>
              ) : null}
              <button
                type="button"
                className="ghost-button danger"
                onClick={() =>
                  setDraft({
                    ...draft,
                    addressRules: draft.addressRules.filter((_, ruleIndex) => ruleIndex !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="button-row">
          <button type="button" className="btn-secondary" onClick={addAddressRule}>
            Add address rule
          </button>
        </div>

        <div className="button-row button-row-spaced">
          <button type="button" disabled={busy || !draft.name.trim()} className="btn-primary" onClick={() => void save()}>
            {isEditing ? "Save changes" : "Save preset"}
          </button>
        </div>
      </section>
    </div>
  );
}
