import { useEffect, useState } from "react";
import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "../lib/profileCategoryUtils";
import type { ProfileCategory } from "../lib/types";
import { AccountCategorySelect, type CategorySelection } from "./AccountCategorySelect";
import { Field } from "./ui";

interface MoveProfilesModalProps {
  open: boolean;
  selectedCount: number;
  categories: ProfileCategory[];
  selection: CategorySelection;
  onSelectionChange: (selection: CategorySelection) => void;
  onClose: () => void;
  onMove: () => Promise<void>;
}

export function MoveProfilesModal({
  open,
  selectedCount,
  categories,
  selection,
  onSelectionChange,
  onClose,
  onMove,
}: MoveProfilesModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleMove = async () => {
    setBusy(true);
    setError(null);
    try {
      await onMove();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move profiles.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog modal-dialog-sm" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>
            Move {selectedCount} profile{selectedCount === 1 ? "" : "s"}
          </strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <p className="muted move-accounts-hint">Choose a category to move the selected profiles into.</p>
          <Field label="Category">
            <AccountCategorySelect
              categories={categories}
              selection={selection}
              onSelectionChange={onSelectionChange}
              uncategorizedCategoryId={PROFILE_UNCATEGORIZED_CATEGORY_ID}
            />
          </Field>
          {error ? <p className="status-inline">{error}</p> : null}
          <div className="button-row compact">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void handleMove()}>
              Move
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
