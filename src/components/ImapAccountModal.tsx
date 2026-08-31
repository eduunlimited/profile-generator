import type { ImapAccount } from "../lib/types";
import { Field } from "./ui";

interface ImapAccountModalProps {
  open: boolean;
  title: string;
  account: ImapAccount | null;
  busy?: boolean;
  status?: string | null;
  onClose: () => void;
  onChange: (account: ImapAccount) => void;
  onTest: () => void;
  onSave: () => void;
}

export function ImapAccountModal({
  open,
  title,
  account,
  busy = false,
  status,
  onClose,
  onChange,
  onTest,
  onSave,
}: ImapAccountModalProps) {
  if (!open || !account) return null;
  const draft = account;

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>{title}</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <Field label="Name" hint="Shown in the Mail sidebar">
              <input
                value={draft.name}
                onChange={(event) => onChange({ ...draft, name: event.target.value })}
                placeholder="Catch-all"
                autoComplete="off"
              />
            </Field>
            <Field label="Host" hint="imap.gmail.com or mail.yourdomain.com">
              <input
                value={draft.host}
                onChange={(event) => onChange({ ...draft, host: event.target.value })}
                placeholder="imap.example.com"
                autoComplete="off"
              />
            </Field>
            <Field label="Port">
              <input
                type="number"
                min={1}
                max={65535}
                value={draft.port}
                onChange={(event) => onChange({ ...draft, port: Number(event.target.value) || 993 })}
              />
            </Field>
            <Field label="Username" hint="Catch-all mailbox address">
              <input
                value={draft.username}
                onChange={(event) => onChange({ ...draft, username: event.target.value })}
                placeholder="catch-all@example.com"
                autoComplete="off"
              />
            </Field>
            <Field label="IMAP key / password" hint="App password if the provider requires one">
              <input
                type="password"
                value={draft.password}
                onChange={(event) => onChange({ ...draft, password: event.target.value })}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Mailbox">
              <input
                value={draft.mailbox}
                onChange={(event) => onChange({ ...draft, mailbox: event.target.value })}
                placeholder="INBOX"
              />
            </Field>
          </div>
          {status ? <p className="status-banner">{status}</p> : null}
          <div className="button-row">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={onTest}>
              Test connection
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={onSave}>
              {title.startsWith("Edit") ? "Save" : "Save and load"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
