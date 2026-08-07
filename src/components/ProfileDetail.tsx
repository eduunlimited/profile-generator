import { useEffect, useState } from "react";
import { reapplyJigPreset } from "../lib/jigEngine";
import type { JigPreset, Profile } from "../lib/types";
import { CopyField, Field, Section } from "./ui";

interface ProfileDetailProps {
  profileId: string | null;
  jigPresets: JigPreset[];
  loadProfile: (id: string) => Promise<Profile>;
  onSave: (profile: Profile) => Promise<void>;
  onClose: () => void;
}

export function ProfileDetail({
  profileId,
  jigPresets,
  loadProfile,
  onSave,
  onClose,
}: ProfileDetailProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profileId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    void loadProfile(profileId)
      .then(setProfile)
      .finally(() => setLoading(false));
  }, [profileId, loadProfile]);

  if (!profileId) return null;
  if (loading || !profile) {
    return (
      <section className="card detail-card">
        <p className="muted">Loading profile...</p>
      </section>
    );
  }

  const updateField = (path: string, value: string) => {
    setProfile((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const parts = path.split(".");
      let cursor: Record<string, unknown> = next as unknown as Record<string, unknown>;
      for (let index = 0; index < parts.length - 1; index += 1) {
        cursor = cursor[parts[index]] as Record<string, unknown>;
      }
      cursor[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const applyPreset = (presetId: string) => {
    const preset = jigPresets.find((item) => item.id === presetId) ?? null;
    setProfile((current) => (current ? reapplyJigPreset(current, preset) : current));
  };

  return (
    <section className="card detail-card">
      <div className="card-header">
        <div>
          <h2>{profile.name.full}</h2>
          <p className="muted">Profile ID: {profile.id}</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onSave(profile).finally(() => setSaving(false));
            }}
          >
            Save changes
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <Section title="Identity">
          <Field label="First name">
            <input value={profile.name.first} onChange={(event) => updateField("name.first", event.target.value)} />
          </Field>
          <Field label="Last name">
            <input value={profile.name.last} onChange={(event) => updateField("name.last", event.target.value)} />
          </Field>
          <CopyField label="Full name" value={profile.name.full} />
          {profile.name.jig ? <CopyField label="Jig name" value={profile.name.jig} /> : null}
        </Section>

        <Section title="Address">
          <Field label="Street">
            <input value={profile.address.street} onChange={(event) => updateField("address.street", event.target.value)} />
          </Field>
          <Field label="Unit">
            <input value={profile.address.unit ?? ""} onChange={(event) => updateField("address.unit", event.target.value)} />
          </Field>
          <div className="form-grid">
            <Field label="City">
              <input value={profile.address.city} onChange={(event) => updateField("address.city", event.target.value)} />
            </Field>
            <Field label="State">
              <input value={profile.address.state} onChange={(event) => updateField("address.state", event.target.value)} />
            </Field>
            <Field label="Postal code">
              <input
                value={profile.address.postalCode}
                onChange={(event) => updateField("address.postalCode", event.target.value)}
              />
            </Field>
            <Field label="Country">
              <input value={profile.address.country} onChange={(event) => updateField("address.country", event.target.value)} />
            </Field>
          </div>
          {profile.address.jig ? <CopyField label="Jig address" value={profile.address.jig} /> : null}
        </Section>

        <Section title="Payment (TEST DATA)">
          <CopyField label="Card number" value={profile.payment.number} />
          <CopyField label="Expiry" value={profile.payment.expiry} />
          <CopyField label="CVV" value={profile.payment.cvv} />
          <CopyField label="Brand" value={profile.payment.brand} />
        </Section>

        <Section title="Logins">
          {profile.logins.map((login) => (
            <div key={login.id} className="nested-card">
              <CopyField label="Label" value={login.label} />
              <CopyField label="Username" value={login.username} />
              <CopyField label="Email" value={login.email} />
              <CopyField label="Password" value={login.password} />
            </div>
          ))}
        </Section>

        <Section title="Jig preset">
          <Field label="Apply preset">
            <select
              value={profile.jigPresetId ?? ""}
              onChange={(event) => applyPreset(event.target.value)}
            >
              <option value="">None</option>
              {jigPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </Field>
        </Section>
      </div>
    </section>
  );
}
