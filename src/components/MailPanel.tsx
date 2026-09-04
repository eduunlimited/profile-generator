import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  compactImapMailIfNeeded,
  deleteImapAccount,
  fetchImapInbox,
  fetchImapMessage,
  getImapMail,
  listImapAccounts,
  saveImapAccount,
  saveImapMail,
  testImap,
} from "../lib/api";
import { formatError } from "../lib/errorUtils";
import { ensureDataKey, releaseDataKey } from "../lib/localDataStore";
import {
  emptyImapAccount,
  extractEmailCode,
  IMAP_MAIL_CAP,
  imapAccountLabel,
  imapAccountToSettings,
  matchImapMessageToProfiles,
  mergeStoredImapMessages,
  messageHtmlBody,
  parseSender,
  formatSender,
  toStoredImapHeaders,
  toStoredImapMessage,
  wrapEmailHtml,
} from "../lib/imapInbox";
import { copyToClipboard } from "../hooks/useAppData";
import { useConfirmDelete } from "../hooks/useConfirmDelete";
import type { ImapAccount, ProfileSummary, StoredImapMessage } from "../lib/types";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { ImapAccountModal } from "./ImapAccountModal";
import { ImapKeysModal } from "./ImapKeysModal";

const MAIL_SIDEBAR_WIDTH_KEY = "profile-generator:mail-sidebar-width";
const MAIL_SIDEBAR_DEFAULT_WIDTH = 200;
const MAIL_SIDEBAR_MIN_WIDTH = 140;
const MAIL_SIDEBAR_MAX_WIDTH = 420;
const ALL_MAIL_ID = "all";

function clampSidebarWidth(width: number): number {
  return Math.min(MAIL_SIDEBAR_MAX_WIDTH, Math.max(MAIL_SIDEBAR_MIN_WIDTH, width));
}

function readSidebarWidth(): number {
  const stored = localStorage.getItem(MAIL_SIDEBAR_WIDTH_KEY);
  if (!stored) return MAIL_SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : MAIL_SIDEBAR_DEFAULT_WIDTH;
}

function formatMessageDate(value: string, dateMs?: number): string {
  const parsed = dateMs && dateMs > 0 ? dateMs : Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return value || "—";
  return new Date(parsed).toLocaleString();
}

async function refreshImapAccount(
  account: ImapAccount,
  existing: StoredImapMessage[],
  offset = 0,
): Promise<{ account: ImapAccount; messages: StoredImapMessage[]; fetchedCount: number }> {
  const fetched = await fetchImapInbox(imapAccountToSettings(account), IMAP_MAIL_CAP, offset);
  const messages = mergeStoredImapMessages(existing, fetched);
  await saveImapMail(account.id, messages);
  const updated: ImapAccount = { ...account, lastFetchedAt: new Date().toISOString() };
  await saveImapAccount(updated);
  return { account: updated, messages, fetchedCount: fetched.length };
}

interface MailPanelProps {
  profiles: ProfileSummary[];
}

interface MailRow {
  accountId: string;
  accountLabel: string;
  message: StoredImapMessage;
  matched: ProfileSummary[];
  code?: string;
}

export function MailPanel({ profiles }: MailPanelProps) {
  const [accounts, setAccounts] = useState<ImapAccount[]>([]);
  const [mailByAccount, setMailByAccount] = useState<Record<string, StoredImapMessage[]>>({});
  const [selectedAccountId, setSelectedAccountId] = useState<string>(ALL_MAIL_ID);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "fetch" | "sync" | "save" | "test" | "delete" | "more" | null>(null);
  const [exhaustedIds, setExhaustedIds] = useState<Record<string, boolean>>({});
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [draft, setDraft] = useState<ImapAccount | null>(null);
  const [modalStatus, setModalStatus] = useState<string | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  const [showEditKeys, setShowEditKeys] = useState(false);
  const [bodyBusyKey, setBodyBusyKey] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [openedBodies, setOpenedBodies] = useState<Record<string, StoredImapMessage>>({});
  const openedBodiesRef = useRef(openedBodies);
  openedBodiesRef.current = openedBodies;
  const { pending: deleteConfirm, busy: deleteConfirmBusy, askConfirm, closeConfirm, acceptConfirm } =
    useConfirmDelete();

  useEffect(() => {
    localStorage.setItem(MAIL_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    void (async () => {
      try {
        await ensureDataKey("profile-generator:imap-settings");
        const listed = await listImapAccounts();
        if (cancelled) return;
        setAccounts(listed);
        if (listed.length === 0) {
          setBusy(null);
          return;
        }
        await ensureDataKey("profile-generator:imap-mail");
        await compactImapMailIfNeeded();
        if (cancelled) return;
        const mailEntries = await Promise.all(
          listed.map(async (account) => [account.id, await getImapMail(account.id)] as const),
        );
        if (cancelled) return;
        const stored = Object.fromEntries(mailEntries);
        setMailByAccount(stored);
        setBusy(null);

        setBusy("fetch");
        setStatus("Refreshing mail from IMAP…");
        const nextAccounts: ImapAccount[] = [];
        const nextMail = { ...stored };
        const errors: string[] = [];
        for (const account of listed) {
          if (cancelled) return;
          try {
            const result = await refreshImapAccount(account, nextMail[account.id] ?? []);
            nextAccounts.push(result.account);
            nextMail[account.id] = result.messages;
            setMailByAccount({ ...nextMail });
          } catch (error) {
            nextAccounts.push(account);
            errors.push(`${imapAccountLabel(account)}: ${formatError(error, "refresh failed")}`);
          }
        }
        if (cancelled) return;
        setAccounts(nextAccounts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
        setMailByAccount(nextMail);
        setStatus(
          errors.length === 0
            ? `Loaded mail for ${listed.length} IMAP key(s).`
            : `Loaded stored mail. ${errors.join(" ")}`,
        );
      } catch (error) {
        if (!cancelled) setStatus(formatError(error, "Could not load mailboxes."));
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
      releaseDataKey("profile-generator:imap-mail");
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        setActiveKey(null);
        setOpenedBodies({});
        setBodyBusyKey(null);
        setBodyError(null);
        setMailByAccount((current) => {
          const stripped: Record<string, StoredImapMessage[]> = {};
          for (const [id, messages] of Object.entries(current)) {
            stripped[id] = messages.map((message) => toStoredImapHeaders(message, message.fetchedAt));
          }
          return stripped;
        });
        releaseDataKey("profile-generator:imap-mail");
        return;
      }
      void ensureDataKey("profile-generator:imap-mail");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const startSidebarResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + (moveEvent.clientX - startX)));
    };
    const handleMouseUp = () => {
      document.body.classList.remove("accounts-resizing");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    document.body.classList.add("accounts-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;
  const visibleAccounts =
    selectedAccountId === ALL_MAIL_ID ? accounts : accounts.filter((account) => account.id === selectedAccountId);

  const rows = useMemo<MailRow[]>(() => {
    const next: MailRow[] = [];
    for (const account of visibleAccounts) {
      const label = imapAccountLabel(account);
      for (const message of mailByAccount[account.id] ?? []) {
        next.push({
          accountId: account.id,
          accountLabel: label,
          message,
          matched: matchImapMessageToProfiles(message, profiles),
          code: extractEmailCode(`${message.subject}\n${message.snippet}`),
        });
      }
    }
    return next.sort((a, b) => b.message.dateMs - a.message.dateMs || b.message.uid - a.message.uid);
  }, [mailByAccount, profiles, visibleAccounts]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.message.subject,
        row.message.from,
        row.message.fromName ?? "",
        row.message.fromEmail ?? "",
        row.message.to,
        row.message.snippet,
        row.message.body,
        row.message.recipients.join(" "),
        row.accountLabel,
        row.code ?? "",
        ...row.matched.map((profile) => `${profile.name} ${profile.email}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, rows]);

  const activeRow = filteredRows.find((row) => `${row.accountId}:${row.message.uid}` === activeKey) ?? null;
  const activeOpened = activeRow
    ? openedBodies[`${activeRow.accountId}:${activeRow.message.uid}`]
    : undefined;
  const activeMessage = activeOpened ?? activeRow?.message ?? null;
  const activeCode =
    (activeMessage
      ? extractEmailCode(`${activeMessage.subject}\n${activeMessage.body}\n${activeMessage.htmlBody ?? ""}`)
      : undefined) ?? activeRow?.code;
  const storedCount = selectedAccountId === ALL_MAIL_ID
    ? Object.values(mailByAccount).reduce((sum, messages) => sum + messages.length, 0)
    : (mailByAccount[selectedAccountId]?.length ?? 0);

  const upsertAccount = (account: ImapAccount) => {
    setAccounts((current) => {
      const exists = current.some((item) => item.id === account.id);
      const next = exists
        ? current.map((item) => (item.id === account.id ? account : item))
        : [...current, account];
      return next.sort((a, b) =>
        imapAccountLabel(a).localeCompare(imapAccountLabel(b), undefined, { sensitivity: "base" }),
      );
    });
  };

  const persistFetchedMail = async (account: ImapAccount, offset = 0) => {
    const existing = mailByAccount[account.id] ?? (await getImapMail(account.id));
    const result = await refreshImapAccount(account, existing, offset);
    setMailByAccount((current) => ({ ...current, [account.id]: result.messages }));
    upsertAccount(result.account);
    return { count: result.messages.length, added: result.messages.length - existing.length };
  };

  const handleSync = async () => {
    const targets = visibleAccounts;
    if (targets.length === 0) return;
    setBusy("sync");
    const nextMail = { ...mailByAccount };
    const nextExhausted = { ...exhaustedIds };
    const errors: string[] = [];
    let addedTotal = 0;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const account = targets[index];
        const label = imapAccountLabel(account);
        setStatus(
          targets.length === 1
            ? `Syncing ${label}…`
            : `Syncing ${label} (${index + 1}/${targets.length})…`,
        );
        let existing = nextMail[account.id] ?? [];
        let offset = 0;
        try {
          while (true) {
            const result = await refreshImapAccount(account, existing, offset);
            addedTotal += Math.max(0, result.messages.length - existing.length);
            existing = result.messages;
            nextMail[account.id] = existing;
            setMailByAccount({ ...nextMail });
            upsertAccount(result.account);
            setStatus(
              targets.length === 1
                ? `Syncing ${label}… ${existing.length} stored`
                : `Syncing ${label} (${index + 1}/${targets.length})… ${existing.length} stored`,
            );
            if (result.fetchedCount === 0) {
              nextExhausted[account.id] = true;
              break;
            }
            offset += result.fetchedCount;
            if (result.fetchedCount < IMAP_MAIL_CAP) {
              nextExhausted[account.id] = true;
              break;
            }
          }
        } catch (error) {
          errors.push(`${label}: ${formatError(error, "sync failed")}`);
        }
      }
      setMailByAccount(nextMail);
      setExhaustedIds(nextExhausted);
      const scope =
        selectedAccountId === ALL_MAIL_ID && targets.length > 1
          ? `${targets.length} IMAP key(s)`
          : imapAccountLabel(targets[0]);
      if (errors.length === 0) {
        setStatus(
          addedTotal === 0
            ? `Synced ${scope}. No new messages.`
            : `Synced ${scope}. ${addedTotal} new message(s).`,
        );
      } else {
        setStatus(`Synced ${addedTotal} new message(s). ${errors.join(" ")}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const handleLoadMore = async () => {
    const targets = visibleAccounts.filter((account) => !exhaustedIds[account.id]);
    if (targets.length === 0) return;
    setBusy("more");
    setStatus(
      targets.length === 1
        ? `Loading ${IMAP_MAIL_CAP} more from ${imapAccountLabel(targets[0])}…`
        : `Loading ${IMAP_MAIL_CAP} more from ${targets.length} IMAP key(s)…`,
    );
    const nextMail = { ...mailByAccount };
    const nextExhausted = { ...exhaustedIds };
    const errors: string[] = [];
    let addedTotal = 0;
    try {
      for (const account of targets) {
        try {
          const existing = nextMail[account.id] ?? [];
          const result = await refreshImapAccount(account, existing, existing.length);
          const added = result.messages.length - existing.length;
          addedTotal += added;
          if (added === 0) nextExhausted[account.id] = true;
          nextMail[account.id] = result.messages;
          setMailByAccount({ ...nextMail });
          upsertAccount(result.account);
        } catch (error) {
          errors.push(`${imapAccountLabel(account)}: ${formatError(error, "load more failed")}`);
        }
      }
      setMailByAccount(nextMail);
      setExhaustedIds(nextExhausted);
      if (errors.length === 0) {
        setStatus(addedTotal === 0 ? "No older messages to load." : `Loaded ${addedTotal} older message(s).`);
      } else {
        setStatus(`Loaded ${addedTotal} older message(s). ${errors.join(" ")}`);
      }
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!activeRow) return;
    const key = `${activeRow.accountId}:${activeRow.message.uid}`;
    const alreadyOpened = openedBodiesRef.current[key];
    if (alreadyOpened) {
      setBodyError(null);
      return;
    }
    const account = accounts.find((item) => item.id === activeRow.accountId);
    if (!account) return;
    let cancelled = false;
    setBodyBusyKey(key);
    setBodyError(null);
    void (async () => {
      try {
        const fetched = await fetchImapMessage(imapAccountToSettings(account), activeRow.message.uid);
        if (cancelled) return;
        const stored = toStoredImapMessage(fetched);
        setOpenedBodies((current) => ({ ...current, [key]: stored }));
      } catch (error) {
        if (!cancelled) setBodyError(formatError(error, "Could not load message."));
      } finally {
        if (!cancelled) {
          setBodyBusyKey((current) => (current === key ? null : current));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, activeRow?.accountId, activeRow?.message.uid]);

  const openAddModal = () => {
    setEditingExisting(false);
    setModalStatus(null);
    setDraft(emptyImapAccount());
  };

  const openSettings = (account: ImapAccount) => {
    setEditingExisting(true);
    setModalStatus(null);
    setDraft({ ...account });
  };

  const handleTestDraft = async () => {
    if (!draft) return;
    setBusy("test");
    setModalStatus(null);
    try {
      const result = await testImap(imapAccountToSettings(draft));
      setModalStatus(result.message);
    } catch (error) {
      setModalStatus(formatError(error, "IMAP connection failed."));
    } finally {
      setBusy(null);
    }
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    if (!draft.host.trim() || !draft.username.trim() || !draft.password) {
      setModalStatus("Host, username, and IMAP key are required.");
      return;
    }
    setBusy("save");
    setModalStatus(null);
    const account: ImapAccount = {
      ...draft,
      name: draft.name.trim() || draft.username.trim(),
      host: draft.host.trim(),
      username: draft.username.trim(),
      mailbox: draft.mailbox.trim() || "INBOX",
    };
    try {
      await saveImapAccount(account);
      upsertAccount(account);
      setSelectedAccountId(account.id);
      setDraft(null);
      setStatus(`Saved ${imapAccountLabel(account)}. Loading mail…`);
      try {
        const { count } = await persistFetchedMail(account);
        setStatus(`Saved ${imapAccountLabel(account)} and stored ${count} message(s).`);
      } catch (error) {
        setStatus(`Saved ${imapAccountLabel(account)}. ${formatError(error, "Mail refresh failed.")}`);
      }
    } catch (error) {
      setModalStatus(formatError(error, "Could not save IMAP key."));
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveAccount = (account: ImapAccount) => {
    askConfirm({
      title: "Remove IMAP key",
      message: `Remove ${imapAccountLabel(account)} and its stored mail?`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        setBusy("delete");
        try {
          await deleteImapAccount(account.id);
          setAccounts((current) => current.filter((item) => item.id !== account.id));
          setMailByAccount((current) => {
            const next = { ...current };
            delete next[account.id];
            return next;
          });
          setExhaustedIds((current) => {
            const next = { ...current };
            delete next[account.id];
            return next;
          });
          if (selectedAccountId === account.id) {
            setSelectedAccountId(ALL_MAIL_ID);
            setActiveKey(null);
          }
          setStatus(`Removed ${imapAccountLabel(account)}.`);
        } catch (error) {
          setStatus(formatError(error, "Could not remove IMAP key."));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const poolTitle =
    selectedAccountId === ALL_MAIL_ID ? "All mailboxes" : selectedAccount ? imapAccountLabel(selectedAccount) : "Mail";

  return (
    <>
      <div className="accounts-layout">
        <aside className="accounts-sidebar card" style={{ width: sidebarWidth }}>
          <div className="accounts-category-all-row">
            <button
              type="button"
              className={`accounts-category-item${selectedAccountId === ALL_MAIL_ID ? " active" : ""}`}
              onClick={() => setSelectedAccountId(ALL_MAIL_ID)}
            >
              <span>All</span>
              <span className="accounts-category-count">{accounts.length}</span>
            </button>
          </div>
          <ul className="accounts-category-list">
            {accounts.length === 0 ? (
              <li className="muted mail-sidebar-empty">No IMAP keys yet</li>
            ) : (
              accounts.map((account) => (
                <li key={account.id} className="accounts-category-row">
                  <button
                    type="button"
                    className={`accounts-category-item mail-key-item${selectedAccountId === account.id ? " active" : ""}`}
                    onClick={() => setSelectedAccountId(account.id)}
                  >
                    <span className="mail-key-copy">
                      <span className="mail-key-name">{imapAccountLabel(account)}</span>
                      {account.username.trim() ? (
                        <span className="mail-key-sub">{account.username.trim()}</span>
                      ) : null}
                    </span>
                    <span className="accounts-category-count">{mailByAccount[account.id]?.length ?? 0}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="mail-sidebar-actions">
            <button type="button" className="btn-secondary accounts-create-category-btn" onClick={openAddModal}>
              Add IMAP key
            </button>
            <button type="button" className="btn-secondary mail-sidebar-edit-btn" onClick={() => setShowEditKeys(true)}>
              Edit IMAP keys
            </button>
          </div>
        </aside>

        <div
          className="accounts-sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize mailboxes panel"
          onMouseDown={startSidebarResize}
        />

        <div className="accounts-main">
          <section className="card accounts-pool-card mail-pool-card">
            <div className="card-header card-header-tight">
              <div>
                <h2>Mail</h2>
                <p className="muted">
                  {poolTitle} · {storedCount} stored
                </p>
              </div>
            </div>

            <div className="accounts-table-toolbar">
              <input
                className="table-search"
                placeholder="Search mail"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="btn-primary btn-compact"
                disabled={busy !== null || visibleAccounts.length === 0}
                onClick={() => void handleSync()}
              >
                {busy === "sync"
                  ? "Syncing…"
                  : selectedAccountId === ALL_MAIL_ID && visibleAccounts.length > 1
                    ? "Sync all keys"
                    : "Sync"}
              </button>
              <button
                type="button"
                className="btn-secondary btn-compact"
                disabled={
                  busy !== null ||
                  visibleAccounts.length === 0 ||
                  visibleAccounts.every((account) => exhaustedIds[account.id])
                }
                onClick={() => void handleLoadMore()}
              >
                {busy === "more"
                  ? "Loading…"
                  : selectedAccountId === ALL_MAIL_ID && visibleAccounts.length > 1
                    ? `Load ${IMAP_MAIL_CAP} more per key`
                    : `Load ${IMAP_MAIL_CAP} more`}
              </button>
            </div>

            {status ? <p className="status-banner accounts-pool-status">{status}</p> : null}

            {(busy === "load" || busy === "save") && filteredRows.length === 0 ? (
              <p className="muted mail-empty">Loading messages…</p>
            ) : filteredRows.length === 0 ? (
              <p className="muted mail-empty">
                {accounts.length === 0
                  ? "Add an IMAP key in the sidebar to load mail."
                  : "No stored mail yet."}
              </p>
            ) : (
              <div className="inbox-layout mail-inbox-layout">
                <div className="inbox-list">
                  {filteredRows.map((row) => {
                    const key = `${row.accountId}:${row.message.uid}`;
                    const active = key === activeKey;
                    const profileLabel = row.matched.map((profile) => profile.name || profile.email).join(", ");
                    const sender = parseSender(row.message.from, row.message.fromName, row.message.fromEmail);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`inbox-item${active ? " is-active" : ""}`}
                        onClick={() => setActiveKey(key)}
                      >
                        <span className="inbox-item-top">
                          <strong>{row.message.subject.trim() || "(no subject)"}</strong>
                          <span className="inbox-item-date">{formatMessageDate(row.message.date, row.message.dateMs)}</span>
                        </span>
                        <span className="inbox-item-from">
                          {sender.name || sender.email || "Unknown sender"}
                          {sender.name && sender.email ? <span className="inbox-item-email">{sender.email}</span> : null}
                        </span>
                        <span className="inbox-item-meta">
                          {selectedAccountId === ALL_MAIL_ID ? `${row.accountLabel} · ` : ""}
                          {profileLabel || row.message.recipients[0] || row.message.to || "—"}
                        </span>
                        {row.code ? <span className="inbox-otp">Code {row.code}</span> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="inbox-detail">
                  {activeRow ? (
                    <>
                      <h3>{activeRow.message.subject.trim() || "(no subject)"}</h3>
                      <p className="muted">
                        {formatMessageDate(activeRow.message.date, activeRow.message.dateMs)}
                        {" · "}
                        {formatSender(activeRow.message.from, activeRow.message.fromName, activeRow.message.fromEmail)}
                      </p>
                      <p>
                        <strong>To:</strong>{" "}
                        {activeRow.message.recipients.join(", ") || activeRow.message.to.trim() || "—"}
                      </p>
                      {selectedAccountId === ALL_MAIL_ID ? (
                        <p>
                          <strong>IMAP key:</strong> {activeRow.accountLabel}
                        </p>
                      ) : null}
                      {activeRow.matched.length > 0 ? (
                        <p>
                          <strong>Profiles:</strong>{" "}
                          {activeRow.matched.map((profile) => profile.name || profile.email).join(", ")}
                        </p>
                      ) : null}
                      {activeCode ? (
                        <div className="button-row">
                          <span className="inbox-otp inbox-otp-lg">Code {activeCode}</span>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => void copyToClipboard(activeCode)}
                          >
                            Copy code
                          </button>
                        </div>
                      ) : null}
                      <MessageBody
                        message={activeMessage ?? activeRow.message}
                        loading={bodyBusyKey === `${activeRow.accountId}:${activeRow.message.uid}`}
                        error={bodyError}
                      />
                    </>
                  ) : (
                    <p className="muted">Select a message to read it.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <ImapKeysModal
        open={showEditKeys}
        accounts={accounts}
        mailCounts={Object.fromEntries(accounts.map((account) => [account.id, mailByAccount[account.id]?.length ?? 0]))}
        onClose={() => setShowEditKeys(false)}
        onAdd={openAddModal}
        onEdit={openSettings}
        onRemove={handleRemoveAccount}
      />

      <ImapAccountModal
        open={Boolean(draft)}
        title={editingExisting ? "Edit IMAP key" : "Add IMAP key"}
        account={draft}
        busy={busy === "save" || busy === "test"}
        status={modalStatus}
        onClose={() => setDraft(null)}
        onChange={setDraft}
        onTest={() => void handleTestDraft()}
        onSave={() => void handleSaveDraft()}
      />

      <ConfirmDeleteModal
        open={Boolean(deleteConfirm)}
        title={deleteConfirm?.title ?? "Delete"}
        message={deleteConfirm?.message ?? ""}
        confirmLabel={deleteConfirm?.confirmLabel}
        busy={deleteConfirmBusy}
        onClose={closeConfirm}
        onConfirm={acceptConfirm}
      />
    </>
  );
}

function MessageBody({
  message,
  loading,
  error,
}: {
  message: StoredImapMessage;
  loading?: boolean;
  error?: string | null;
}) {
  const html = messageHtmlBody(message);
  if (html) {
    return (
      <div className="inbox-message">
        <iframe
          className="inbox-message-frame"
          title="Message body"
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          srcDoc={wrapEmailHtml(html)}
        />
      </div>
    );
  }
  if (loading) {
    return <p className="muted">Loading message…</p>;
  }
  if (error) {
    return <p className="muted">{error}</p>;
  }
  const text = message.body.trim() || message.snippet.trim();
  if (!text) {
    return <p className="muted">Select a message to load it.</p>;
  }
  return (
    <div className="inbox-message">
      <pre className="inbox-message-text">{text}</pre>
    </div>
  );
}
