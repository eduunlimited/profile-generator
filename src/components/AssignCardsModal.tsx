import { AssignCardsPanel } from "./AssignCardsPanel";
import type { AssignCardsOptions, CreditCard, MasterProfile, ProfileSummary } from "../lib/types";

interface AssignCardsModalProps {
  open: boolean;
  cards: CreditCard[];
  profiles: ProfileSummary[];
  masterProfiles: MasterProfile[];
  lockedProfileIds?: string[];
  lockedCreditCardIds?: string[];
  onClose: () => void;
  onAssign: (options: AssignCardsOptions) => Promise<number>;
  onSuccess?: (count: number) => void;
}

export function AssignCardsModal({
  open,
  cards,
  profiles,
  masterProfiles,
  lockedProfileIds,
  lockedCreditCardIds,
  onClose,
  onAssign,
  onSuccess,
}: AssignCardsModalProps) {
  if (!open) return null;

  const bulkCards =
    Boolean(lockedProfileIds?.length && !lockedCreditCardIds?.length) ||
    (lockedCreditCardIds?.length ?? 0) > 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog modal-dialog-assign" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>{bulkCards ? "Assign cards" : "Assign card"}</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <AssignCardsPanel
          cards={cards}
          profiles={profiles}
          masterProfiles={masterProfiles}
          lockedProfileIds={lockedProfileIds}
          lockedCreditCardIds={lockedCreditCardIds}
          onAssign={onAssign}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}
