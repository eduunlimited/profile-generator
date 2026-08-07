import { MassDistributePanel } from "./MassDistributePanel";
import type { MassDistributeOptions, MassDistributeResult } from "../lib/types";

interface MassDistributeModalProps {
  open: boolean;
  profileIds: string[];
  onClose: () => void;
  onDistribute: (options: MassDistributeOptions) => Promise<MassDistributeResult>;
  onSuccess?: (result: MassDistributeResult) => void;
}

export function MassDistributeModal({
  open,
  profileIds,
  onClose,
  onDistribute,
  onSuccess,
}: MassDistributeModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog modal-dialog-wide mass-distribute-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>Mass distribute</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <MassDistributePanel
          profileCount={profileIds.length}
          onDistribute={(options) => onDistribute({ ...options, profileIds })}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}
