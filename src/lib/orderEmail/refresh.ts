import {
  fetchImapMessages,
  getImapMail,
  listImapAccounts,
  saveImapMail,
  listOrders,
  saveOrders,
  withoutDismissedOrders,
  searchImapHeaders,
} from "../api";
import { formatError } from "../errorUtils";
import { isForwardedSubject, orderMessageDate, originalForwardDateMs } from "./forward";
import { foldStoredImapMessages, imapAccountToSettings, storedImapAliasKeys, toStoredImapHeaders } from "../imapInbox";
import type { ImapAccount, ImapMessage, OrderEvent, ParsedOrder, StoredImapMessage } from "../types";
import {
  classifyPokemonCenterMessage,
  extractTargetManualCancelLastFour,
  extractTargetPickupLastFour,
  isTargetManualCancelSubject,
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
import { isCancelledOrder } from "./dashboard";
import {
  detectCarrier,
  detectCarrierFromText,
} from "./carrier";
import {
  extractOrderItems,
  extractOrderTotal,
  extractOrderShippingAddress,
  extractTargetOrderPayment,
  itemsLookIncomplete,
  mergeOrderAddress,
  mergeOrderItems,
  mergeOrderPayment,
  shipmentHintsFromText,
} from "./parse";

export interface OrderRefreshResult {
  orders: ParsedOrder[];
  status: string;
  tone: "ok" | "error";
  /** Target orders that became cancelled on this scan and still have no cancel reason. */
  newCancelledOrderIds: string[];
}

async function headersForAccount(account: ImapAccount): Promise<StoredImapMessage[]> {
  const stored = foldStoredImapMessages(await getImapMail(account.id));
  const beforeCount = stored.length;
  const lastUid = stored.reduce((max, message) => Math.max(max, message.uid || 0), 0);
  const headers = foldStoredImapMessages([
    ...stored,
    ...(await (async () => {
      try {
        const searched = await searchImapHeaders(
          imapAccountToSettings(account),
          [...ORDER_SEARCH_SUBJECTS],
          lastUid,
        );
        return searched.map((message) => toStoredImapHeaders(message));
      } catch {
        if (lastUid > 0) {
          try {
            const searched = await searchImapHeaders(imapAccountToSettings(account), [...ORDER_SEARCH_SUBJECTS]);
            return searched.map((message) => toStoredImapHeaders(message));
          } catch {
            return [] as StoredImapMessage[];
          }
        }
        // Stored headers still classify; SEARCH is a supplement for Hide My Email inboxes.
        return [] as StoredImapMessage[];
      }
    })()),
  ]);
  const added = Math.max(0, headers.length - beforeCount);
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
  return orderMessageDate(message).dateMs;
}

function forwardNeedsBody(message: StoredImapMessage): boolean {
  if ((message.body ?? "").trim()) return false;
  return (
    isForwardedSubject(message.subject ?? "") ||
    /forwarded message|begin forwarded message|original message/i.test(
      `${message.subject ?? ""}\n${message.snippet ?? ""}`,
    )
  );
}

async function rememberPlainBodies(accountId: string, messages: ImapMessage[]): Promise<void> {
  const useful = messages.filter((message) => message.body?.trim());
  if (useful.length === 0) return;
  const stored = await getImapMail(accountId);
  const byUid = new Map(useful.map((message) => [message.uid, message]));
  let changed = false;
  const next = stored.map((message) => {
    const full = byUid.get(message.uid);
    if (!full?.body?.trim() || message.body?.trim()) return message;
    changed = true;
    byUid.delete(message.uid);
    return {
      ...message,
      body: full.body,
      snippet: message.snippet?.trim() || full.snippet || message.snippet,
    };
  });
  for (const full of byUid.values()) {
    if (stored.some((message) => message.uid === full.uid)) continue;
    next.push(
      toStoredImapHeaders({
        ...full,
        from: full.from ?? "",
        to: full.to ?? "",
        recipients: full.recipients ?? [],
        subject: full.subject ?? "",
        snippet: full.snippet ?? "",
        body: full.body ?? "",
        date: full.date ?? "",
      }),
    );
    changed = true;
  }
  if (changed) await saveImapMail(accountId, next);
}

function applyForwardedEventDate(order: ParsedOrder, uid: number, subject: string, ...parts: string[]): void {
  const original = originalForwardDateMs(subject, ...parts);
  if (!original) return;
  applyOriginalEventDate(order, uid, original);
}

function applyOriginalEventDate(order: ParsedOrder, uid: number, original: number): boolean {
  let changed = false;
  order.events = order.events.map((event) => {
    if (event.uid !== uid || (event.dateMs > 0 && original + 60_000 >= event.dateMs)) return event;
    changed = true;
    return { ...event, date: new Date(original).toISOString(), dateMs: original };
  });
  if (!changed) return false;
  const placed = order.events.filter((event) => event.kind === "placed" && event.dateMs > 0);
  if (placed.length > 0) {
    order.placedAt = new Date(Math.min(...placed.map((event) => event.dateMs))).toISOString();
  }
  return true;
}

function cachedForwardParts(message: StoredImapMessage | undefined): string[] {
  if (!message) return [];
  return [message.subject ?? "", message.snippet ?? "", message.body ?? "", message.htmlBody ?? ""];
}

/** Rewrite saved forward events from the original send time. Same order number stays one order. */
async function reconcileForwardedOrders(account: ImapAccount, orders: ParsedOrder[]): Promise<void> {
  const targets: { order: ParsedOrder; event: OrderEvent }[] = [];
  for (const order of orders) {
    for (const event of order.events) {
      if (event.accountId !== account.id || !event.uid || !isForwardedSubject(event.subject)) continue;
      targets.push({ order, event });
    }
  }
  if (targets.length === 0) return;
  const storedByUid = new Map((await getImapMail(account.id)).map((message) => [message.uid, message]));
  const partsByUid = new Map<number, string[]>();
  const pending = new Set<number>();
  for (const target of targets) {
    const cached = storedByUid.get(target.event.uid);
    const parts = cachedForwardParts(cached);
    const cachedOriginal = originalForwardDateMs(target.event.subject, ...parts);
    if (cachedOriginal) {
      partsByUid.set(target.event.uid, parts);
      continue;
    }
    const wrapperMs = cached?.dateMs && cached.dateMs > 0 ? cached.dateMs : 0;
    if (wrapperMs > 0 && target.event.dateMs > 0 && target.event.dateMs + 60_000 < wrapperMs) continue;
    pending.add(target.event.uid);
  }
  if (pending.size > 0) {
    const fetched = await fetchImapMessages(imapAccountToSettings(account), [...pending]);
    await rememberPlainBodies(account.id, fetched);
    for (const message of fetched) {
      partsByUid.set(message.uid, [
        message.subject ?? "",
        message.snippet ?? "",
        message.body ?? "",
        message.htmlBody ?? "",
      ]);
    }
  }
  const touched = new Set<ParsedOrder>();
  for (const target of targets) {
    const parts = partsByUid.get(target.event.uid);
    if (!parts) continue;
    const original = originalForwardDateMs(target.event.subject, ...parts);
    if (!original) continue;
    if (applyOriginalEventDate(target.order, target.event.uid, original)) touched.add(target.order);
  }
  for (const order of touched) {
    const next = finalizeParsedOrder(order);
    order.events = next.events;
    order.status = next.status;
    order.fulfillment = next.fulfillment;
  }
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

function classifyManualCancelFromParts(
  account: ImapAccount,
  message: StoredImapMessage,
  knownOrderIds: Iterable<string>,
  ...parts: string[]
): ClassifiedOrderMessage | null {
  const lastFour = extractTargetManualCancelLastFour(message.subject ?? "");
  if (!lastFour) return null;
  const orderId = resolveTargetOrderIdForLastFour(lastFour, knownOrderIds, message.subject ?? "", ...parts);
  if (!orderId) return null;
  return {
    retailer: "target",
    kind: "manual_cancel",
    orderId,
    accountId: account.id,
    message: {
      ...message,
      snippet: message.snippet || `Order #: ${orderId}. You've successfully canceled items.`,
    },
    dateMs: classifiedDateMs(message),
  };
}

async function rememberManualCancelSnippets(accountId: string, items: ClassifiedOrderMessage[]): Promise<void> {
  if (items.length === 0) return;
  const result = foldStoredImapMessages(await getImapMail(accountId));
  let changed = false;
  for (const item of items) {
    const snippet = `Order #: ${item.orderId}. You've successfully canceled items.`;
    const aliases = new Set(storedImapAliasKeys(item.message));
    const existing = result.find((message) => storedImapAliasKeys(message).some((key) => aliases.has(key)));
    if (!existing) {
      result.push(
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
    result[result.indexOf(existing)] = { ...existing, snippet };
    changed = true;
  }
  if (changed) await saveImapMail(accountId, foldStoredImapMessages(result));
}

async function rememberPickupSnippets(accountId: string, items: ClassifiedOrderMessage[]): Promise<void> {
  if (items.length === 0) return;
  const result = foldStoredImapMessages(await getImapMail(accountId));
  let changed = false;
  for (const item of items) {
    const snippet = `Order #: ${item.orderId}. Your order was picked up.`;
    const aliases = new Set(storedImapAliasKeys(item.message));
    const existing = result.find((message) => storedImapAliasKeys(message).some((key) => aliases.has(key)));
    if (!existing) {
      result.push(
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
    result[result.indexOf(existing)] = { ...existing, snippet };
    changed = true;
  }
  if (changed) await saveImapMail(accountId, foldStoredImapMessages(result));
}

function classifyPokemonCenterFromParts(
  account: ImapAccount,
  message: StoredImapMessage,
  ...parts: string[]
): ClassifiedOrderMessage | null {
  const classified = classifyPokemonCenterMessage(message.subject ?? "", ...parts);
  if (!classified) return null;
  const dated = orderMessageDate({
    ...message,
    body: [message.body, ...parts].filter(Boolean).join("\n"),
  });
  return {
    retailer: "pokemon-center",
    kind: classified.kind,
    orderId: classified.orderId,
    accountId: account.id,
    message: {
      ...message,
      date: dated.date || message.date,
      body: parts.find((part) => part && !/<[a-z][\s\S]*>/i.test(part)) ?? message.body,
      htmlBody: parts.find((part) => /<[a-z][\s\S]*>/i.test(part)) ?? message.htmlBody,
      snippet: message.snippet || `Order Number: ${classified.orderId}`,
    },
    dateMs: dated.dateMs,
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
  const fetches: { order: ParsedOrder; eventUid: number; kind: "placed" | "picked_up" | "shipped" }[] = [];
  for (const order of orders) {
    const confirmation = order.events.find((event) => event.kind === "placed" && event.accountId === account.id);
    const pickedUp = order.events.find((event) => event.kind === "picked_up" && event.accountId === account.id);
    const shipped = [...order.events]
      .reverse()
      .find(
        (event) =>
          (event.kind === "shipped" || event.kind === "in_transit") && event.accountId === account.id,
      );
    Object.assign(order, finalizeParsedOrder(order));
    const missingAddress = !order.shippingAddress?.line1 && !order.shippingAddress?.raw;
    if (
      confirmation &&
      (order.total == null ||
        itemsLookIncomplete(order.items) ||
        !order.fulfillment ||
        ((order.retailer === "target" || order.retailer === "pokemon-center") && missingAddress) ||
        (order.retailer === "target" && !order.payment?.raw))
    ) {
      fetches.push({ order, eventUid: confirmation.uid, kind: "placed" });
    }
    if (pickedUp && itemsLookIncomplete(order.items)) {
      fetches.push({ order, eventUid: pickedUp.uid, kind: "picked_up" });
    }
    const needsShipmentHints =
      order.status !== "cancelled" &&
      order.fulfillment !== "pickup" &&
      (order.status === "shipped" || Boolean(shipped)) &&
      (!order.trackingNumber || !order.expectedDelivery || !order.carrier);
    if (shipped && needsShipmentHints) {
      fetches.push({ order, eventUid: shipped.uid, kind: "shipped" });
    }
  }
  if (fetches.length === 0) return;
  const storedByUid = new Map((await getImapMail(account.id)).map((message) => [message.uid, message]));
  const pending = fetches.filter((item) => !storedByUid.get(item.eventUid)?.body?.trim());
  const bodies = new Map<number, { subject?: string; snippet?: string; body?: string; htmlBody?: string; recipients?: string[]; to?: string }>();
  for (const item of fetches) {
    const cached = storedByUid.get(item.eventUid);
    if (cached?.body?.trim()) bodies.set(item.eventUid, cached);
  }
  if (pending.length > 0) {
    try {
      const fetched = await fetchImapMessages(
        settings,
        pending.map((item) => item.eventUid),
      );
      await rememberPlainBodies(account.id, fetched);
      for (const message of fetched) bodies.set(message.uid, message);
    } catch {
      // Stored excerpts still apply. Missing messages wait for a later refresh.
    }
  }
  for (const fetch of fetches) {
    const full = bodies.get(fetch.eventUid);
    if (!full) continue;
    const order = fetch.order;
    const html = full.htmlBody?.trim() || "";
    const text = [full.body, full.snippet, full.subject].filter(Boolean).join("\n");
    applyForwardedEventDate(order, fetch.eventUid, full.subject ?? "", html, text);
    if (fetch.kind === "placed" || fetch.kind === "picked_up") {
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
        const address = extractOrderShippingAddress(order.retailer, html || text);
        if (address) order.shippingAddress = mergeOrderAddress(address, order.shippingAddress);
        if (order.retailer === "target") {
          const payment = extractTargetOrderPayment(html || text);
          if (payment) order.payment = mergeOrderPayment(payment, order.payment);
        }
      }
      const items = extractOrderItems(html || text);
      if (items.length > 0) order.items = mergeOrderItems(order.items, items);
    }
    if (fetch.kind === "shipped") {
      const hints = shipmentHintsFromText(order.orderId, html || text);
      if (hints.tracking) order.trackingNumber = hints.tracking;
      order.carrier =
        hints.carrier ??
        detectCarrierFromText(html || text, hints.tracking ?? order.trackingNumber) ??
        detectCarrier(hints.tracking ?? order.trackingNumber) ??
        order.carrier;
      if (hints.expectedDelivery) {
        order.expectedDelivery = hints.expectedDelivery;
        order.expectedDeliverySource = "email";
      }
    }
  }
  for (const order of orders) {
    Object.assign(order, finalizeParsedOrder(order));
  }
}

function emptyRefresh(orders: ParsedOrder[], status: string, tone: "ok" | "error"): OrderRefreshResult {
  return { orders, status, tone, newCancelledOrderIds: [] };
}

function newlyCancelledTargetIds(before: ParsedOrder[], after: ParsedOrder[]): string[] {
  const wasCancelled = new Set(
    before
      .filter((order) => order.retailer === "target" && isCancelledOrder(order))
      .map((order) => order.id),
  );
  return after
    .filter(
      (order) =>
        order.retailer === "target" &&
        isCancelledOrder(order) &&
        !wasCancelled.has(order.id) &&
        !order.cancelReason?.trim(),
    )
    .map((order) => order.orderId);
}

let inflightOrderRefresh: Promise<OrderRefreshResult> | null = null;

export function refreshTargetOrders(onStatus?: (message: string) => void): Promise<OrderRefreshResult> {
  if (!inflightOrderRefresh) {
    inflightOrderRefresh = refreshTargetOrdersInner(onStatus).finally(() => {
      inflightOrderRefresh = null;
    });
  }
  return inflightOrderRefresh;
}

async function refreshTargetOrdersInner(onStatus?: (message: string) => void): Promise<OrderRefreshResult> {
  const existing = await listOrders();
  const accounts = await listImapAccounts();
  if (accounts.length === 0) {
    return emptyRefresh(existing, "Add an IMAP key in Mail before scanning orders.", "error");
  }

  const classified: ClassifiedOrderMessage[] = [];
  const pickupQueue: { account: ImapAccount; message: StoredImapMessage }[] = [];
  const forwardQueue: { account: ImapAccount; message: StoredImapMessage; index: number }[] = [];
  const manualCancelQueue: { account: ImapAccount; message: StoredImapMessage }[] = [];
  const pokemonQueue: { account: ImapAccount; message: StoredImapMessage }[] = [];
  const loadedAccountIds = new Set<string>();
  const errors: string[] = [];
  for (const [index, account] of accounts.entries()) {
    onStatus?.(`Checking mailbox ${index + 1} of ${accounts.length}…`);
    try {
      const headers = await headersForAccount(account);
      for (const message of headers) {
        const item = classifyStoredMessage(account.id, message);
        if (item) {
          classified.push(item);
          if (forwardNeedsBody(message)) {
            forwardQueue.push({ account, message, index: classified.length - 1 });
          }
          continue;
        }
        if (isTargetPickupSubject(message.subject ?? "")) {
          pickupQueue.push({ account, message });
        } else if (isTargetManualCancelSubject(message.subject ?? "")) {
          manualCancelQueue.push({ account, message });
        } else if (isPokemonCenterOrderSubject(message.subject ?? "")) {
          pokemonQueue.push({ account, message });
        }
      }
      loadedAccountIds.add(account.id);
    } catch (error) {
      errors.push(formatError(error, `Could not read mail for ${account.name || account.username}.`));
    }
  }

  const forwardByAccount = new Map<string, { account: ImapAccount; items: typeof forwardQueue }>();
  for (const pending of forwardQueue) {
    const group = forwardByAccount.get(pending.account.id) ?? { account: pending.account, items: [] };
    group.items.push(pending);
    forwardByAccount.set(pending.account.id, group);
  }
  for (const { account, items } of forwardByAccount.values()) {
    try {
      const fetched = await fetchImapMessages(
        imapAccountToSettings(account),
        items.map((item) => item.message.uid),
      );
      const byUid = new Map(fetched.map((message) => [message.uid, message]));
      await rememberPlainBodies(account.id, fetched);
      for (const pending of items) {
        const full = byUid.get(pending.message.uid);
        if (!full) continue;
        const again = classifyStoredMessage(account.id, {
          ...pending.message,
          ...full,
          dateMs: pending.message.dateMs,
        });
        if (again) classified[pending.index] = again;
      }
    } catch (error) {
      errors.push(formatError(error, "Could not read forwarded order emails."));
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
      await rememberPlainBodies(account.id, fetched);
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
  const manualCancelByAccount = new Map<string, { account: ImapAccount; messages: StoredImapMessage[] }>();
  for (const pending of manualCancelQueue) {
    const group = manualCancelByAccount.get(pending.account.id) ?? { account: pending.account, messages: [] };
    group.messages.push(pending.message);
    manualCancelByAccount.set(pending.account.id, group);
  }
  for (const { account, messages } of manualCancelByAccount.values()) {
    const already: ClassifiedOrderMessage[] = [];
    const needsFetch: StoredImapMessage[] = [];
    for (const message of messages) {
      const item = classifyManualCancelFromParts(
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
      await rememberManualCancelSnippets(account.id, already);
      continue;
    }
    try {
      const fetched = await fetchImapMessages(
        imapAccountToSettings(account),
        needsFetch.map((message) => message.uid),
      );
      await rememberPlainBodies(account.id, fetched);
      const byUid = new Map(fetched.map((message) => [message.uid, message]));
      const found: ClassifiedOrderMessage[] = [];
      for (const message of needsFetch) {
        const full = byUid.get(message.uid);
        const item = classifyManualCancelFromParts(
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
      await rememberManualCancelSnippets(account.id, [...already, ...found]);
      if (found.length < needsFetch.length) {
        errors.push(
          `Found ${needsFetch.length} Target manual cancel email(s) but could not match ${needsFetch.length - found.length} to an order number.`,
        );
      }
    } catch (error) {
      errors.push(formatError(error, "Could not read Target manual cancel emails."));
      await rememberManualCancelSnippets(account.id, already);
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
      await rememberPlainBodies(account.id, fetched);
      const byUid = new Map(fetched.map((message) => [message.uid, message]));
      const found: ClassifiedOrderMessage[] = [];
      for (const message of needsFetch) {
        const full = byUid.get(message.uid);
        const item = classifyPokemonCenterFromParts(
          account,
          full ? { ...message, ...full } : message,
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
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const withRecipientFallback = (rows: ParsedOrder[]): ParsedOrder[] => {
    for (const order of rows) {
      if (order.recipientEmail) continue;
      const accountId = order.events.find((event) => event.kind === "placed")?.accountId;
      const account = accountId ? accountsById.get(accountId) : undefined;
      const fallback = orderRecipientEmail({}, account?.username);
      if (fallback) order.recipientEmail = fallback;
    }
    return rows;
  };
  const persistOrders = async (incoming: ParsedOrder[]): Promise<ParsedOrder[]> => {
    const rows = withRecipientFallback(
      attachClassifiedEvents(upsertParsedOrders(existing, incoming), classified),
    );
    return saveOrders(rows);
  };

  // Write confirmation rows before the slow per-message body fetches so a
  // closed tab or failed IMAP body load does not drop newly found orders.
  let orders = await persistOrders(scanned);
  onStatus?.("Reading order email details…");
  for (const account of accounts) {
    if (!loadedAccountIds.has(account.id)) continue;
    try {
      await fillOrderBodies(account, orders);
    } catch (error) {
      errors.push(formatError(error, "Could not load order email bodies."));
    }
    try {
      await reconcileForwardedOrders(account, orders);
    } catch (error) {
      errors.push(formatError(error, "Could not read the original date from forwarded order emails."));
    }
  }
  orders = await withoutDismissedOrders(await saveOrders(orders));
  const status = errors.length
    ? `Saved ${orders.length} order(s) with a confirmation. ${errors.join(" ")}`
    : scanned.length === 0
      ? "No Target or Pokemon Center confirmation emails found in the loaded mail."
      : `Loaded ${orders.length} order(s) that have a confirmation email.`;
  return {
    orders,
    status,
    tone: errors.length ? "error" : "ok",
    newCancelledOrderIds: newlyCancelledTargetIds(existing, orders),
  };
}
