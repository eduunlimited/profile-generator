import { useMemo, useState } from "react";
import {
  MASS_DISTRIBUTE_FIELDS,
  massDistributeFieldMeta,
  parseDistributeLines,
} from "../lib/massDistribute";
import type { AccountSite } from "../lib/profileEmailUtils";
import { ACCOUNT_SITES, DEFAULT_ACCOUNT_SITE } from "../lib/profileEmailUtils";
import type { MassDistributeField, MassDistributeOptions, MassDistributeResult } from "../lib/types";
import { Field } from "./ui";

const FIELD_GROUPS = ["Profile", "Payment", "Shipping", "Billing", "Account"] as const;

interface MassDistributePanelProps {
  profileCount: number;
  onDistribute: (options: MassDistributeOptions) => Promise<MassDistributeResult>;
  onSuccess?: (result: MassDistributeResult) => void;
}

export function MassDistributePanel({ profileCount, onDistribute, onSuccess }: MassDistributePanelProps) {
  const [field, setField] = useState<MassDistributeField>("email");
  const [accountSite, setAccountSite] = useState<AccountSite>(DEFAULT_ACCOUNT_SITE);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const lines = useMemo(() => parseDistributeLines(text), [text]);
  const selectedField = massDistributeFieldMeta(field);

  const run = async () => {
    if (profileCount === 0) {
      setStatus("Select at least one profile.");
      return;
    }
    if (lines.length === 0) {
      setStatus("Paste at least one line.");
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const result = await onDistribute({
        profileIds: [],
        lines,
        field,
        accountSite: field === "accountPassword" ? accountSite : undefined,
      });
      setStatus(result.message);
      onSuccess?.(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Distribution failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card assign-panel mass-distribute-panel">
      <p className="muted assign-panel-intro">
        Paste one value per line. Line 1 goes to the first selected profile, line 2 to the second, and so on
        (table order). Fields match the profile editor.
      </p>
      <p className="muted">
        Selected profiles: <strong>{profileCount}</strong> · Pasted lines: <strong>{lines.length}</strong>
      </p>

      <div className="form-grid two-col">
        <Field label="Distribute to">
          <select value={field} onChange={(event) => setField(event.target.value as MassDistributeField)}>
            {FIELD_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {MASS_DISTRIBUTE_FIELDS.filter((option) => option.group === group).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {field === "accountPassword" ? (
          <Field label="Account site (fallback)">
            <select value={accountSite} onChange={(event) => setAccountSite(event.target.value as AccountSite)}>
              {ACCOUNT_SITES.map((site) => (
                <option key={site} value={site}>
                  {site}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <p className="muted">{selectedField.hint}</p>

      <Field label="Paste lines">
        <textarea
          rows={12}
          className="mass-distribute-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={selectedField.placeholder}
        />
      </Field>

      {lines.length > 0 && profileCount > 0 && lines.length !== profileCount ? (
        <p className="status-inline distribute-warning">
          Line count ({lines.length}) does not match profile count ({profileCount}). Only the first{" "}
          {Math.min(lines.length, profileCount)} pair(s) will be applied.
        </p>
      ) : null}

      <div className="button-row compact">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || profileCount === 0 || lines.length === 0}
          onClick={() => void run()}
        >
          Distribute to {Math.min(profileCount, lines.length) || profileCount} profile(s)
        </button>
      </div>
      {status ? <p className="status-inline">{status}</p> : null}
    </section>
  );
}
