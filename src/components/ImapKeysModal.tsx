import type { ImapAccount } from "../lib/types";
import { imapAccountLabel } from "../lib/imapInbox";

interface ImapKeysModalProps {
  open: boolean;
  accounts: ImapAccount[];
  mailCounts: Record<string, number>;
  onClose: () => void;
  onAdd: () => void;
  onEdit: (account: ImapAccount) => void;
  onRemove: (account: ImapAccount) => void;
}

export function ImapKeysModal({
  open,
  accounts,
  mailCounts,
  onClose,
  onAdd,
  onEdit,
  onRemove,
}: ImapKeysModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog modal-dialog-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <strong>Edit IMAP keys</strong>
            <p className="modal-header-sub">Rename, change connection settings, or remove a mailbox.</p>
          </div>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          {accounts.length === 0 ? (
            <p className="muted">No IMAP keys yet. Add one from the sidebar.</p>
          ) : (
            <ul className="imap-key-manage-list">
              {accounts.map((account) => (
                <li key={account.id} className="imap-key-manage-row">
                  <div className="imap-key-manage-copy">
                    <strong>{imapAccountLabel(account)}</strong>
                    <span className="muted">
                      {account.username.trim() || "No username"}
                      {account.host.trim() ? ` · ${account.host.trim()}` : ""}
                      {` · ${mailCounts[account.id] ?? 0} stored`}
                    </span>
                  </div>
                  <div className="button-row compact">
                    <button type="button" className="btn-secondary btn-compact" onClick={() => onEdit(account)}>
                      Settings
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-compact ghost-button danger"
                      onClick={() => onRemove(account)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="button-row">
            <button type="button" className="btn-secondary" onClick={onAdd}>
              Add IMAP key
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
