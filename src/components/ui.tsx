import type { MouseEvent, ReactNode } from "react";
import { copyToClipboard } from "../hooks/useAppData";

interface RowCheckboxProps {
  checked: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  "aria-label"?: string;
}

/** Controlled row checkbox — avoids native input + preventDefault fighting React state. */
export function RowCheckbox({
  checked,
  onClick,
  "aria-label": ariaLabel = "Select row",
}: RowCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`row-checkbox${checked ? " row-checkbox-checked" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
    >
      {checked ? (
        <svg className="row-checkbox-icon" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 6.2 5.1 8.8 9.5 3.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </button>
  );
}

interface CopyFieldProps {
  label: string;
  value: string;
  hint?: string;
}

export function CopyField({ label, value, hint }: CopyFieldProps) {
  return (
    <div className="field-row">
      <div className="field-label">
        {label}
        {hint ? <span className="field-hint">{hint}</span> : null}
      </div>
      <div className="field-value">{value || "—"}</div>
      <button
        type="button"
        className="ghost-button"
        onClick={() => void copyToClipboard(value)}
        disabled={!value}
      >
        Copy
      </button>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, className, children }: FieldProps) {
  return (
    <label className={className ? `field ${className}` : "field"}>
      <span className="field-heading">
        {label}
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-heading">
        <h3>{title}</h3>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function CompareBlock({
  label,
  base,
  jig,
}: {
  label: string;
  base: string;
  jig?: string;
}) {
  if (!jig || jig === base) {
    return <CopyField label={label} value={base} />;
  }

  return (
    <div className="compare-block">
      <div className="compare-heading">{label}</div>
      <div className="compare-columns">
        <div className="compare-column">
          <span className="compare-tag">Base</span>
          <div className="compare-value">{base || "—"}</div>
        </div>
        <div className="compare-column jig">
          <span className="compare-tag">Jig</span>
          <div className="compare-value">{jig}</div>
        </div>
      </div>
      <div className="compare-actions">
        <button type="button" className="ghost-button" onClick={() => void copyToClipboard(base)}>
          Copy base
        </button>
        <button type="button" className="ghost-button" onClick={() => void copyToClipboard(jig)}>
          Copy jig
        </button>
      </div>
    </div>
  );
}
