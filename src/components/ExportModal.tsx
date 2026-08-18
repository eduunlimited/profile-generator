import { ExportPanel } from "./ExportPanel";
import type { ExportTemplate, MasterProfile, ProfileCategory } from "../lib/types";

interface ExportModalProps {
  open: boolean;
  selectedProfileIds: string[];
  exportTemplates: ExportTemplate[];
  masterProfiles: MasterProfile[];
  profileCategories: ProfileCategory[];
  onClose: () => void;
  onSaveTemplate: (template: ExportTemplate) => Promise<void>;
  onLastAction?: (label: string) => void;
}

export function ExportModal({
  open,
  selectedProfileIds,
  exportTemplates,
  masterProfiles,
  profileCategories,
  onClose,
  onSaveTemplate,
  onLastAction,
}: ExportModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay">
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
            masterProfiles={masterProfiles}
            profileCategories={profileCategories}
            onSaveTemplate={onSaveTemplate}
            onLastAction={onLastAction}
          />
        </div>
      </div>
    </div>
  );
}
