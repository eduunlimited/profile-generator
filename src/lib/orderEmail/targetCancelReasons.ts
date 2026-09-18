import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  fetchImapMessage,
  listCredentials,
  listImapAccounts,
  listOrderAnalysis,
  listOrders,
  listProxies,
  listProxyAssignments,
  saveOrders,
  searchImapHeaders,
  upsertOrderAnalysis,
} from "../api";
import { getPythonPath } from "../browserStorage";
import { isTauriRuntime } from "../env";
import { extractEmailCode, imapAccountToSettings, normalizeMailboxEmail } from "../imapInbox";
import { credentialLoginEmail, normalizeEmailForMatch } from "../linkCredentialsByEmail";
import { buildAccountSessionLabel } from "../../modules/browserSessions/accountSessions";
import { resolveTimezoneForAccount } from "../../modules/browserSessions/fingerprint";
import { listRunningBrowserSessions } from "../../modules/browserSessions/launchSession";
import { formatProxyServer, resolveProxyForAccount } from "../../modules/browserSessions/proxyPool";
import type { Credential, ImapAccount, ParsedOrder } from "../types";
import { isCancelledOrder } from "./dashboard";
import { upsertParsedOrders } from "./merge";

const TARGET_OTP_SUBJECTS = [
  "verification code",
  "sign-in code",
  "one-time",
  "security code",
  "passcode",
  "your code",
  "target code",
];

export interface TargetCancelProgress {
  accountId: string;
  event: "status" | "need_otp" | "error" | string;
  message?: string;
  email?: string;
}

export interface TargetCancelOrderResult {
  orderId: string;
  cancelReason?: string | null;
  httpStatus?: number | null;
  needsLogin?: boolean | null;
  error?: string | null;
}

export interface TargetCancelFetchResult {
  ok: boolean;
  needsLogin?: boolean | null;
  loggedIn?: boolean | null;
  usedLogin?: boolean | null;
  error?: string | null;
  message?: string | null;
  orders: TargetCancelOrderResult[];
}

export interface TargetCancelFetchRequest {
  accountId: string;
  accountLabel: string;
  email: string;
  orderIds: string[];
  proxyServer?: string;
  timezone?: string;
  locale?: string;
  pythonPath?: string;
  allowLogin?: boolean;
}

export const TARGET_CANCEL_MANUAL_REASON = "Check reason manually";
const CANCEL_STAGGER_MIN_MS = 15_000;
const CANCEL_STAGGER_MAX_MS = 30_000;

export interface FetchTargetCancelReasonsOptions {
  /** When set (including `[]`), only these order numbers are fetched. Omit to backfill every missing reason. */
  orderIds?: string[];
  maxAccounts?: number;
  /** When false, never open Camoufox login — cookies only. */
  allowLogin?: boolean;
}

export interface FetchTargetCancelReasonsResult {
  orders: ParsedOrder[];
  fetched: number;
  accounts: number;
  status: string;
  tone: "ok" | "error";
}

/** Short Target copy for the timeline, e.g. "Policy - Item Demand" → "Item Demand". */
export function shortTargetCancelReason(reason?: string | null): string {
  const text = reason?.trim() ?? "";
  if (!text) return "";
  if (text === TARGET_CANCEL_MANUAL_REASON) return TARGET_CANCEL_MANUAL_REASON;
  return text.replace(/^policy\s*[-:]\s*/i, "").trim() || text;
}

export function formatCancelledStatus(order: Pick<ParsedOrder, "cancelReason">): string {
  const reason = shortTargetCancelReason(order.cancelReason);
  return reason ? `Cancelled - ${reason}` : "Cancelled";
}

export function isManualCancelReason(reason?: string | null): boolean {
  return reason?.trim() === TARGET_CANCEL_MANUAL_REASON;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function staggerMs(): number {
  return (
    CANCEL_STAGGER_MIN_MS +
    Math.floor(Math.random() * (CANCEL_STAGGER_MAX_MS - CANCEL_STAGGER_MIN_MS + 1))
  );
}

function withManualReasons(orders: ParsedOrder[], orderIds: Iterable<string>): ParsedOrder[] {
  const ids = new Set([...orderIds].map((id) => id.trim()).filter(Boolean));
  if (ids.size === 0) return orders;
  return orders.map((order) => {
    if (order.retailer !== "target" || !ids.has(order.orderId) || order.cancelReason?.trim()) {
      return order;
    }
    return { ...order, cancelReason: TARGET_CANCEL_MANUAL_REASON };
  });
}

function isTargetCredential(credential: Credential): boolean {
  return credential.site.trim().toLowerCase() === "target";
}

export function matchingTargetCredential(
  email: string,
  credentials: Credential[],
): Credential | undefined {
  const needle = normalizeEmailForMatch(email);
  if (!needle) return undefined;
  return credentials.find(
    (credential) =>
      isTargetCredential(credential) &&
      normalizeEmailForMatch(credentialLoginEmail(credential)) === needle,
  );
}

export function cancelledTargetOrdersMissingReason(orders: ParsedOrder[]): ParsedOrder[] {
  return orders.filter(
    (order) =>
      order.retailer === "target" && isCancelledOrder(order) && !order.cancelReason?.trim(),
  );
}

function applyCancelReasons(
  orders: ParsedOrder[],
  results: TargetCancelOrderResult[],
): { orders: ParsedOrder[]; fetched: number } {
  const reasons = new Map<string, string>();
  for (const result of results) {
    const reason = result.cancelReason?.trim();
    if (result.orderId && reason) reasons.set(result.orderId, reason);
  }
  if (reasons.size === 0) return { orders, fetched: 0 };
  const next = orders.map((order) => {
    if (order.retailer !== "target") return order;
    const reason = reasons.get(order.orderId);
    return reason ? { ...order, cancelReason: reason } : order;
  });
  return { orders: upsertParsedOrders([], next), fetched: reasons.size };
}

function looksLikeTargetOtp(message: {
  from?: string;
  fromEmail?: string;
  subject?: string;
  recipients?: string[];
}): boolean {
  const from = `${message.from ?? ""} ${message.fromEmail ?? ""}`.toLowerCase();
  const subject = (message.subject ?? "").toLowerCase();
  return from.includes("target.com") || subject.includes("target") || /code|otp|passcode|verify/.test(subject);
}

async function waitForTargetOtp(email: string, startedAt: number): Promise<string> {
  const needle = normalizeMailboxEmail(email);
  const accounts = await listImapAccounts();
  if (accounts.length === 0) {
    throw new Error("No IMAP accounts are configured to read the Target sign-in code.");
  }
  const deadline = Date.now() + 150_000;
  let lastError = "";
  while (Date.now() < deadline) {
    for (const account of accounts) {
      try {
        const code = await readLatestTargetOtp(account, needle, startedAt);
        if (code) return code;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  throw new Error(
    lastError
      ? `Timed out waiting for a Target email code. ${lastError}`
      : "Timed out waiting for a Target email sign-in code.",
  );
}

async function readLatestTargetOtp(
  account: ImapAccount,
  email: string,
  startedAt: number,
): Promise<string | undefined> {
  const headers = await searchImapHeaders(imapAccountToSettings(account), [...TARGET_OTP_SUBJECTS]);
  const newest = [...headers]
    .filter((message) => looksLikeTargetOtp(message))
    .filter((message) => {
      const recipients = (message.recipients ?? []).map(normalizeMailboxEmail);
      return (
        recipients.length === 0 ||
        recipients.includes(email) ||
        normalizeMailboxEmail(account.username) === email
      );
    })
    .sort((left, right) => (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0));
  for (const header of newest.slice(0, 5)) {
    const dateMs = Date.parse(header.date) || 0;
    if (dateMs && dateMs + 120_000 < startedAt) continue;
    const full = await fetchImapMessage(imapAccountToSettings(account), header.uid);
    const code = extractEmailCode(
      [full.subject, full.snippet, full.body, full.htmlBody].filter(Boolean).join("\n"),
    );
    if (code) return code;
  }
  return undefined;
}

async function fetchAccountCancelReasons(
  request: TargetCancelFetchRequest,
  onStatus?: (message: string) => void,
): Promise<TargetCancelFetchResult> {
  if (!isTauriRuntime()) {
    throw new Error("Target cancel reasons require the desktop app. Run npm run dev:app.");
  }

  const unlisten = await listen<TargetCancelProgress>("target-cancel-progress", async (event) => {
    const payload = event.payload;
    if (payload.accountId && payload.accountId !== request.accountId) return;
    if (payload.event === "status" && payload.message) {
      onStatus?.(payload.message);
    }
    if (payload.event === "need_otp") {
      onStatus?.(`Waiting for Target email code for ${payload.email || request.email}`);
      try {
        const code = await waitForTargetOtp(payload.email || request.email, Date.now());
        await invoke("submit_target_cancel_otp", {
          accountId: request.accountId,
          accountLabel: request.accountLabel,
          code,
        });
        onStatus?.("Submitting Target email code");
      } catch (error) {
        onStatus?.(error instanceof Error ? error.message : "Could not read the Target email code.");
      }
    }
  });

  try {
    return await invoke<TargetCancelFetchResult>("fetch_target_cancel_reasons", { request });
  } finally {
    unlisten();
  }
}

let cancelFetchChain: Promise<void> = Promise.resolve();

async function fetchTargetCancelReasonsLocked(
  orders: ParsedOrder[],
  onStatus: ((message: string) => void) | undefined,
  options: FetchTargetCancelReasonsOptions,
): Promise<FetchTargetCancelReasonsResult> {
  if (!isTauriRuntime()) {
    return {
      orders,
      fetched: 0,
      accounts: 0,
      status: "",
      tone: "ok",
    };
  }

  let next = upsertParsedOrders(await listOrders(), orders);

  const scoped = options.orderIds !== undefined;
  const wantedIds = new Set((options.orderIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (scoped && wantedIds.size === 0) {
    return {
      orders: next,
      fetched: 0,
      accounts: 0,
      status: "",
      tone: "ok",
    };
  }

  const missing = cancelledTargetOrdersMissingReason(next).filter(
    (order) => !scoped || wantedIds.has(order.orderId),
  );
  if (missing.length === 0) {
    return {
      orders: next,
      fetched: 0,
      accounts: 0,
      status: scoped ? "" : "Every cancelled Target order already has a cancel reason.",
      tone: "ok",
    };
  }

  const credentials = await listCredentials();
  const proxies = await listProxies();
  const assignments = await listProxyAssignments();
  const running = new Set(await listRunningBrowserSessions());
  const pythonPath = await getPythonPath();

  const grouped = new Map<string, ParsedOrder[]>();
  const unmatched: string[] = [];
  for (const order of missing) {
    const email = order.recipientEmail?.trim() || "";
    if (!email) {
      unmatched.push(order.orderId);
      continue;
    }
    const list = grouped.get(normalizeMailboxEmail(email)) ?? [];
    list.push(order);
    grouped.set(normalizeMailboxEmail(email), list);
  }

  next = withManualReasons(next, unmatched);
  if (unmatched.length > 0) {
    next = await saveAndReload(next);
  }

  let fetched = 0;
  let accounts = 0;
  const problems: string[] = [];
  const emailsTouched: string[] = [];
  const maxAccounts = options.maxAccounts ?? Number.POSITIVE_INFINITY;
  const groups = [...grouped.entries()];

  for (let index = 0; index < groups.length; index += 1) {
    if (accounts >= maxAccounts) break;
    const [email, group] = groups[index];
    const credential = matchingTargetCredential(email, credentials);
    const groupIds = group.map((order) => order.orderId);
    if (!credential) {
      problems.push(`No Target account for ${email}`);
      next = withManualReasons(next, groupIds);
      next = await saveAndReload(next);
      continue;
    }

    if (accounts > 0) {
      const wait = staggerMs();
      onStatus?.(`Waiting ${Math.round(wait / 1000)}s before the next Target account…`);
      await sleep(wait);
    }

    const proxy = resolveProxyForAccount(proxies, credential.id, assignments);
    const allowLogin = (options.allowLogin ?? true) && !running.has(credential.id);
    onStatus?.(
      `Checking ${group.length} cancelled Target order(s) for ${email}${
        proxy ? "" : " (no proxy assigned)"
      }`,
    );
    accounts += 1;
    emailsTouched.push(email);
    try {
      const result = await fetchAccountCancelReasons(
        {
          accountId: credential.id,
          accountLabel: buildAccountSessionLabel(credential),
          email: credentialLoginEmail(credential) || email,
          orderIds: groupIds,
          proxyServer: proxy ? formatProxyServer(proxy) : undefined,
          timezone: resolveTimezoneForAccount(credential.id),
          locale: "en-US",
          pythonPath,
          allowLogin,
        },
        onStatus,
      );
      const applied = applyCancelReasons(next, result.orders ?? []);
      next = applied.orders;
      fetched += applied.fetched;
      next = withManualReasons(next, groupIds);
      next = await saveAndReload(next);
      if (!result.ok && result.error) problems.push(`${email}: ${result.error}`);
      else if (result.needsLogin) problems.push(`${email}: sign in required`);
    } catch (error) {
      problems.push(`${email}: ${error instanceof Error ? error.message : String(error)}`);
      next = withManualReasons(next, groupIds);
      next = await saveAndReload(next);
    }
  }

  if (fetched > 0) {
    await staleAnalysisForEmails(emailsTouched);
  }

  const status =
    fetched > 0
      ? `Saved ${fetched} Target cancel reason(s) across ${accounts} account(s).${
          problems.length ? ` ${problems.slice(0, 3).join(" · ")}` : ""
        }`
      : accounts > 0 || unmatched.length > 0
        ? `Could not read Target cancel reasons. Showing "Check reason manually" where the lookup failed.${
            problems[0] ? ` ${problems[0]}` : ""
          }`
        : problems[0] || "";

  return {
    orders: next,
    fetched,
    accounts,
    status,
    tone: "ok",
  };
}

export async function fetchTargetCancelReasons(
  orders: ParsedOrder[],
  onStatus?: (message: string) => void,
  options: FetchTargetCancelReasonsOptions = {},
): Promise<FetchTargetCancelReasonsResult> {
  const run = cancelFetchChain.then(
    () => fetchTargetCancelReasonsLocked(orders, onStatus, options),
    () => fetchTargetCancelReasonsLocked(orders, onStatus, options),
  );
  cancelFetchChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function applyTargetCancelReasonsAfterRefresh(
  orders: ParsedOrder[],
  source: "button" | "auto",
  newCancelledOrderIds: string[] | undefined,
  onStatus?: (message: string) => void,
): Promise<FetchTargetCancelReasonsResult> {
  if (source === "auto") {
    return fetchTargetCancelReasons(orders, onStatus, {
      orderIds: newCancelledOrderIds ?? [],
      allowLogin: true,
    });
  }
  return fetchTargetCancelReasons(orders, onStatus, { allowLogin: true });
}

async function saveAndReload(orders: ParsedOrder[]): Promise<ParsedOrder[]> {
  await saveOrders(orders);
  return listOrders();
}

async function staleAnalysisForEmails(emails: string[]): Promise<void> {
  const keys = new Set(emails.map(normalizeMailboxEmail));
  if (keys.size === 0) return;
  try {
    const records = await listOrderAnalysis();
    await Promise.all(
      records
        .filter((record) => record.site === "target" && keys.has(normalizeMailboxEmail(record.email)))
        .map((record) => upsertOrderAnalysis({ ...record, cancelledAtCount: 0, promptVersion: 0 })),
    );
  } catch {
    // Analysis can refresh on the next Performance load.
  }
}
