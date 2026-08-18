import { useCallback, useEffect, useState } from "react";
import { checkForAppUpdates } from "../lib/appUpdates";
import { activateLicense, checkLicense, clearLicense, type LicenseStatus } from "../lib/license";

interface LicenseGateProps {
  children: React.ReactNode;
}

export function LicenseGate({ children }: LicenseGateProps) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await checkLicense();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not validate license.");
      setStatus({
        licensed: false,
        status: "error",
        message: "License validation failed.",
        offline: false,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status?.licensed) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.licensed]);

  const handleActivate = async () => {
    setActivating(true);
    setError(null);
    try {
      const next = await activateLicense(licenseKey);
      setStatus(next);
      if (!next.licensed) {
        setError(next.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed.");
    } finally {
      setActivating(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await clearLicense();
      setLicenseKey("");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (busy && !status) {
    return (
      <div className="license-gate">
        <div className="license-card">
          <h1>Profile Generator</h1>
          <p className="muted">Checking license…</p>
        </div>
      </div>
    );
  }

  if (status?.licensed) {
    return <>{children}</>;
  }

  return (
    <div className="license-gate">
      <div className="license-card">
        <h1>Activate Profile Generator</h1>
        <p className="muted">
          Enter the license key you received. Each key works on one machine at a time.
        </p>
        <label className="license-field">
          <span>License key</span>
          <input
            type="text"
            value={licenseKey}
            placeholder="EPGS-XXXX-XXXX-XXXX"
            onChange={(event) => setLicenseKey(event.target.value.toUpperCase())}
          />
        </label>
        {error ? <p className="text-bad">{error}</p> : null}
        {status?.message && !error ? <p className="muted">{status.message}</p> : null}
        <div className="license-actions">
          <button type="button" className="btn-primary" disabled={activating} onClick={() => void handleActivate()}>
            {activating ? "Activating…" : "Activate"}
          </button>
          <button type="button" className="btn-secondary" disabled={activating} onClick={() => void handleSignOut()}>
            Clear saved license
          </button>
        </div>
      </div>
    </div>
  );
}

export function useLicenseHeartbeat(onLocked: (status: LicenseStatus) => void) {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const next = await checkLicense();
        if (!cancelled && !next.licensed) {
          onLocked(next);
        }
      } catch {
        // Grace/offline handling lives in the Rust layer.
      }
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onLocked]);
}

export function useAppUpdateChecks() {
  useEffect(() => {
    void checkForAppUpdates({ silent: true });
    const timer = window.setInterval(() => {
      void checkForAppUpdates({ silent: true });
    }, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
}
