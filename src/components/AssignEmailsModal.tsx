import { AssignEmailsPanel } from "./AssignEmailsPanel";
import type { AssignEmailsOptions, EmailCategory, MasterProfile, PoolEmail, ProfileSummary } from "../lib/types";

interface AssignEmailsModalProps {
  open: boolean;
  emails: PoolEmail[];
  emailCategories: EmailCategory[];
  profiles: ProfileSummary[];
  masterProfiles: MasterProfile[];
  lockedProfileIds?: string[];
  lockedEmailIds?: string[];
  onClose: () => void;
  onAssign: (options: AssignEmailsOptions) => Promise<number>;
  onSuccess?: (count: number) => void;
}

export function AssignEmailsModal({
  open,
  emails,
  emailCategories,
  profiles,
  masterProfiles,
  lockedProfileIds,
  lockedEmailIds,
  onClose,
  onAssign,
  onSuccess,
}: AssignEmailsModalProps) {
  if (!open) return null;

  const bulkEmails =
    Boolean(lockedProfileIds?.length && !lockedEmailIds?.length) || (lockedEmailIds?.length ?? 0) > 1;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog modal-dialog-assign" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>{bulkEmails ? "Assign emails" : "Assign email"}</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <AssignEmailsPanel
          emails={emails}
          emailCategories={emailCategories}
          profiles={profiles}
          masterProfiles={masterProfiles}
          lockedProfileIds={lockedProfileIds}
          lockedEmailIds={lockedEmailIds}
          onAssign={onAssign}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}
