import { ExportPanel } from "./ExportPanel";
import type { ExportTemplate } from "../lib/types";

interface ExportModalProps {
  open: boolean;
  selectedProfileIds: string[];
  exportTemplates: ExportTemplate[];
  onClose: () => void;
  onSaveTemplate: (template: ExportTemplate) => Promise<void>;
}

export function ExportModal({
  open,
  selectedProfileIds,
  exportTemplates,
  onClose,
  onSaveTemplate,
}: ExportModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog export-form-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <strong>Export profiles</strong>
            <p className="modal-header-sub">
              {selectedProfileIds.length} profile{selectedProfileIds.length === 1 ? "" : "s"} selected
            </p>
          </div>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body export-modal-body">
          <ExportPanel
            selectedProfileIds={selectedProfileIds}
            exportTemplates={exportTemplates}
            onSaveTemplate={onSaveTemplate}
          />
        </div>
      </div>
    </div>
  );
}
