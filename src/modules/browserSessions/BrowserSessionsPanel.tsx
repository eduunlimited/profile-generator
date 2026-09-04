import { useEffect, useMemo, useState } from "react";
import { formatInvokeError } from "../../lib/formatInvokeError";
import type { Credential, ProfileSummary } from "../../lib/types";
import { useResizableTableColumns } from "../../hooks/useResizableTableColumns";
import { ResizableTh, TableColGroup } from "../../components/ResizableTable";
import { formatLinkedProfilesForAccount } from "./accountSessions";
import { formatProxyLabel } from "./proxyPool";
import { ProxyPoolModal } from "./ProxyPoolModal";
import { useBrowserSessions } from "./useBrowserSessions";

interface BrowserSessionsPanelProps {
  credentials: Credential[];
  profiles: ProfileSummary[];
}

const SESSION_TABLE_COLUMNS = ["site", "username", "profile", "proxy", "session"] as const;

function ProxyRefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 0 1-9.2 4.02l.72-.72A4.5 4.5 0 1 0 8 3.5V1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 1.5 5.5 4 8 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrowserSessionsPanel({ credentials, profiles }: BrowserSessionsPanelProps) {
  const {
    proxies,
    proxyGroups,
    syncAssignments,
    getAssignedProxy,
    refreshProxyForAccount,
    openSessionForAccount,
    isAccountSessionRunning,
    enabledProxyCount,
    loading,
    pythonPath,
    camoufoxStatus,
    bundledRuntime,
    setPythonPathDraft,
    testCamoufox,
    createProxyGroup,
    removeProxyGroup,
    importProxiesToGroup,
    toggleProxy,
    removeProxy,
  } = useBrowserSessions();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [testingCamoufox, setTestingCamoufox] = useState(false);
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const accountIds = useMemo(() => credentials.map((credential) => credential.id), [credentials]);

  useEffect(() => {
    if (loading || accountIds.length === 0) {
      return;
    }
    void syncAssignments(accountIds);
  }, [accountIds, loading, proxies, syncAssignments]);

  const filteredCredentials = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return credentials;
    }
    return credentials.filter((credential) => {
      const linked = formatLinkedProfilesForAccount(credential, profiles);
      return [credential.site, credential.username, linked, credential.notes]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [credentials, profiles, query]);

  const sessionTableColumns = useResizableTableColumns({
    columnIds: SESSION_TABLE_COLUMNS,
    storageKey: "browser-sessions",
    fitKey: filteredCredentials
      .map((credential) =>
        [
          credential.id,
          credential.site,
          credential.username,
          formatLinkedProfilesForAccount(credential, profiles),
          (() => {
            const proxy = getAssignedProxy(credential.id);
            return proxy ? formatProxyLabel(proxy) : "";
          })(),
          isAccountSessionRunning(credential.id) ? "running" : "",
        ].join("\t"),
      )
      .join("\n"),
  });

  const handleRefreshProxy = async (credential: Credential) => {
    setRefreshingId(credential.id);
    setStatus(null);
    try {
      const proxy = await refreshProxyForAccount(credential.id);
      setStatus(
        `Reassigned ${credential.site} / ${credential.username} to ${formatProxyLabel(proxy)}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not reassign proxy.");
    } finally {
      setRefreshingId(null);
    }
  };

  const handleTestCamoufox = async () => {
    setTestingCamoufox(true);
    setStatus(null);
    try {
      const result = await testCamoufox();
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not check Camoufox.");
    } finally {
      setTestingCamoufox(false);
    }
  };

  const handleOpenSession = async (credential: Credential) => {
    if (enabledProxyCount === 0) {
      setStatus("Add at least one enabled proxy before opening a session.");
      return;
    }

    setLaunchingId(credential.id);
    setStatus(null);
    try {
      const result = await openSessionForAccount(credential, profiles);
      const proxyHint = result.proxyLabel ? ` via ${result.proxyLabel}` : "";
      setStatus(
        `Browser opened for ${credential.site} / ${credential.username}${proxyHint}. Close the Camoufox window with X when done — cookies save automatically.`,
      );
    } catch (error) {
      setStatus(formatInvokeError(error, "Could not open browser session."));
    } finally {
      setLaunchingId(null);
    }
  };

  const runBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="browser-sessions-panel">
      <section className="card browser-sessions-card">
        <div className="card-header card-header-tight">
          <div>
            <h2>Browser sessions</h2>
            <p className="muted">
              Opens a headed Camoufox anti-detect browser per account (site + username +
              password). Each account gets a unique proxy when possible, a stable BrowserForge
              fingerprint, and cookies persisted in <code>storage_state.json</code>. If you used
              the old Chrome sessions, sign in once again after switching to Camoufox.
            </p>
          </div>
        </div>

        <div className="browser-sessions-toolbar">
          <div className="browser-sessions-toolbar-left">
            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={() => setShowSetup((value) => !value)}
            >
              {showSetup ? "Hide setup" : "Camoufox setup"}
            </button>
            <span className="muted browser-sessions-proxy-summary">
              {loading
                ? "Loading proxies…"
                : `${enabledProxyCount} enabled / ${proxies.length} saved proxies`}
            </span>
          </div>
          <button
            type="button"
            className="btn-primary btn-compact"
            onClick={() => setProxyModalOpen(true)}
          >
            Manage proxies
          </button>
        </div>

        {showSetup ? (
          <section className="browser-sessions-setup">
            {bundledRuntime?.available ? (
              <p className="muted browser-sessions-hint">
                Using bundled Camoufox runtime
                {bundledRuntime.pythonPath ? (
                  <>
                    {" "}
                    (<code>{bundledRuntime.pythonPath}</code>)
                  </>
                ) : null}
                . No manual Python setup required in the installed app.
              </p>
            ) : (
              <p className="muted browser-sessions-hint">
                One-time setup: <code>pip install -r requirements-camoufox.txt</code> then{" "}
                <code>python -m camoufox fetch</code>
              </p>
            )}
            {!bundledRuntime?.available ? (
              <label className="browser-sessions-field">
                <span>Python path</span>
                <input
                  type="text"
                  value={pythonPath}
                  placeholder="Leave blank for python / .venv"
                  onChange={(event) => setPythonPathDraft(event.target.value)}
                />
              </label>
            ) : null}
            <div className="browser-sessions-proxy-actions">
              <button
                type="button"
                className="btn-secondary btn-compact"
                disabled={busy || testingCamoufox}
                onClick={() => void handleTestCamoufox()}
              >
                {testingCamoufox ? "Testing…" : "Test Camoufox"}
              </button>
              {camoufoxStatus ? (
                <span className={camoufoxStatus.ready ? "text-ok" : "text-bad"}>
                  {camoufoxStatus.ready ? "Ready" : "Not ready"}
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="browser-sessions-profiles">
          <div className="browser-sessions-profiles-header">
            <h3>Account sessions</h3>
            <input
              className="table-search"
              placeholder="Search accounts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {enabledProxyCount === 0 ? (
            <p className="browser-sessions-proxy-required">
              Add at least one enabled proxy via Manage proxies before Open will work.
            </p>
          ) : null}

          <div className="accounts-table-wrap">
            <div className="table-scroll">
              <table
                ref={sessionTableColumns.tableRef}
                className={`profiles-table accounts-table browser-sessions-table ${sessionTableColumns.tableClassName}`.trim()}
              >
                <TableColGroup columns={sessionTableColumns} />
                <thead>
                  <tr>
                    <ResizableTh columns={sessionTableColumns} id="site">
                      Site
                    </ResizableTh>
                    <ResizableTh columns={sessionTableColumns} id="username">
                      Username
                    </ResizableTh>
                    <ResizableTh columns={sessionTableColumns} id="profile">
                      Linked profile
                    </ResizableTh>
                    <ResizableTh columns={sessionTableColumns} id="proxy">
                      Assigned proxy
                    </ResizableTh>
                    <ResizableTh columns={sessionTableColumns} id="session" className="col-actions">
                      Session
                    </ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {filteredCredentials.length === 0 ? (
                    <tr>
                      <td colSpan={SESSION_TABLE_COLUMNS.length} className="table-empty">
                        {credentials.length === 0
                          ? "No accounts yet. Add accounts on the Accounts tab."
                          : "No accounts match your search."}
                      </td>
                    </tr>
                  ) : (
                    filteredCredentials.map((credential) => {
                      const proxy = getAssignedProxy(credential.id);
                      const linkedProfile = formatLinkedProfilesForAccount(credential, profiles);
                      const isRunning = isAccountSessionRunning(credential.id);
                      const isStarting = launchingId === credential.id;
                      return (
                        <tr
                          key={credential.id}
                          className={isRunning ? "browser-session-row-running" : undefined}
                        >
                          <td>{credential.site || "—"}</td>
                          <td className="col-email">{credential.username || "—"}</td>
                          <td className="col-profile" title={linkedProfile}>
                            {linkedProfile}
                          </td>
                          <td>
                            <div className="browser-sessions-proxy-cell">
                              <span title={proxy ? formatProxyLabel(proxy) : undefined}>
                                {proxy ? formatProxyLabel(proxy) : "—"}
                              </span>
                              <button
                                type="button"
                                className="proxy-refresh-btn"
                                title="Reassign to an unused proxy"
                                aria-label={`Reassign proxy for ${credential.username}`}
                                disabled={
                                  busy ||
                                  enabledProxyCount === 0 ||
                                  refreshingId === credential.id
                                }
                                onClick={() => void handleRefreshProxy(credential)}
                              >
                                <ProxyRefreshIcon />
                              </button>
                            </div>
                          </td>
                          <td className="col-actions">
                            <div className="browser-sessions-action-cell">
                              {isRunning ? (
                                <span className="browser-session-status running">Running</span>
                              ) : null}
                              <button
                                type="button"
                                className="btn-secondary btn-compact"
                                title={
                                  enabledProxyCount === 0
                                    ? "Add at least one enabled proxy first"
                                    : isRunning
                                      ? "Camoufox is open for this account"
                                      : "Open Camoufox browser for this account"
                                }
                                disabled={
                                  busy ||
                                  enabledProxyCount === 0 ||
                                  isStarting ||
                                  isRunning
                                }
                                onClick={() => void handleOpenSession(credential)}
                              >
                                {isStarting ? "Starting…" : isRunning ? "Running" : "Open"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {status ? <p className="form-status browser-sessions-status">{status}</p> : null}
      </section>

      <ProxyPoolModal
        open={proxyModalOpen}
        busy={busy}
        proxies={proxies}
        groups={proxyGroups}
        onClose={() => setProxyModalOpen(false)}
        onCreateGroup={async (name) => {
          setBusy(true);
          try {
            const group = await createProxyGroup(name);
            return group.id;
          } finally {
            setBusy(false);
          }
        }}
        onDeleteGroup={(groupId) => runBusy(() => removeProxyGroup(groupId))}
        onImportProxies={async (text, groupId) => {
          setBusy(true);
          try {
            return await importProxiesToGroup(text, groupId);
          } finally {
            setBusy(false);
          }
        }}
        onToggleProxy={(proxyId) => runBusy(() => toggleProxy(proxyId))}
        onRemoveProxy={(proxyId) => runBusy(() => removeProxy(proxyId))}
      />
    </div>
  );
}
