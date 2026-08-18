import { NAME_MISSPELL_SCOPE_LABELS, NAME_MISSPELL_SCOPE_OPTIONS } from "../lib/jigRuleLabels";
import type { NameMisspellScope } from "../lib/types";

interface NameMisspellScopeFieldProps {
  enabled: boolean;
  scope: NameMisspellScope;
  onScopeChange: (scope: NameMisspellScope) => void;
}

export function NameMisspellScopeField({ enabled, scope, onScopeChange }: NameMisspellScopeFieldProps) {
  if (!enabled) {
    return null;
  }

  return (
    <div className="jig-option-nested">
      <span className="jig-count-label">Misspell scope</span>
      <div className="jig-affix-options">
        {NAME_MISSPELL_SCOPE_OPTIONS.map((option) => (
          <label key={option} className="checkbox-row jig-sub-option">
            <input
              type="radio"
              name="name-misspell-scope"
              checked={scope === option}
              onChange={() => onScopeChange(option)}
            />
            <span>{NAME_MISSPELL_SCOPE_LABELS[option]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
