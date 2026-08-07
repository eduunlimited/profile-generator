import { useEffect, useMemo, useState } from "react";
import { formatUsPhone } from "../lib/phoneUtils";
import type { MasterProfile } from "../lib/types";
import {
  getMasterProfileValidationError,
  isMasterProfileComplete,
  updateMasterField,
  withResolvedMasterProfileName,
} from "../lib/masterProfileUtils";
import { Field, Section } from "./ui";

interface MasterProfileEditorProps {
  isNew?: boolean;
  master: MasterProfile;
  onChange: (master: MasterProfile) => void;
  onSave: (master: MasterProfile) => Promise<void>;
}

export function MasterProfileEditor({ isNew = false, master, onChange, onSave }: MasterProfileEditorProps) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify(master));

  useEffect(() => {
    setSavedSnapshot(JSON.stringify(master));
    setStatus(null);
  }, [master.updatedAt]);

  const isDirty = useMemo(
    () => JSON.stringify(master) !== savedSnapshot,
    [master, savedSnapshot],
  );

  const setField = (path: string, value: string) => {
    onChange(updateMasterField(master, path, value));
    setStatus(null);
  };

  const isComplete = useMemo(() => isMasterProfileComplete(master), [master]);

  const handleSave = async () => {
    const validationError = getMasterProfileValidationError(master);
    if (validationError) {
      setStatus(validationError);
      return;
    }

    setSaving(true);
    try {
      const next = withResolvedMasterProfileName({
        ...master,
        updatedAt: new Date().toISOString(),
      });
      await onSave(next);
      onChange(next);
      setSavedSnapshot(JSON.stringify(next));
      setStatus(isNew ? "Master profile created." : "Master profile saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="profile-editor card">
      <div className="editor-header">
        <div>
          <div className="editor-title-row">
            <h2>Master Profile</h2>
            {isDirty ? <span className="pill warn">Unsaved changes</span> : null}
          </div>
          <p className="muted">
            Canonical name and address used as your base template for generated profiles.
          </p>
        </div>
        <div className="button-row compact">
          <button
            type="button"
            className="btn-secondary"
            disabled={(isNew ? false : !isDirty) || !isComplete || saving}
            onClick={() => void handleSave()}
          >
            {saving ? (isNew ? "Creating..." : "Saving...") : isNew ? "Create master" : "Save master"}
          </button>
        </div>
      </div>

      {status ? <p className="status-inline">{status}</p> : null}

      <div className="editor-body">
        <Field label="Master Profile Name">
          <input
            value={master.profileName ?? ""}
            onChange={(event) => setField("profileName", event.target.value)}
            placeholder="Checkout-A"
          />
        </Field>
        <div className="form-grid two-col">
          <Field label="First name" hint="Billing">
            <input
              value={master.name.first}
              onChange={(event) => setField("name.first", event.target.value)}
              placeholder="Jane"
            />
          </Field>
          <Field label="Last name" hint="Billing">
            <input
              value={master.name.last}
              onChange={(event) => setField("name.last", event.target.value)}
              placeholder="Doe"
            />
          </Field>
        </div>
        <div className="form-grid two-col">
          <Field label="Phone">
            <input
              value={formatUsPhone(master.phone ?? "")}
              onChange={(event) => setField("phone", event.target.value)}
              placeholder="555-010-1234"
              inputMode="tel"
            />
          </Field>
        </div>

        <Section title="Address" description="Base shipping/billing address for the master profile.">
          <Field label="Address line 1">
            <input
              value={master.address.street}
              onChange={(event) => setField("address.street", event.target.value)}
              placeholder="123 Main St"
            />
          </Field>
          <Field label="Address line 2">
            <input
              value={master.address.unit ?? ""}
              onChange={(event) => setField("address.unit", event.target.value)}
              placeholder="Apt 4B"
            />
          </Field>
          <div className="form-grid two-col">
            <Field label="City">
              <input
                value={master.address.city}
                onChange={(event) => setField("address.city", event.target.value)}
                placeholder="Springfield"
              />
            </Field>
            <Field label="State">
              <input
                value={master.address.state}
                onChange={(event) => setField("address.state", event.target.value)}
                placeholder="IL"
              />
            </Field>
            <Field label="Postal code">
              <input
                value={master.address.postalCode}
                onChange={(event) => setField("address.postalCode", event.target.value)}
                placeholder="62701"
              />
            </Field>
            <Field label="Country">
              <input
                value={master.address.country}
                onChange={(event) => setField("address.country", event.target.value)}
                placeholder="United States"
              />
            </Field>
          </div>
        </Section>
      </div>
    </section>
  );
}
