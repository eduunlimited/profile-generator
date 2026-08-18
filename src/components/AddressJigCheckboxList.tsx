import type { JigPreset } from "../lib/types";
import { Field } from "./ui";

interface AddressJigCheckboxListProps {
  presets: JigPreset[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  nested?: boolean;
}

export function AddressJigCheckboxList({
  presets,
  selectedIds,
  onChange,
  className,
  nested = false,
}: AddressJigCheckboxListProps) {
  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id],
    );
  };

  const list = (
    <div className="checkbox-grid">
      {presets.map((preset) => (
        <label key={preset.id} className="checkbox-row">
          <input
            type="checkbox"
            checked={selectedIds.includes(preset.id)}
            onChange={() => toggle(preset.id)}
          />
          <span>
            {preset.name}
            {preset.description ? <span className="muted"> — {preset.description}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );

  if (nested) {
    return list;
  }

  return (
    <Field
      label="Address jigs"
      hint="Select one or more — street letters, type combo, apt/suite line 2, misspell"
      className={[className, "address-jig-field"].filter(Boolean).join(" ")}
    >
      {list}
    </Field>
  );
}
