import { useEffect, useMemo, useRef, useState } from "react";
import { listOrders } from "../lib/api";
import { formatError } from "../lib/errorUtils";
import { ensureDataKey, releaseDataKey } from "../lib/localDataStore";
import {
  filterOrders,
  filterOrdersBySite,
  formatOrderMoney,
  ORDER_REFRESH_MS,
  ORDER_SITES,
  orderEmailKey,
  orderInPeriod,
  PARSED_ORDER_SITES,
  refreshTargetOrders,
  repairUtf8Mojibake,
  retailerLabel,
  siteFilterLabel,
  sortOrdersByPlaced,
  SPEND_PERIODS,
  summarizeOrders,
  summarizeCancelledByEmail,
  type OrderListFilter,
  type OrderSiteFilter,
  type SpendPeriod,
} from "../lib/orderEmail";
import type { OrderEventKind, OrderLineItem, OrderStatus, ParsedOrder, PoolEmail, ProfileSummary } from "../lib/types";

const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Placed",
  shipped: "Shipped",
  delivered: "Delivered",
  picked_up: "Picked up",
  cancelled: "Cancelled",
};

const EVENT_LABEL: Record<OrderEventKind, string> = {
  placed: "Placed",
  shipped: "Shipped",
  in_transit: "In transit",
  delivered: "Delivered",
  picked_up: "Picked up",
  cancelled: "Cancelled",
};

function formatTotal(order: ParsedOrder): string {
  if (order.total == null) return "—";
  return formatOrderMoney(order.total, order.currency || "USD");
}

function formatWhen(value: string, dateMs?: number): string {
  const parsed = dateMs && dateMs > 0 ? dateMs : Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return value || "—";
  return new Date(parsed).toLocaleString();
}

function formatPlaced(order: ParsedOrder): string {
  const placed = order.events.find((event) => event.kind === "placed");
  return formatWhen(order.placedAt, placed?.dateMs);
}

function orderItems(order: ParsedOrder): OrderLineItem[] {
  return (order.items ?? []).map((item) => ({
    ...item,
    name: repairUtf8Mojibake(item.name),
  }));
}

function formatItemNames(order: ParsedOrder): string {
  const items = orderItems(order);
  if (items.length === 0) return "—";
  return items.map((item) => item.name).join(", ");
}

function formatItemQty(order: ParsedOrder): string {
  const items = orderItems(order);
  if (items.length === 0) return "—";
  return items.map((item) => String(item.quantity)).join(", ");
}

function cardNameByEmailMap(profiles: ProfileSummary[], poolEmails: PoolEmail[]): Map<string, string> {
  const poolById = new Map(poolEmails.map((email) => [email.id, email.email.trim().toLowerCase()]));
  const map = new Map<string, string>();
  const assign = (email: string | undefined, label: string | undefined) => {
    const key = email?.trim().toLowerCase() ?? "";
    const name = label?.trim() ?? "";
    if (key && name && !map.has(key)) map.set(key, name);
  };
  for (const profile of profiles) {
    assign(profile.email, profile.creditCardLabel);
    if (profile.emailPoolId) assign(poolById.get(profile.emailPoolId), profile.creditCardLabel);
  }
  return map;
}

interface OrdersPanelProps {
  profiles: ProfileSummary[];
  poolEmails?: PoolEmail[];
}

export function OrdersPanel({ profiles, poolEmails = [] }: OrdersPanelProps) {
  const [orders, setOrders] = useState<ParsedOrder[]>([]);
  const [siteFilter, setSiteFilter] = useState<OrderSiteFilter>("all");
  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState<OrderListFilter>("all");
  const [emailFilter, setEmailFilter] = useState<string | null>(null);
  const [spendPeriod, setSpendPeriod] = useState<SpendPeriod>("1m");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Scan IMAP for Target confirmation emails.");
  const [tone, setTone] = useState<"ok" | "error">("ok");
  const busyRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const runRefresh = async (hourly = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus(hourly ? "Hourly order refresh…" : "Scanning Target confirmation emails…");
    setTone("ok");
    try {
      const result = await refreshTargetOrders();
      setOrders(result.orders);
      setStatus(result.status);
      setTone(result.tone);
      const currentId = activeIdRef.current;
      if (currentId && !result.orders.some((order) => order.id === currentId)) {
        setActiveId(null);
      }
    } catch (error) {
      setTone("error");
      setStatus(formatError(error, hourly ? "Hourly order refresh failed." : "Order scan failed."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const runRefreshRef = useRef(runRefresh);
  runRefreshRef.current = runRefresh;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureDataKey("profile-generator:orders");
      await ensureDataKey("profile-generator:imap-mail");
      await ensureDataKey("profile-generator:imap-settings");
      try {
        const stored = await listOrders();
        if (!cancelled && stored.length > 0) setOrders(stored);
      } catch (error) {
        if (!cancelled) {
          setTone("error");
          setStatus(formatError(error, "Could not load saved orders."));
        }
      }
      if (cancelled) return;
      await runRefreshRef.current();
    })();
    const timer = window.setInterval(() => {
      void runRefreshRef.current(true);
    }, ORDER_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      releaseDataKey("profile-generator:orders");
    };
  }, []);

  const siteOrders = useMemo(() => filterOrdersBySite(orders, siteFilter), [orders, siteFilter]);
  const periodOrders = useMemo(
    () => siteOrders.filter((order) => orderInPeriod(order, spendPeriod)),
    [siteOrders, spendPeriod],
  );
  const stats = useMemo(() => summarizeOrders(siteOrders, spendPeriod), [siteOrders, spendPeriod]);
  const cancelledByEmail = useMemo(() => summarizeCancelledByEmail(periodOrders), [periodOrders]);
  const periodLabel = SPEND_PERIODS.find((period) => period.id === spendPeriod)?.label ?? "1 month";
  const cardNames = useMemo(() => cardNameByEmailMap(profiles, poolEmails), [profiles, poolEmails]);

  const cardNameFor = (order: ParsedOrder): string => {
    const email = order.recipientEmail?.trim().toLowerCase();
    if (!email) return "";
    return cardNames.get(email) ?? "";
  };

  useEffect(() => {
    if (listFilter !== "cancelled") return;
    if (emailFilter && !cancelledByEmail.some((row) => row.email === emailFilter)) {
      setEmailFilter(null);
    }
  }, [emailFilter, cancelledByEmail, listFilter]);

  const filtered = useMemo(() => {
    const byEmail = emailFilter
      ? siteOrders.filter((order) => orderEmailKey(order) === emailFilter)
      : siteOrders;
    const scoped = filterOrders(byEmail, listFilter, spendPeriod);
    const needle = query.trim().toLowerCase();
    if (!needle) return scoped;
    return sortOrdersByPlaced(
      scoped.filter((order) => {
        const haystack = [
          order.orderId,
          order.status,
          order.trackingNumber ?? "",
          order.recipientEmail ?? "",
          formatItemNames(order),
          formatItemQty(order),
          cardNameFor(order),
          order.total != null ? formatTotal(order) : "",
          retailerLabel(order.retailer),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      }),
    );
  }, [siteOrders, query, listFilter, spendPeriod, emailFilter, cardNames]);

  const active = filtered.find((order) => order.id === activeId) ?? null;
  const showTracking = listFilter !== "cancelled" && filtered.some((order) => order.status !== "cancelled");

  const toggleFilter = (next: OrderListFilter) => {
    setListFilter((current) => {
      const following = current === next ? "all" : next;
      if (following !== "cancelled") setEmailFilter(null);
      return following;
    });
    setActiveId(null);
  };

  return (
    <div className="orders-layout">
      <div className="profiles-table-toolbar">
        <div className="profiles-toolbar-row">
          <div className="toolbar-group">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void runRefresh()}>
              {busy ? "Scanning…" : "Refresh orders"}
            </button>
            <span className="muted">{filtered.length} shown</span>
          </div>
          <input
            className="table-search profiles-table-search"
            placeholder="Search order #, card, email, item, tracking"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className={`profiles-toolbar-status${tone === "error" ? " is-error" : ""}`}>{status}</p>
      </div>

      <div className="orders-site-filter">
        <div role="tablist" aria-label="Retailer">
          {ORDER_SITES.map((site) => (
          <button
            key={site.id}
            type="button"
            role="tab"
            aria-selected={siteFilter === site.id}
            className={siteFilter === site.id ? "is-active" : undefined}
            onClick={() => {
              setSiteFilter(site.id);
              setEmailFilter(null);
              setActiveId(null);
            }}
          >
            {site.label}
          </button>
        ))}
        </div>
      </div>

      <div className="orders-overview">
        <div className="orders-period-filter" role="group" aria-label="Order timeframe">
          {SPEND_PERIODS.map((period) => (
            <button
              key={period.id}
              type="button"
              className={spendPeriod === period.id ? "is-active" : undefined}
              onClick={() => {
                setSpendPeriod(period.id);
                setActiveId(null);
              }}
            >
              {period.label}
            </button>
          ))}
        </div>
        <div className="orders-tiles">
          <button
            type="button"
            className={`order-tile${listFilter === "successful" ? " is-active" : ""}`}
            onClick={() => toggleFilter("successful")}
          >
            <span className="order-tile-label">Successful</span>
            <strong className="order-tile-value">{stats.successful}</strong>
            <span className="order-tile-hint">Not cancelled</span>
          </button>
          <button
            type="button"
            className={`order-tile order-tile-danger${listFilter === "cancelled" ? " is-active" : ""}`}
            onClick={() => toggleFilter("cancelled")}
          >
            <span className="order-tile-label">Cancelled</span>
            <strong className="order-tile-value">{stats.cancelled}</strong>
            <span className="order-tile-hint">Cancel emails</span>
          </button>
          <button
            type="button"
            className={`order-tile${listFilter === "spend" ? " is-active" : ""}`}
            onClick={() => toggleFilter("spend")}
          >
            <span className="order-tile-label">Total spent</span>
            <strong className="order-tile-value">{formatOrderMoney(stats.spent)}</strong>
            <span className="order-tile-hint">{periodLabel}</span>
          </button>
          <button
            type="button"
            className={`order-tile${listFilter === "in_transit" ? " is-active" : ""}`}
            onClick={() => toggleFilter("in_transit")}
          >
            <span className="order-tile-label">In transit</span>
            <strong className="order-tile-value">{stats.inTransit}</strong>
            <span className="order-tile-hint">Shipped, not delivered</span>
          </button>
          <button
            type="button"
            className={`order-tile${listFilter === "not_shipped" ? " is-active" : ""}`}
            onClick={() => toggleFilter("not_shipped")}
          >
            <span className="order-tile-label">Not shipped</span>
            <strong className="order-tile-value">{stats.notShipped}</strong>
            <span className="order-tile-hint">Confirmed only</span>
          </button>
        </div>
      </div>

      {listFilter === "cancelled" ? (
        <div className="orders-cancel-emails">
          <h3>Cancellations by email</h3>
          {cancelledByEmail.length === 0 ? (
            <p className="muted">No cancelled orders in this timeframe.</p>
          ) : (
            <div className="orders-cancel-email-list">
              {cancelledByEmail.map((row) => {
                const selected = emailFilter === row.email;
                return (
                  <button
                    key={row.email}
                    type="button"
                    className={`orders-cancel-email${selected ? " is-active" : ""}`}
                    title={row.email}
                    onClick={() => {
                      setEmailFilter(selected ? null : row.email);
                      setActiveId(null);
                    }}
                  >
                    <strong>{row.cancelled}</strong>
                    <span>{row.email}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div className="orders-stack">
        <div className="table-scroll orders-table-scroll">
          {filtered.length === 0 ? (
            <p className="table-empty">
              {siteFilter !== "all" && !PARSED_ORDER_SITES.has(siteFilter)
                ? `${siteFilterLabel(siteFilter)} order emails are not parsed yet.`
                : orders.length === 0
                  ? "No Target orders with a confirmation email yet. Refresh to scan the loaded mail."
                  : "No orders match this filter or timeframe."}
            </p>
          ) : (
            <table className="profiles-table orders-table">
              <colgroup>
                <col className="orders-col-site" />
                <col className="orders-col-id" />
                <col className="orders-col-card" />
                <col className="orders-col-email" />
                <col className="orders-col-item" />
                <col className="orders-col-qty" />
                <col className="orders-col-status" />
                <col className="orders-col-total" />
                {showTracking ? <col className="orders-col-tracking" /> : null}
                <col className="orders-col-date" />
                <col className="orders-col-date" />
              </colgroup>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Order #</th>
                  <th>Card</th>
                  <th>Email</th>
                  <th className="orders-item-col">Item</th>
                  <th>Qty</th>
                  <th>Status</th>
                  <th>Total</th>
                  {showTracking ? <th>Tracking</th> : null}
                  <th>Placed</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const selected = active?.id === order.id;
                  return (
                    <tr
                      key={order.id}
                      className={selected ? "row-focused" : undefined}
                      onClick={() => setActiveId(selected ? null : order.id)}
                    >
                      <td>{retailerLabel(order.retailer)}</td>
                      <td className="col-card">{order.orderId}</td>
                      <td className="orders-card-cell" title={cardNameFor(order) || undefined}>
                        {cardNameFor(order) || "—"}
                      </td>
                      <td className="orders-email-cell" title={order.recipientEmail || undefined}>
                        {order.recipientEmail || "—"}
                      </td>
                      <td className="orders-item-cell" title={formatItemNames(order)}>
                        {formatItemNames(order)}
                      </td>
                      <td>{formatItemQty(order)}</td>
                      <td className="orders-status-cell">
                        <span className={`order-status-badge order-status-${order.status}`}>
                          {STATUS_LABEL[order.status]}
                        </span>
                      </td>
                      <td>{formatTotal(order)}</td>
                      {showTracking ? (
                        <td className="col-card">
                          {order.status === "cancelled" ? "—" : order.trackingNumber || "—"}
                        </td>
                      ) : null}
                      <td>{formatPlaced(order)}</td>
                      <td>{formatWhen(order.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <aside className="orders-detail card">
          {active ? (
            <>
              <h3>Order {active.orderId}</h3>
              <p className="muted">
                {retailerLabel(active.retailer)} · {STATUS_LABEL[active.status]}
                {active.fulfillment === "pickup" ? " · Store pickup" : ""}
              </p>
              <dl className="orders-detail-meta">
                <div>
                  <dt>Card</dt>
                  <dd>{cardNameFor(active) || "—"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{active.recipientEmail || "—"}</dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd>{formatTotal(active)}</dd>
                </div>
                {active.fulfillment === "pickup" ? (
                  <div>
                    <dt>Fulfillment</dt>
                    <dd>Store pickup</dd>
                  </div>
                ) : active.status === "cancelled" ? null : (
                  <div>
                    <dt>Tracking</dt>
                    <dd>{active.trackingNumber || "—"}</dd>
                  </div>
                )}
                <div>
                  <dt>Placed</dt>
                  <dd>{formatPlaced(active)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatWhen(active.updatedAt)}</dd>
                </div>
              </dl>
              <h4>Items</h4>
              {orderItems(active).length === 0 ? (
                <p className="muted">No item lines parsed from the confirmation email yet.</p>
              ) : (
                <table className="orders-items-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderItems(active).map((item) => (
                      <tr key={`${item.name}:${item.quantity}`}>
                        <td>{item.name}</td>
                        <td>{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <h4>Timeline</h4>
              <ol className="orders-timeline">
                {active.events.map((event) => (
                  <li key={`${event.accountId}:${event.uid}:${event.kind}`}>
                    <strong>{EVENT_LABEL[event.kind]}</strong>
                    <span>{formatWhen(event.date, event.dateMs)}</span>
                    <span className="muted">{event.subject}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">Select an order in the list to see shipment and cancel emails.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
