import { useEffect, useMemo, useState } from "react";
import { formatProxyLabel, parseProxyLines } from "./proxyPool";
import { PROXY_UNCATEGORIZED_GROUP_ID } from "./proxyGroupUtils";
import type { ProxyEntry, ProxyGroup } from "./types";

interface ProxyPoolModalProps {
  open: boolean;
  busy: boolean;
  proxies: ProxyEntry[];
  groups: ProxyGroup[];
  onClose: () => void;
  onCreateGroup: (name: string) => Promise<string>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onImportProxies: (text: string, groupId: string) => Promise<number>;
  onToggleProxy: (proxyId: string) => Promise<void>;
  onRemoveProxy: (proxyId: string) => Promise<void>;
}

export function ProxyPoolModal({
  open,
  busy,
  proxies,
  groups,
  onClose,
  onCreateGroup,
  onDeleteGroup,
  onImportProxies,
  onToggleProxy,
  onRemoveProxy,
}: ProxyPoolModalProps) {
  const [selectedGroupId, setSelectedGroupId] = useState(PROXY_UNCATEGORIZED_GROUP_ID);
  const [importText, setImportText] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedGroupId(PROXY_UNCATEGORIZED_GROUP_ID);
      setImportText("");
      setNewGroupName("");
      setCreatingGroup(false);
      setStatus(null);
      setStatusError(null);
    }
  }, [open]);

  const groupProxies = useMemo(
    () =>
      proxies.filter(
        (proxy) => (proxy.groupId || PROXY_UNCATEGORIZED_GROUP_ID) === selectedGroupId,
      ),
    [proxies, selectedGroupId],
  );

  const enabledCount = useMemo(() => proxies.filter((proxy) => proxy.enabled).length, [proxies]);

  if (!open) {
    return null;
  }

  const handleCreateGroup = async () => {
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setStatusError("Group name is required.");
      return;
    }
    setStatusError(null);
    try {
      const group = await onCreateGroup(trimmed);
      setNewGroupName("");
      setCreatingGroup(false);
      setSelectedGroupId(group);
      setStatus(`Created group "${trimmed}".`);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Could not create group.");
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (groupId === PROXY_UNCATEGORIZED_GROUP_ID) {
      return;
    }
    setStatusError(null);
    try {
      await onDeleteGroup(groupId);
      setSelectedGroupId(PROXY_UNCATEGORIZED_GROUP_ID);
      setStatus("Group deleted. Its proxies moved to Uncategorized.");
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Could not delete group.");
    }
  };

  const handleImport = async () => {
    const parsed = parseProxyLines(importText, selectedGroupId);
    if (parsed.length === 0) {
      setStatusError("Paste at least one valid proxy line.");
      return;
    }
    setStatusError(null);
    try {
      const added = await onImportProxies(importText, selectedGroupId);
      setImportText("");
      setStatus(`Added ${added} proxy(ies) to ${groups.find((g) => g.id === selectedGroupId)?.name ?? "group"}.`);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Could not import proxies.");
    }
  };

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);

  return (
    <div className="modal-overlay">
      <div
        className="modal-dialog modal-dialog-wide proxy-pool-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <strong>Manage proxies</strong>
            <p className="muted proxy-pool-modal-summary">
              {enabledCount} enabled / {proxies.length} total — saved locally and reused across sessions.
            </p>
          </div>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-body proxy-pool-modal-body">
          <aside className="proxy-pool-groups">
            <div className="proxy-pool-groups-header">
              <span>Groups</span>
              <button
                type="button"
                className="btn-secondary btn-compact"
                disabled={busy}
                onClick={() => setCreatingGroup((value) => !value)}
              >
                {creatingGroup ? "Cancel" : "New group"}
              </button>
            </div>

            {creatingGroup ? (
              <div className="proxy-pool-create-group">
                <input
                  value={newGroupName}
                  placeholder="Group name"
                  autoFocus
                  onChange={(event) => {
                    setNewGroupName(event.target.value);
                    setStatusError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleCreateGroup();
                  }}
                />
                <button
                  type="button"
                  className="btn-primary btn-compact"
                  disabled={busy}
                  onClick={() => void handleCreateGroup()}
                >
                  Create
                </button>
              </div>
            ) : null}

            <ul className="accounts-category-list">
              {groups.map((group) => {
                const count = proxies.filter(
                  (proxy) => (proxy.groupId || PROXY_UNCATEGORIZED_GROUP_ID) === group.id,
                ).length;
                const enabledInGroup = proxies.filter(
                  (proxy) =>
                    (proxy.groupId || PROXY_UNCATEGORIZED_GROUP_ID) === group.id && proxy.enabled,
                ).length;
                return (
                  <li key={group.id} className="proxy-pool-group-row">
                    <button
                      type="button"
                      className={
                        selectedGroupId === group.id
                          ? "accounts-category-item active"
                          : "accounts-category-item"
                      }
                      onClick={() => setSelectedGroupId(group.id)}
                    >
                      <span className="accounts-category-name">{group.name}</span>
                      <span className="accounts-category-count">
                        {enabledInGroup}/{count}
                      </span>
                    </button>
                    {group.id !== PROXY_UNCATEGORIZED_GROUP_ID ? (
                      <button
                        type="button"
                        className="btn-secondary btn-compact proxy-pool-delete-group"
                        title={`Delete ${group.name}`}
                        disabled={busy}
                        onClick={() => void handleDeleteGroup(group.id)}
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="proxy-pool-detail">
            <h3>{selectedGroup?.name ?? "Proxies"}</h3>
            <p className="muted browser-sessions-hint">
              Formats: <code>host:port</code>, <code>host:port:user:pass</code>,{" "}
              <code>http://user:pass@host:port</code>
            </p>
            <textarea
              className="browser-sessions-import"
              rows={5}
              value={importText}
              placeholder={"192.168.1.10:8080\nproxy.example.com:3128:user:pass"}
              onChange={(event) => setImportText(event.target.value)}
            />
            <div className="browser-sessions-proxy-actions">
              <button
                type="button"
                className="btn-primary btn-compact"
                disabled={busy}
                onClick={() => void handleImport()}
              >
                Add to group
              </button>
              <span className="muted">{groupProxies.length} in this group</span>
            </div>

            {groupProxies.length > 0 ? (
              <div className="proxy-pool-list">
                <table className="browser-sessions-table">
                  <thead>
                    <tr>
                      <th>Proxy</th>
                      <th>User</th>
                      <th>Enabled</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {groupProxies.map((proxy) => (
                      <tr key={proxy.id}>
                        <td title={formatProxyLabel(proxy)}>
                          {proxy.host}:{proxy.port}
                        </td>
                        <td className="proxy-pool-user-cell" title={proxy.username}>
                          {proxy.username?.trim() || "—"}
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={proxy.enabled}
                            disabled={busy}
                            onChange={() => void onToggleProxy(proxy.id)}
                          />
                        </td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn-secondary btn-compact"
                            disabled={busy}
                            onClick={() => void onRemoveProxy(proxy.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted proxy-pool-empty">No proxies in this group yet.</p>
            )}
          </section>
        </div>

        {error ? <p className="status-inline proxy-pool-modal-status">{error}</p> : null}
        {!error && status ? (
          <p className="form-status proxy-pool-modal-status">{status}</p>
        ) : null}
      </div>
    </div>
  );
}
