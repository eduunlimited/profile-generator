import { AFFIX_MODE_LABELS } from "../lib/jigRuleLabels";
import type { StreetAffixMode } from "../lib/types";

interface StreetRandomLettersJigFieldProps {
  enabled: boolean;
  affixMode: StreetAffixMode;
  charCount: number;
  onEnabledChange: (enabled: boolean) => void;
  onAffixModeChange: (mode: StreetAffixMode) => void;
  onCharCountChange: (count: number) => void;
}

export function StreetRandomLettersJigField({
  enabled,
  affixMode,
  charCount,
  onEnabledChange,
  onAffixModeChange,
  onCharCountChange,
}: StreetRandomLettersJigFieldProps) {
  return (
    <div className="jig-option-block">
      <label className="checkbox-row">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
        <span>Street random letters</span>
      </label>
      <div className={["jig-option-nested", enabled ? "" : "is-disabled"].filter(Boolean).join(" ")}>
        <div className="jig-affix-options">
          {(Object.keys(AFFIX_MODE_LABELS) as StreetAffixMode[]).map((mode) => (
            <label key={mode} className="checkbox-row jig-sub-option">
              <input
                type="radio"
                name="street-random-affix"
                checked={affixMode === mode}
                disabled={!enabled}
                onChange={() => onAffixModeChange(mode)}
              />
              <span>{AFFIX_MODE_LABELS[mode]}</span>
            </label>
          ))}
        </div>
        <label className="jig-count-field">
          <span className="jig-count-label">Character count</span>
          <input
            type="number"
            min={1}
            max={8}
            value={charCount}
            disabled={!enabled}
            onChange={(event) => onCharCountChange(Number(event.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
