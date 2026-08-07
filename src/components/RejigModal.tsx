import { RejigPanel } from "./RejigPanel";
import type { JigPreset, RejigProfilesOptions, RejigProfilesResult } from "../lib/types";

interface RejigModalProps {
  open: boolean;
  profileIds: string[];
  jigPresets: JigPreset[];
  onClose: () => void;
  onRejig: (options: RejigProfilesOptions) => Promise<RejigProfilesResult>;
  onSuccess?: (result: RejigProfilesResult) => void;
}

export function RejigModal({ open, profileIds, jigPresets, onClose, onRejig, onSuccess }: RejigModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>Re-jig profiles</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <RejigPanel
          selectedCount={profileIds.length}
          jigPresets={jigPresets}
          onRejig={(options) => onRejig({ ...options, profileIds })}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}
