import { useEffect, useState } from "react";
import {
  getGeocodioSettings,
  getOpenAiSettings,
  getOrdersApiSettings,
  saveGeocodioSettings,
  saveOpenAiSettings,
  saveOrdersApiSettings,
  testGeocodioConnection,
  testOpenAiConnection,
} from "../lib/api";
import { createOrdersApiToken, ORDERS_API_BASE } from "../lib/ordersApi";
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
  const [ordersApiEnabled, setOrdersApiEnabled] = useState(false);
  const [ordersApiToken, setOrdersApiToken] = useState("");
  const [ordersApiBusy, setOrdersApiBusy] = useState(false);
  const [ordersApiStatus, setOrdersApiStatus] = useState<KeyStatus>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [geocodio, openai, ordersApi] = await Promise.all([
          getGeocodioSettings(),
          getOpenAiSettings(),
          getOrdersApiSettings(),
        ]);
        if (cancelled) return;
        setGeocodioKey(geocodio.apiKey);
        setOpenAiKey(openai.apiKey);
        cacheOpenAiApiKey(openai.apiKey);
        setOrdersApiEnabled(ordersApi.enabled);
        setOrdersApiToken(ordersApi.token);
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

  const saveOrdersApi = async () => {
    const token = ordersApiToken.trim() || (ordersApiEnabled ? createOrdersApiToken() : "");
    setOrdersApiBusy(true);
    try {
      await saveOrdersApiSettings({ enabled: ordersApiEnabled, token });
      setOrdersApiToken(token);
      setOrdersApiStatus({
        tone: "ok",
        text: ordersApiEnabled ? "Orders API saved. It is listening on this computer only." : "Orders API turned off.",
      });
    } catch (error) {
      setOrdersApiStatus({ tone: "error", text: formatError(error, "Could not save the Orders API.") });
    } finally {
      setOrdersApiBusy(false);
    }
  };

  const testOrdersApi = async () => {
    const token = ordersApiToken.trim();
    if (!ordersApiEnabled || !token) {
      setOrdersApiStatus({ tone: "error", text: "Turn the API on, save a token, then test again." });
      return;
    }
    setOrdersApiBusy(true);
    setOrdersApiStatus({ tone: "ok", text: "Testing…" });
    try {
      const response = await fetch(`${ORDERS_API_BASE}/api/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => null)) as { count?: number; error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error || `Orders API returned ${response.status}.`);
      }
      setOrdersApiStatus({
        tone: "ok",
        text: `Connected. ${body?.count ?? 0} order(s) available.`,
      });
    } catch (error) {
      setOrdersApiStatus({ tone: "error", text: formatError(error, "Orders API test failed.") });
    } finally {
      setOrdersApiBusy(false);
    }
  };

  const copyOrdersApiExample = async () => {
    const token = ordersApiToken.trim() || "YOUR_TOKEN";
    const example = `curl -H "Authorization: Bearer ${token}" "${ORDERS_API_BASE}/api/orders"`;
    try {
      await navigator.clipboard.writeText(example);
      setOrdersApiStatus({ tone: "ok", text: "Copied the example request." });
    } catch (error) {
      setOrdersApiStatus({ tone: "error", text: formatError(error, "Could not copy the example.") });
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
          <h2>Orders API</h2>
        </div>
        <p className="muted">
          Other programs on this computer can read recorded orders while the app is open. The API listens
          only on {ORDERS_API_BASE}. Deleted Placed orders stay excluded.
        </p>
        <label className="orders-api-enable">
          <input
            type="checkbox"
            checked={ordersApiEnabled}
            onChange={(event) => setOrdersApiEnabled(event.target.checked)}
          />
          <span>Enable orders export</span>
        </label>
        <div className="form-grid">
          <Field label="API token" className="form-grid-span">
            <input
              type="text"
              value={ordersApiToken}
              onChange={(event) => setOrdersApiToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Save to generate a token"
            />
          </Field>
        </div>
        <p className="muted orders-api-example">
          GET /api/orders?status=placed&retailer=target&since=2026-10-01T00:00:00Z
          <br />
          Authorization: Bearer token
        </p>
        <div className="button-row">
          <button type="button" className="btn-secondary" disabled={ordersApiBusy} onClick={() => void testOrdersApi()}>
            Test connection
          </button>
          <button type="button" className="btn-secondary" disabled={ordersApiBusy} onClick={() => void copyOrdersApiExample()}>
            Copy example
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={ordersApiBusy}
            onClick={() => {
              setOrdersApiToken(createOrdersApiToken());
              setOrdersApiStatus({ tone: "ok", text: "New token ready. Save to start using it." });
            }}
          >
            New token
          </button>
          <button type="button" className="btn-primary" disabled={ordersApiBusy} onClick={() => void saveOrdersApi()}>
            {ordersApiBusy ? "Saving…" : "Save"}
          </button>
        </div>
        {ordersApiStatus ? (
          <p className={ordersApiStatus.tone === "error" ? "is-error" : "muted"}>{ordersApiStatus.text}</p>
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
