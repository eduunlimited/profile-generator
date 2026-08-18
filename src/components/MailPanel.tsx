import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  deleteImapAccount,
  fetchImapInbox,
  getImapMail,
  listImapAccounts,
  saveImapAccount,
  saveImapMail,
  testImap,
} from "../lib/api";
import { formatError } from "../lib/errorUtils";
import {
  emptyImapAccount,
  extractEmailCode,
  IMAP_MAIL_CAP,
  imapAccountLabel,
  imapAccountToSettings,
  matchImapMessageToProfiles,
  mergeStoredImapMessages,
} from "../lib/imapInbox";
import { copyToClipboard } from "../hooks/useAppData";
import { useConfirmDelete } from "../hooks/useConfirmDelete";
import type { ImapAccount, ProfileSummary, StoredImapMessage } from "../lib/types";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { ImapAccountModal } from "./ImapAccountModal";

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
  const [busy, setBusy] = useState<"load" | "fetch" | "save" | "test" | "delete" | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [draft, setDraft] = useState<ImapAccount | null>(null);
  const [modalStatus, setModalStatus] = useState<string | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
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
        const listed = await listImapAccounts();
        if (cancelled) return;
        setAccounts(listed);
        const mailEntries = await Promise.all(
          listed.map(async (account) => [account.id, await getImapMail(account.id)] as const),
        );
        if (cancelled) return;
        setMailByAccount(Object.fromEntries(mailEntries));
      } catch (error) {
        if (!cancelled) setStatus(formatError(error, "Could not load mailboxes."));
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
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
          code: extractEmailCode(`${message.subject}\n${message.body}`) ?? extractEmailCode(message.snippet),
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
  const storedCount = selectedAccountId === ALL_MAIL_ID
    ? Object.values(mailByAccount).reduce((sum, messages) => sum + messages.length, 0)
    : (mailByAccount[selectedAccountId]?.length ?? 0);

  const persistFetchedMail = async (account: ImapAccount) => {
    const fetched = await fetchImapInbox(imapAccountToSettings(account), IMAP_MAIL_CAP);
    const merged = mergeStoredImapMessages(mailByAccount[account.id] ?? [], fetched);
    await saveImapMail(account.id, merged);
    const updated: ImapAccount = { ...account, lastFetchedAt: new Date().toISOString() };
    await saveImapAccount(updated);
    setMailByAccount((current) => ({ ...current, [account.id]: merged }));
    setAccounts((current) => {
      const exists = current.some((item) => item.id === updated.id);
      const next = exists ? current.map((item) => (item.id === updated.id ? updated : item)) : [...current, updated];
      return next.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    });
    return merged.length;
  };

  const loadSelected = async () => {
    const targets = selectedAccount ? [selectedAccount] : accounts;
    if (targets.length === 0) {
      setStatus("Add an IMAP key first.");
      return;
    }
    setBusy("fetch");
    setStatus(null);
    try {
      let loaded = 0;
      for (const account of targets) {
        loaded += await persistFetchedMail(account);
      }
      setStatus(
        targets.length === 1
          ? `Stored ${loaded} message(s) for ${imapAccountLabel(targets[0])} (cap ${IMAP_MAIL_CAP}).`
          : `Stored mail for ${targets.length} IMAP key(s).`,
      );
    } catch (error) {
      setStatus(formatError(error, "Could not load mail."));
    } finally {
      setBusy(null);
    }
  };

  const openAddModal = () => {
    setEditingExisting(false);
    setModalStatus(null);
    setDraft(emptyImapAccount());
  };

  const openEditModal = () => {
    if (!selectedAccount) return;
    setEditingExisting(true);
    setModalStatus(null);
    setDraft({ ...selectedAccount });
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
    try {
      const account: ImapAccount = {
        ...draft,
        name: draft.name.trim() || draft.username.trim(),
        host: draft.host.trim(),
        username: draft.username.trim(),
        mailbox: draft.mailbox.trim() || "INBOX",
      };
      await saveImapAccount(account);
      const count = await persistFetchedMail(account);
      setSelectedAccountId(account.id);
      setDraft(null);
      setStatus(`Saved ${imapAccountLabel(account)} and stored ${count} message(s).`);
    } catch (error) {
      setModalStatus(formatError(error, "Could not save IMAP key."));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedAccount) return;
    const account = selectedAccount;
    askConfirm({
      title: "Delete IMAP key",
      message: `Delete ${imapAccountLabel(account)} and its stored mail?`,
      confirmLabel: "Delete",
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
          setSelectedAccountId(ALL_MAIL_ID);
          setActiveKey(null);
          setStatus(`Deleted ${imapAccountLabel(account)}.`);
        } catch (error) {
          setStatus(formatError(error, "Could not delete IMAP key."));
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
            {accounts.map((account) => (
              <li key={account.id} className="accounts-category-row">
                <button
                  type="button"
                  className={`accounts-category-item${selectedAccountId === account.id ? " active" : ""}`}
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <span>{imapAccountLabel(account)}</span>
                  <span className="accounts-category-count">{mailByAccount[account.id]?.length ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-secondary accounts-create-category-btn" onClick={openAddModal}>
            Add IMAP key
          </button>
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
                  {poolTitle} · {storedCount} stored (last {IMAP_MAIL_CAP} per IMAP key)
                </p>
              </div>
            </div>

            <div className="accounts-table-toolbar">
              <div className="button-row compact accounts-toolbar-actions">
                <button type="button" className="btn-secondary btn-compact" onClick={openAddModal}>
                  Add IMAP key
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={!selectedAccount}
                  onClick={openEditModal}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={busy !== null || accounts.length === 0}
                  onClick={() => void loadSelected()}
                >
                  Load mail
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact ghost-button danger"
                  disabled={!selectedAccount}
                  onClick={handleDeleteSelected}
                >
                  Delete
                </button>
              </div>
              <input
                className="table-search"
                placeholder="Search mail"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            {status ? <p className="status-banner accounts-pool-status">{status}</p> : null}

            {busy === "load" || busy === "fetch" || busy === "save" ? (
              <p className="muted mail-empty">Loading messages…</p>
            ) : filteredRows.length === 0 ? (
              <p className="muted mail-empty">
                {accounts.length === 0
                  ? "Add an IMAP key to load the last 500 emails."
                  : "No stored mail yet. Click Load mail."}
              </p>
            ) : (
              <div className="inbox-layout mail-inbox-layout">
                <div className="inbox-list">
                  {filteredRows.map((row) => {
                    const key = `${row.accountId}:${row.message.uid}`;
                    const active = key === activeKey;
                    const profileLabel = row.matched.map((profile) => profile.name || profile.email).join(", ");
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
                        {activeRow.message.from.trim() || "—"}
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
                      {activeRow.code ? (
                        <div className="button-row">
                          <span className="inbox-otp inbox-otp-lg">Code {activeRow.code}</span>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => void copyToClipboard(activeRow.code ?? "")}
                          >
                            Copy code
                          </button>
                        </div>
                      ) : null}
                      <pre className="preview-box">
                        {activeRow.message.body || activeRow.message.snippet || "No body."}
                      </pre>
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
