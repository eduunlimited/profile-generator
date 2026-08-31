import { Field } from "./ui";

interface GeocodioSettingsModalProps {
  open: boolean;
  apiKey: string;
  busy?: boolean;
  status?: string | null;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onTest: () => void;
  onSave: () => void;
}

export function GeocodioSettingsModal({
  open,
  apiKey,
  busy = false,
  status,
  onApiKeyChange,
  onClose,
  onTest,
  onSave,
}: GeocodioSettingsModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <strong>Address verification</strong>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <p className="muted">
            Uses Geocodio ZIP+4 exact match (not CASS/DPV). Get a free API key at geocod.io. The key is stored
            locally and is never printed.
          </p>
          <div className="form-grid">
            <Field label="Geocodio API key">
              <input
                type="password"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                autoComplete="new-password"
                placeholder="Paste API key"
              />
            </Field>
          </div>
          {status ? <p className={busy ? "muted" : undefined}>{status}</p> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onTest}>
            Test connection
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
