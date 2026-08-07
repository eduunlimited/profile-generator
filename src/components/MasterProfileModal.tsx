import type { MasterProfile } from "../lib/types";
import { MasterProfileEditor } from "./MasterProfileEditor";

interface MasterProfileModalProps {
  open: boolean;
  isNew?: boolean;
  master: MasterProfile;
  childCount?: number;
  onChange: (master: MasterProfile) => void;
  onSave: (master: MasterProfile) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function MasterProfileModal({
  open,
  isNew = false,
  master,
  childCount = 0,
  onChange,
  onSave,
  onDelete,
  onClose,
}: MasterProfileModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-wide master-profile-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <strong>{isNew ? "Create master profile" : "Master profile (parent)"}</strong>
            {!isNew && master.profileName?.trim() ? (
              <p className="muted modal-header-sub">{master.profileName.trim()}</p>
            ) : null}
          </div>
          <div className="button-row compact">
            {onDelete ? (
              <button
                type="button"
                className="btn-secondary ghost-button danger"
                disabled={childCount > 0}
                title={
                  childCount > 0
                    ? "Delete or reassign jig profiles before deleting this master."
                    : "Delete master profile"
                }
                onClick={() => void onDelete()}
              >
                Delete
              </button>
            ) : null}
            <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="modal-body">
          <MasterProfileEditor
            key={master.id}
            isNew={isNew}
            master={master}
            onChange={onChange}
            onSave={onSave}
          />
        </div>
      </div>
    </div>
  );
}
