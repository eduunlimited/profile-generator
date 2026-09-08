import {
  fetchImapMessage,
  fetchImapMessages,
  getImapMail,
  listImapAccounts,
  saveImapMail,
  listOrders,
  saveOrders,
  searchImapHeaders,
} from "../api";
import { formatError } from "../errorUtils";
import { imapAccountToSettings, storedImapMessageKey, toStoredImapHeaders } from "../imapInbox";
import type { ImapAccount, ParsedOrder, StoredImapMessage } from "../types";
import {
  classifyPokemonCenterMessage,
  extractTargetPickupLastFour,
  isTargetPickupSubject,
  isPokemonCenterOrderSubject,
  isTargetPickupConfirmationText,
  resolveTargetOrderIdForLastFour,
  ORDER_SEARCH_SUBJECTS,
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
import { extractOrderItems, extractOrderTotal, extractTrackingNumber, itemsLookIncomplete, mergeOrderItems } from "./parse";

export interface OrderRefreshResult {
  orders: ParsedOrder[];
  status: string;
  tone: "ok" | "error";
}

async function headersForAccount(account: ImapAccount): Promise<StoredImapMessage[]> {
  const stored = await getImapMail(account.id);
  const byKey = new Map(stored.map((message) => [storedImapMessageKey(message), message]));
  let added = 0;
  try {
    const searched = await searchImapHeaders(imapAccountToSettings(account), [...ORDER_SEARCH_SUBJECTS]);
    for (const message of searched) {
      const key = storedImapMessageKey(message);
      if (byKey.has(key)) continue;
      byKey.set(key, toStoredImapHeaders(message));
      added += 1;
    }
  } catch {
    // Stored headers still classify; SEARCH is a supplement for Hide My Email inboxes.
  }
  const headers = [...byKey.values()];
  if (added > 0) {
    try {
      await saveImapMail(account.id, headers);
    } catch {
      // Classification can still use in-memory search hits this refresh.
    }
  }
  return headers;
}

function classifiedDateMs(message: StoredImapMessage): number {
  if (Number.isFinite(message.dateMs) && message.dateMs > 0) return message.dateMs;
  const parsed = Date.parse(message.date);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classifyPickupFromParts(
  account: ImapAccount,
  message: StoredImapMessage,
  knownOrderIds: Iterable<string>,
  ...parts: string[]
): ClassifiedOrderMessage | null {
  const lastFour = extractTargetPickupLastFour(message.subject ?? "");
  if (!lastFour) return null;
  const orderId = resolveTargetOrderIdForLastFour(lastFour, knownOrderIds, message.subject ?? "", ...parts);
  if (!orderId) return null;
  return {
    retailer: "target",
    kind: "picked_up",
    orderId,
    accountId: account.id,
    message: {
      ...message,
      snippet: message.snippet || `Order #: ${orderId}. Your order was picked up.`,
    },
    dateMs: classifiedDateMs(message),
  };
}

async function rememberPickupSnippets(accountId: string, items: ClassifiedOrderMessage[]): Promise<void> {
  if (items.length === 0) return;
  const stored = await getImapMail(accountId);
  const byKey = new Map(stored.map((message) => [storedImapMessageKey(message), message]));
  let changed = false;
  for (const item of items) {
    const snippet = `Order #: ${item.orderId}. Your order was picked up.`;
    const key = storedImapMessageKey(item.message);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(
        key,
        toStoredImapHeaders({
          uid: item.message.uid,
          messageId: item.message.messageId,
          date: item.message.date,
          subject: item.message.subject ?? "",
          from: "",
          to: "",
          recipients: item.message.recipients ?? [],
          snippet,
          body: "",
        }),
      );
      changed = true;
      continue;
    }
    if (existing.snippet?.includes(`Order #: ${item.orderId}`)) continue;
    byKey.set(key, { ...existing, snippet });
    changed = true;
  }
  if (changed) await saveImapMail(accountId, [...byKey.values()]);
}

function classifyPokemonCenterFromParts(
  account: ImapAccount,
  message: StoredImapMessage,
  ...parts: string[]
): ClassifiedOrderMessage | null {
  const classified = classifyPokemonCenterMessage(message.subject ?? "", ...parts);
  if (!classified) return null;
  return {
    retailer: "pokemon-center",
    kind: classified.kind,
    orderId: classified.orderId,
    accountId: account.id,
    message: {
      ...message,
      body: parts.find((part) => part && !/<[a-z][\s\S]*>/i.test(part)) ?? message.body,
      htmlBody: parts.find((part) => /<[a-z][\s\S]*>/i.test(part)) ?? message.htmlBody,
      snippet: message.snippet || `Order Number: ${classified.orderId}`,
    },
    dateMs: classifiedDateMs(message),
  };
}

async function rememberPokemonCenterSnippets(
  accountId: string,
  items: ClassifiedOrderMessage[],
): Promise<void> {
  if (items.length === 0) return;
  const stored = await getImapMail(accountId);
  const byKey = new Map(items.map((item) => [item.message.uid, `Order Number: ${item.orderId}`]));
  let changed = false;
  const next = stored.map((message) => {
    const snippet = byKey.get(message.uid);
    if (!snippet || message.snippet?.includes(snippet)) return message;
    changed = true;
    return { ...message, snippet };
  });
  if (changed) await saveImapMail(accountId, next);
}

async function fillOrderBodies(account: ImapAccount, orders: ParsedOrder[]): Promise<void> {
  const settings = imapAccountToSettings(account);
  for (const order of orders) {
    const confirmation = order.events.find((event) => event.kind === "placed" && event.accountId === account.id);
    const pickedUp = order.events.find((event) => event.kind === "picked_up" && event.accountId === account.id);
    const shipped = [...order.events]
      .reverse()
      .find((event) => event.kind === "shipped" && event.accountId === account.id);
    Object.assign(order, finalizeParsedOrder(order));
    const fetches: { eventUid: number; kind: "placed" | "picked_up" | "shipped" }[] = [];
    if (confirmation && (order.total == null || itemsLookIncomplete(order.items) || !order.fulfillment)) {
      fetches.push({ eventUid: confirmation.uid, kind: "placed" });
    }
    if (pickedUp && itemsLookIncomplete(order.items)) {
      fetches.push({ eventUid: pickedUp.uid, kind: "picked_up" });
    }
    if (shipped && !order.trackingNumber && order.status !== "cancelled" && order.fulfillment !== "pickup") {
      fetches.push({ eventUid: shipped.uid, kind: "shipped" });
    }
    for (const fetch of fetches) {
      try {
        const full = await fetchImapMessage(settings, fetch.eventUid);
        if (fetch.kind === "placed" || fetch.kind === "picked_up") {
          const html = full.htmlBody?.trim() || "";
          const text = [full.body, full.snippet, full.subject].filter(Boolean).join("\n");
          if (fetch.kind === "placed") {
            const total = extractOrderTotal(html || text);
            if (total != null) {
              order.total = total;
              order.currency = "USD";
            }
            if (!order.recipientEmail) {
              order.recipientEmail = orderRecipientEmail(full, account.username);
            }
            if (order.retailer === "target" && isTargetPickupConfirmationText(html, text)) {
              order.fulfillment = "pickup";
            } else if (html || full.body?.trim()) {
              order.fulfillment = order.fulfillment ?? "delivery";
            }
          }
          const items = extractOrderItems(html || text);
          if (items.length > 0) order.items = mergeOrderItems(order.items, items);
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
  const pokemonQueue: { account: ImapAccount; message: StoredImapMessage }[] = [];
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
        if (isTargetPickupSubject(message.subject ?? "")) {
          pickupQueue.push({ account, message });
        } else if (isPokemonCenterOrderSubject(message.subject ?? "")) {
          pokemonQueue.push({ account, message });
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
  const pickupByAccount = new Map<string, { account: ImapAccount; messages: StoredImapMessage[] }>();
  for (const pending of pickupQueue) {
    const group = pickupByAccount.get(pending.account.id) ?? { account: pending.account, messages: [] };
    group.messages.push(pending.message);
    pickupByAccount.set(pending.account.id, group);
  }
  for (const { account, messages } of pickupByAccount.values()) {
    const already: ClassifiedOrderMessage[] = [];
    const needsFetch: StoredImapMessage[] = [];
    for (const message of messages) {
      const item = classifyPickupFromParts(
        account,
        message,
        knownOrderIds,
        message.snippet ?? "",
        message.body ?? "",
        message.htmlBody ?? "",
      );
      if (item) {
        already.push(item);
        knownOrderIds.add(item.orderId);
      } else {
        needsFetch.push(message);
      }
    }
    classified.push(...already);
    if (needsFetch.length === 0) {
      await rememberPickupSnippets(account.id, already);
      continue;
    }
    try {
      const fetched = await fetchImapMessages(
        imapAccountToSettings(account),
        needsFetch.map((message) => message.uid),
      );
      const byUid = new Map(fetched.map((message) => [message.uid, message]));
      const found: ClassifiedOrderMessage[] = [];
      for (const message of needsFetch) {
        const full = byUid.get(message.uid);
        const item = classifyPickupFromParts(
          account,
          full ? { ...message, ...full, dateMs: classifiedDateMs(message) } : message,
          knownOrderIds,
          full?.subject ?? message.subject ?? "",
          full?.snippet ?? "",
          full?.body ?? "",
          full?.htmlBody ?? "",
        );
        if (item) {
          found.push(item);
          knownOrderIds.add(item.orderId);
        }
      }
      classified.push(...found);
      await rememberPickupSnippets(account.id, [...already, ...found]);
      if (found.length < needsFetch.length) {
        errors.push(
          `Found ${needsFetch.length} Target pickup email(s) but could not match ${needsFetch.length - found.length} to an order number.`,
        );
      }
    } catch (error) {
      errors.push(formatError(error, "Could not read Target pickup emails."));
      await rememberPickupSnippets(account.id, already);
    }
  }
  const pokemonByAccount = new Map<string, { account: ImapAccount; messages: StoredImapMessage[] }>();
  for (const pending of pokemonQueue) {
    const group = pokemonByAccount.get(pending.account.id) ?? { account: pending.account, messages: [] };
    group.messages.push(pending.message);
    pokemonByAccount.set(pending.account.id, group);
  }
  for (const { account, messages } of pokemonByAccount.values()) {
    const already: ClassifiedOrderMessage[] = [];
    const needsFetch: StoredImapMessage[] = [];
    for (const message of messages) {
      const item = classifyPokemonCenterFromParts(
        account,
        message,
        message.snippet ?? "",
        message.body ?? "",
        message.htmlBody ?? "",
      );
      if (item) already.push(item);
      else needsFetch.push(message);
    }
    classified.push(...already);
    if (needsFetch.length === 0) {
      await rememberPokemonCenterSnippets(account.id, already);
      continue;
    }
    try {
      const fetched = await fetchImapMessages(
        imapAccountToSettings(account),
        needsFetch.map((message) => message.uid),
      );
      const byUid = new Map(fetched.map((message) => [message.uid, message]));
      const found: ClassifiedOrderMessage[] = [];
      for (const message of needsFetch) {
        const full = byUid.get(message.uid);
        const item = classifyPokemonCenterFromParts(
          account,
          full ? { ...message, ...full, dateMs: classifiedDateMs(message) } : message,
          full?.subject ?? message.subject ?? "",
          full?.snippet ?? "",
          full?.body ?? "",
          full?.htmlBody ?? "",
        );
        if (item) found.push(item);
      }
      classified.push(...found);
      await rememberPokemonCenterSnippets(account.id, [...already, ...found]);
      if (found.length === 0) {
        errors.push(
          `Found ${needsFetch.length} Pokemon Center order email(s) but could not read Order Number: P… from the body.`,
        );
      }
    } catch (error) {
      errors.push(formatError(error, "Could not read Pokemon Center order emails."));
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
    ? `Saved ${orders.length} order(s) with a confirmation. ${errors.join(" ")}`
    : scanned.length === 0
      ? "No Target or Pokemon Center confirmation emails found in the loaded mail."
      : `Loaded ${orders.length} order(s) that have a confirmation email.`;
  return { orders, status, tone: errors.length ? "error" : "ok" };
}
