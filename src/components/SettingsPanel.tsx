import { useEffect, useState } from "react";
import {
  getGeocodioSettings,
  getOpenAiSettings,
  saveGeocodioSettings,
  saveOpenAiSettings,
  testGeocodioConnection,
  testOpenAiConnection,
} from "../lib/api";
import { exportAppBackupFile, importAppBackupFile, type AppBackupSummary } from "../lib/appBackup";
import { checkForAppUpdates, isAppUpdateCheckAvailable } from "../lib/appUpdates";
import { formatError } from "../lib/errorUtils";
import { cacheOpenAiApiKey } from "../lib/openaiMisspell";
import { Field } from "./ui";

interface SettingsPanelProps {
  onGeocodioConfiguredChange?: (configured: boolean) => void;
}

type KeyStatus = { tone: "ok" | "error"; text: string } | null;

export function SettingsPanel({ onGeocodioConfiguredChange }: SettingsPanelProps) {
  const [geocodioKey, setGeocodioKey] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [geocodioBusy, setGeocodioBusy] = useState(false);
  const [openAiBusy, setOpenAiBusy] = useState(false);
  const [geocodioStatus, setGeocodioStatus] = useState<KeyStatus>(null);
  const [openAiStatus, setOpenAiStatus] = useState<KeyStatus>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<KeyStatus>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<KeyStatus>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [geocodio, openai] = await Promise.all([getGeocodioSettings(), getOpenAiSettings()]);
        if (cancelled) return;
        setGeocodioKey(geocodio.apiKey);
        setOpenAiKey(openai.apiKey);
        cacheOpenAiApiKey(openai.apiKey);
      } catch (error) {
        if (!cancelled) {
          setGeocodioStatus({ tone: "error", text: formatError(error, "Could not load API keys.") });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveGeocodio = async () => {
    setGeocodioBusy(true);
    try {
      await saveGeocodioSettings({ apiKey: geocodioKey });
      onGeocodioConfiguredChange?.(Boolean(geocodioKey.trim()));
      setGeocodioStatus({
        tone: "ok",
        text: geocodioKey.trim() ? "Geocodio API key saved." : "Geocodio API key cleared.",
      });
    } catch (error) {
      setGeocodioStatus({ tone: "error", text: formatError(error, "Could not save Geocodio API key.") });
    } finally {
      setGeocodioBusy(false);
    }
  };

  const testGeocodio = async () => {
    setGeocodioBusy(true);
    setGeocodioStatus({ tone: "ok", text: "Testing…" });
    try {
      const message = await testGeocodioConnection(geocodioKey);
      setGeocodioStatus({ tone: "ok", text: message });
    } catch (error) {
      setGeocodioStatus({ tone: "error", text: formatError(error, "Geocodio test failed.") });
    } finally {
      setGeocodioBusy(false);
    }
  };

  const saveOpenAi = async () => {
    setOpenAiBusy(true);
    try {
      await saveOpenAiSettings({ apiKey: openAiKey });
      cacheOpenAiApiKey(openAiKey);
      setOpenAiStatus({
        tone: "ok",
        text: openAiKey.trim() ? "OpenAI API key saved." : "OpenAI API key cleared.",
      });
    } catch (error) {
      setOpenAiStatus({ tone: "error", text: formatError(error, "Could not save OpenAI API key.") });
    } finally {
      setOpenAiBusy(false);
    }
  };

  const formatBackupSummary = (summary: AppBackupSummary) => {
    const keys = [
      summary.hasGeocodioKey ? "Geocodio" : null,
      summary.hasOpenAiKey ? "OpenAI" : null,
    ].filter(Boolean);
    const keyText = keys.length > 0 ? `API keys: ${keys.join(", ")}.` : "No API keys in this backup.";
    return `${summary.profiles} profiles, ${summary.cards} cards, ${summary.emails} emails, ${summary.accounts} accounts, ${summary.imapAccounts} IMAP, ${summary.proxies} proxies, ${summary.orders} orders. ${keyText}`;
  };

  const exportBackup = async () => {
    setBackupBusy(true);
    setBackupStatus({ tone: "ok", text: "Preparing backup…" });
    try {
      const summary = await exportAppBackupFile();
      if (!summary) {
        setBackupStatus({ tone: "ok", text: "Export cancelled." });
        return;
      }
      setBackupStatus({ tone: "ok", text: `Exported. ${formatBackupSummary(summary)}` });
    } catch (error) {
      setBackupStatus({ tone: "error", text: formatError(error, "Could not export backup.") });
    } finally {
      setBackupBusy(false);
    }
  };

  const importBackup = async () => {
    const confirmed = window.confirm(
      "Import replaces everything in this app — profiles, cards, emails, accounts, proxies, mail, orders, and API keys. This cannot be undone. Continue?",
    );
    if (!confirmed) return;
    setBackupBusy(true);
    setBackupStatus({ tone: "ok", text: "Importing…" });
    try {
      const summary = await importAppBackupFile();
      if (!summary) {
        setBackupStatus({ tone: "ok", text: "Import cancelled." });
        setBackupBusy(false);
        return;
      }
      setBackupStatus({ tone: "ok", text: `Imported. Reloading… ${formatBackupSummary(summary)}` });
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setBackupStatus({ tone: "error", text: formatError(error, "Could not import backup.") });
      setBackupBusy(false);
    }
  };

  const checkUpdates = async () => {
    if (!isAppUpdateCheckAvailable()) {
      setUpdateStatus({
        tone: "ok",
        text: "Update checks run in the installed desktop app, not in this browser or dev window.",
      });
      return;
    }
    setUpdateBusy(true);
    setUpdateStatus({ tone: "ok", text: "Checking…" });
    try {
      const result = await checkForAppUpdates();
      setUpdateStatus({
        tone: "ok",
        text: result.available ? "An update is available." : "You are running the latest version.",
      });
    } catch (error) {
      setUpdateStatus({ tone: "error", text: formatError(error, "Could not check for updates.") });
    } finally {
      setUpdateBusy(false);
    }
  };

  const testOpenAi = async () => {
    setOpenAiBusy(true);
    setOpenAiStatus({ tone: "ok", text: "Testing…" });
    try {
      const message = await testOpenAiConnection(openAiKey);
      setOpenAiStatus({ tone: "ok", text: message });
    } catch (error) {
      setOpenAiStatus({ tone: "error", text: formatError(error, "OpenAI test failed.") });
    } finally {
      setOpenAiBusy(false);
    }
  };

  return (
    <div className="settings-layout">
      <section className="card settings-card">
        <div className="card-header">
          <h2>API keys</h2>
        </div>
        <p className="muted">
          Keys stay on this machine. Use Backup below to copy them to another install.
        </p>

        <h3 className="subsection-title">Geocodio</h3>
        <p className="muted">
          Address verification uses Geocodio ZIP+4 exact match (not CASS/DPV). Get a free key at geocod.io.
        </p>
        <div className="form-grid">
          <Field label="Geocodio API key" className="form-grid-span">
            <input
              type="password"
              value={geocodioKey}
              onChange={(event) => setGeocodioKey(event.target.value)}
              autoComplete="new-password"
              placeholder="Paste API key"
            />
          </Field>
        </div>
        <div className="button-row">
          <button type="button" className="btn-secondary" disabled={geocodioBusy} onClick={() => void testGeocodio()}>
            Test connection
          </button>
          <button type="button" className="btn-primary" disabled={geocodioBusy} onClick={() => void saveGeocodio()}>
            {geocodioBusy ? "Saving…" : "Save"}
          </button>
        </div>
        {geocodioStatus ? (
          <p className={geocodioStatus.tone === "error" ? "is-error" : "muted"}>{geocodioStatus.text}</p>
        ) : null}

        <h3 className="subsection-title">OpenAI</h3>
        <p className="muted">
          Name and street misspell jigs use OpenAI. A key here overrides <code>OPENAI_API_KEY</code> in the
          environment.
        </p>
        <div className="form-grid">
          <Field label="OpenAI API key" className="form-grid-span">
            <input
              type="password"
              value={openAiKey}
              onChange={(event) => setOpenAiKey(event.target.value)}
              autoComplete="new-password"
              placeholder="Paste API key"
            />
          </Field>
        </div>
        <div className="button-row">
          <button type="button" className="btn-secondary" disabled={openAiBusy} onClick={() => void testOpenAi()}>
            Test connection
          </button>
          <button type="button" className="btn-primary" disabled={openAiBusy} onClick={() => void saveOpenAi()}>
            {openAiBusy ? "Saving…" : "Save"}
          </button>
        </div>
        {openAiStatus ? (
          <p className={openAiStatus.tone === "error" ? "is-error" : "muted"}>{openAiStatus.text}</p>
        ) : null}
      </section>

      <section className="card settings-card">
        <div className="card-header">
          <h2>Updates</h2>
        </div>
        <p className="muted">
          Installed copies also check on launch and every hour. Use this to look now.
        </p>
        <div className="button-row">
          <button type="button" className="btn-secondary" disabled={updateBusy} onClick={() => void checkUpdates()}>
            {updateBusy ? "Checking…" : "Check for updates"}
          </button>
        </div>
        {updateStatus ? (
          <p className={updateStatus.tone === "error" ? "is-error" : "muted"}>{updateStatus.text}</p>
        ) : null}
      </section>

      <section className="card settings-card">
        <div className="card-header">
          <h2>Backup</h2>
        </div>
        <p className="muted">
          Export or replace everything on this machine: profiles, cards, emails, accounts, proxies, mail,
          orders, analysis, jig presets, and API keys (Geocodio, OpenAI, IMAP passwords). Treat the file
          like a password vault.
        </p>
        <div className="button-row">
          <button type="button" className="btn-secondary" disabled={backupBusy} onClick={() => void exportBackup()}>
            {backupBusy ? "Working…" : "Export all"}
          </button>
          <button type="button" className="btn-primary" disabled={backupBusy} onClick={() => void importBackup()}>
            Import all
          </button>
        </div>
        {backupStatus ? (
          <p className={backupStatus.tone === "error" ? "is-error" : "muted"}>{backupStatus.text}</p>
        ) : null}
      </section>
    </div>
  );
}
