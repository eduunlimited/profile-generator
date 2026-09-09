import { NAME_MISSPELL_SCOPE_LABELS, NAME_MISSPELL_SCOPE_OPTIONS } from "../lib/jigRuleLabels";
import type { NameMisspellScope } from "../lib/types";

interface NameMisspellScopeFieldProps {
  enabled: boolean;
  scope: NameMisspellScope;
  onEnabledChange: (enabled: boolean) => void;
  onScopeChange: (scope: NameMisspellScope) => void;
  radioName?: string;
}

export function NameMisspellScopeField({
  enabled,
  scope,
  onEnabledChange,
  onScopeChange,
  radioName = "name-misspell-scope",
}: NameMisspellScopeFieldProps) {
  return (
    <div className="jig-option-block">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <span>Name misspell</span>
      </label>
      <div className={["jig-option-nested", enabled ? "" : "is-disabled"].filter(Boolean).join(" ")}>
        <div className="jig-affix-options">
          {NAME_MISSPELL_SCOPE_OPTIONS.map((option) => (
            <label key={option} className="checkbox-row jig-sub-option">
              <input
                type="radio"
                name={radioName}
                checked={scope === option}
                disabled={!enabled}
                onChange={() => onScopeChange(option)}
              />
              <span>{NAME_MISSPELL_SCOPE_LABELS[option]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
