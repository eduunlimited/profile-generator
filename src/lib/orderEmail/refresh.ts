import {
  fetchImapMessage,
  getImapMail,
  listImapAccounts,
  listOrders,
  saveOrders,
  searchImapHeaders,
} from "../api";
import { formatError } from "../errorUtils";
import { imapAccountToSettings, storedImapMessageKey } from "../imapInbox";
import type { ImapAccount, ParsedOrder, StoredImapMessage } from "../types";
import {
  extractTargetOrderIdMatchingLastFour,
  extractTargetPickupLastFour,
  isTargetPickupConfirmationText,
  resolveTargetOrderIdForLastFour,
  TARGET_SEARCH_SUBJECTS,
  type ClassifiedOrderMessage,
} from "./classify";
import {
  attachClassifiedEvents,
  classifyStoredMessage,
  finalizeParsedOrder,
  mergeClassifiedOrders,
  orderRecipientEmail,
  upsertParsedOrders,
} from "./merge";
import { extractOrderItems, extractOrderTotal, extractTrackingNumber } from "./parse";

export interface OrderRefreshResult {
  orders: ParsedOrder[];
  status: string;
  tone: "ok" | "error";
}

async function headersForAccount(account: ImapAccount): Promise<StoredImapMessage[]> {
  const stored = await getImapMail(account.id);
  const byKey = new Map(stored.map((message) => [storedImapMessageKey(message), message]));
  try {
    const searched = await searchImapHeaders(imapAccountToSettings(account), [...TARGET_SEARCH_SUBJECTS]);
    for (const message of searched) {
      const key = storedImapMessageKey(message);
      if (!byKey.has(key)) {
        byKey.set(key, {
          ...message,
          dateMs: Date.parse(message.date) || 0,
          fetchedAt: new Date().toISOString(),
          body: "",
          htmlBody: undefined,
        });
      }
    }
  } catch {
    // Stored headers still classify; SEARCH is a supplement for Hide My Email inboxes.
  }
  return [...byKey.values()];
}

function classifiedDateMs(message: StoredImapMessage): number {
  if (Number.isFinite(message.dateMs) && message.dateMs > 0) return message.dateMs;
  const parsed = Date.parse(message.date);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function classifyPickupMessage(
  account: ImapAccount,
  message: StoredImapMessage,
  knownOrderIds: Iterable<string>,
): Promise<ClassifiedOrderMessage | null> {
  const lastFour = extractTargetPickupLastFour(message.subject ?? "");
  if (!lastFour) return null;
  let body = message.body;
  let htmlBody = message.htmlBody;
  let snippet = message.snippet;
  let orderId = extractTargetOrderIdMatchingLastFour(
    lastFour,
    message.subject ?? "",
    snippet ?? "",
    body ?? "",
    htmlBody ?? "",
  );
  if (!orderId) {
    try {
      const full = await fetchImapMessage(imapAccountToSettings(account), message.uid);
      body = full.body;
      htmlBody = full.htmlBody;
      snippet = full.snippet;
      orderId = extractTargetOrderIdMatchingLastFour(
        lastFour,
        full.subject,
        snippet ?? "",
        body ?? "",
        htmlBody ?? "",
      );
    } catch {
      // Fall through to matching a unique existing order that ends in the same last four.
    }
  }
  if (!orderId) {
    orderId = resolveTargetOrderIdForLastFour(
      lastFour,
      knownOrderIds,
      message.subject ?? "",
      snippet ?? "",
      body ?? "",
      htmlBody ?? "",
    );
  }
  if (!orderId) return null;
  return {
    retailer: "target",
    kind: "picked_up",
    orderId,
    accountId: account.id,
    message: { ...message, body, htmlBody, snippet },
    dateMs: classifiedDateMs(message),
  };
}

async function fillOrderBodies(account: ImapAccount, orders: ParsedOrder[]): Promise<void> {
  const settings = imapAccountToSettings(account);
  for (const order of orders) {
    const confirmation = order.events.find((event) => event.kind === "placed" && event.accountId === account.id);
    const shipped = [...order.events]
      .reverse()
      .find((event) => event.kind === "shipped" && event.accountId === account.id);
    Object.assign(order, finalizeParsedOrder(order));
    const fetches: { eventUid: number; kind: "placed" | "shipped" }[] = [];
    if (confirmation && (order.total == null || !order.items?.length || !order.fulfillment)) {
      fetches.push({ eventUid: confirmation.uid, kind: "placed" });
    }
    if (shipped && !order.trackingNumber && order.status !== "cancelled" && order.fulfillment !== "pickup") {
      fetches.push({ eventUid: shipped.uid, kind: "shipped" });
    }
    for (const fetch of fetches) {
      try {
        const full = await fetchImapMessage(settings, fetch.eventUid);
        if (fetch.kind === "placed") {
          const html = full.htmlBody?.trim() || "";
          const text = [full.body, full.snippet, full.subject].filter(Boolean).join("\n");
          const total = extractOrderTotal(html || text);
          if (total != null) {
            order.total = total;
            order.currency = "USD";
          }
          // Prefer HTML; fall back to text so item qty is not double-counted.
          const items = extractOrderItems(html || text);
          if (items.length > 0) order.items = items;
          if (!order.recipientEmail) {
            order.recipientEmail = orderRecipientEmail(full, account.username);
          }
          if (isTargetPickupConfirmationText(html, text)) {
            order.fulfillment = "pickup";
          } else if (html || full.body?.trim()) {
            order.fulfillment = order.fulfillment ?? "delivery";
          }
        }
        if (fetch.kind === "shipped") {
          const html = full.htmlBody?.trim() || "";
          const text = [full.body, full.snippet, full.subject].filter(Boolean).join("\n");
          const tracking = extractTrackingNumber(order.orderId, html || text);
          if (tracking) order.trackingNumber = tracking;
        }
      } catch {
        // Keep the subject-derived row; amount/tracking stay empty until a later refresh.
      }
    }
    Object.assign(order, finalizeParsedOrder(order));
  }
}

export async function refreshTargetOrders(): Promise<OrderRefreshResult> {
  const existing = await listOrders();
  const accounts = await listImapAccounts();
  if (accounts.length === 0) {
    return {
      orders: existing,
      status: "Add an IMAP key in Mail before scanning orders.",
      tone: "error",
    };
  }

  const classified: ClassifiedOrderMessage[] = [];
  const pickupQueue: { account: ImapAccount; message: StoredImapMessage }[] = [];
  const loadedAccountIds = new Set<string>();
  const errors: string[] = [];
  for (const account of accounts) {
    try {
      const headers = await headersForAccount(account);
      for (const message of headers) {
        const item = classifyStoredMessage(account.id, message);
        if (item) {
          classified.push(item);
          continue;
        }
        if (extractTargetPickupLastFour(message.subject ?? "")) {
          pickupQueue.push({ account, message });
        }
      }
      loadedAccountIds.add(account.id);
    } catch (error) {
      errors.push(formatError(error, `Could not read mail for ${account.name || account.username}.`));
    }
  }

  const knownOrderIds = new Set([
    ...existing.map((order) => order.orderId),
    ...classified.map((item) => item.orderId),
  ]);
  for (const pending of pickupQueue) {
    try {
      const item = await classifyPickupMessage(pending.account, pending.message, knownOrderIds);
      if (item) {
        classified.push(item);
        knownOrderIds.add(item.orderId);
      }
    } catch (error) {
      errors.push(formatError(error, "Could not read a Target pickup email."));
    }
  }

  const scanned = mergeClassifiedOrders(classified);
  for (const account of accounts) {
    if (!loadedAccountIds.has(account.id)) continue;
    try {
      await fillOrderBodies(account, scanned);
    } catch (error) {
      errors.push(formatError(error, "Could not load order email bodies."));
    }
  }

  const orders = attachClassifiedEvents(upsertParsedOrders(existing, scanned), classified);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  for (const order of orders) {
    if (order.recipientEmail) continue;
    const accountId = order.events.find((event) => event.kind === "placed")?.accountId;
    const account = accountId ? accountsById.get(accountId) : undefined;
    const fallback = orderRecipientEmail({}, account?.username);
    if (fallback) order.recipientEmail = fallback;
  }
  await saveOrders(orders);
  const status = errors.length
    ? `Saved ${orders.length} Target order(s) with a confirmation. ${errors.join(" ")}`
    : scanned.length === 0
      ? "No Target confirmation emails found in the loaded mail."
      : `Loaded ${orders.length} Target order(s) that have a confirmation email.`;
  return { orders, status, tone: errors.length ? "error" : "ok" };
}
