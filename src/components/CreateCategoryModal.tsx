import { useEffect, useState } from "react";
import { Field } from "./ui";

interface CreateCategoryModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

export function CreateCategoryModal({ open, onClose, onSave }: CreateCategoryModalProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Category name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save category.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog modal-dialog-sm" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>Create category</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <Field label="Category name">
            <input
              value={name}
              autoFocus
              placeholder="Target Good Accounts"
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSave();
              }}
            />
          </Field>
          {error ? <p className="status-inline">{error}</p> : null}
          <div className="button-row compact">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void handleSave()}>
              Save
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
