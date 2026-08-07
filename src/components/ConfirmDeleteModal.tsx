interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDeleteModal({
  open,
  title,
  message,
  confirmLabel = "Delete",
  busy = false,
  onClose,
  onConfirm,
}: ConfirmDeleteModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-sm confirm-delete-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <strong>{title}</strong>
        </div>
        <div className="modal-body">
          <p className="confirm-delete-message">{message}</p>
          <div className="button-row compact">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary confirm-delete-btn"
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
