import type { ReactNode } from "react";

interface GeneratePoolPickerProps {
  open: boolean;
  title: string;
  hint: string;
  selectedCount: number;
  totalCount: number;
  onClose: () => void;
  children: ReactNode;
}

export function GeneratePoolPicker({
  open,
  title,
  hint,
  selectedCount,
  totalCount,
  onClose,
  children,
}: GeneratePoolPickerProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay modal-overlay-nested" onClick={onClose}>
      <div className="modal-dialog modal-dialog-assign" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>{title}</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <section className="card assign-panel">
          <div className="assign-panel-body">
            <p className="muted assign-panel-intro">{hint}</p>
            <div className="assign-cards-header">
              <h3 className="subsection-title">
                {totalCount === 0
                  ? "Set a profile count first"
                  : selectedCount < totalCount
                    ? `Choose for profile ${selectedCount + 1}`
                    : "Selected"}
              </h3>
              <span className={`assign-selection-count${selectedCount === totalCount && totalCount > 0 ? " assign-selection-count-ready" : ""}`}>
                {selectedCount}/{totalCount} selected
              </span>
            </div>
            {children}
          </div>
          <div className="assign-panel-footer">
            <div className="button-row compact">
              <button type="button" className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
