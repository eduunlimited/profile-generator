interface PhoneLastFourJigFieldProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export function PhoneLastFourJigField({ enabled, onEnabledChange }: PhoneLastFourJigFieldProps) {
  return (
    <div className="jig-option-block">
      <label className="checkbox-row">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
        <span>Randomize last 4 digits</span>
      </label>
      <p className="muted jig-option-hint">Unique within the selected category</p>
    </div>
  );
}
