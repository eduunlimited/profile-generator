import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { listOrderAnalysis, listOrders, upsertOrderAnalysis } from "../lib/api";
import { formatError } from "../lib/errorUtils";
import { useResizableTableColumns } from "../hooks/useResizableTableColumns";
import { ensureDataKey, releaseDataKey } from "../lib/localDataStore";
import {
  analysisNeedsRun,
  analysisTooltip,
  analyzeAccountCancellations,
  hasOrderAnalysisCredentials,
  isValidAnalysisRecord,
  orderAnalysisKey,
} from "../lib/openaiOrderAnalysis";
import {
  accountDisplayName,
  accountJigLines,
  accountPaymentLabel,
  accountPaymentLines,
  accountSearchHaystack,
  filterOrdersBySite,
  formatOrderAddress,
  formatOrderMoney,
  isSuccessfulOrder,
  isWarmupOrder,
  orderCardSearchText,
  orderEmailKey,
  PERFORMANCE_SITES,
  refreshTargetOrders,
  repairUtf8Mojibake,
  retailerLabel,
  sortOrdersByPlaced,
  summarizeOrderAccounts,
  summarizeSitePerformance,
} from "../lib/orderEmail";
import type {
  CreditCard,
  OrderAnalysisRecord,
  OrderLineItem,
  OrderRetailer,
  ParsedOrder,
  PoolEmail,
  ProfileSummary,
} from "../lib/types";
import { OrderCardLabel } from "./OrderCardLabel";
import { ResizableTh, TableColGroup } from "./ResizableTable";

function joinedOrDash(value: string): string {
  return value.trim() || "—";
}

function formatStickRate(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}

const PERFORMANCE_TABLE_COLUMNS = [
  "email",
  "profile",
  "card",
  "spend",
  "count",
  "warmup",
  "stick",
  "analysis",
] as const;

const PERFORMANCE_TABLE_FLEX = ["analysis"] as const;

const PERFORMANCE_TABLE_MIN_WIDTHS: Partial<Record<(typeof PERFORMANCE_TABLE_COLUMNS)[number], number>> = {
  email: 168,
  profile: 120,
  card: 140,
  spend: 112,
  count: 88,
  warmup: 64,
  stick: 58,
  analysis: 160,
};

const PERFORMANCE_TABLE_MAX_WIDTHS: Partial<Record<(typeof PERFORMANCE_TABLE_COLUMNS)[number], number>> = {
  email: 240,
  profile: 160,
  card: 200,
  spend: 128,
  count: 108,
  warmup: 80,
  stick: 68,
  analysis: 220,
};

function formatPlaced(order: ParsedOrder): string {
  const placed = order.events.find((event) => event.kind === "placed");
  const parsed = placed?.dateMs && placed.dateMs > 0 ? placed.dateMs : Date.parse(order.placedAt);
  if (!Number.isFinite(parsed) || parsed <= 0) return "—";
  return new Date(parsed).toLocaleDateString();
}

function formatAddressOneLine(order: ParsedOrder, fallback: string): string {
  if (isWarmupOrder(order) || order.shippingAddress?.source === "pickup") {
    return "Pickup order";
  }
  const raw = formatOrderAddress(order.shippingAddress) || fallback;
  return raw.replace(/\n+/g, ", ").trim();
}

function orderItems(order: ParsedOrder): OrderLineItem[] {
  return (order.items ?? []).map((item) => ({
    ...item,
    name: repairUtf8Mojibake(item.name),
  }));
}

function formatOrderTotal(order: ParsedOrder): string {
  return order.total != null ? formatOrderMoney(order.total, order.currency) : "—";
}

function formatItemNames(order: ParsedOrder): string {
  const items = orderItems(order);
  if (items.length === 0) return "—";
  return items.map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name)).join(", ");
}

function accountOrderKey(retailer: OrderRetailer, email: string): string {
  return `${retailer}:${email}`;
}

function ordersForAccount(orders: ParsedOrder[], retailer: OrderRetailer, email: string): ParsedOrder[] {
  return sortOrdersByPlaced(
    orders.filter((order) => order.retailer === retailer && orderEmailKey(order) === email),
  );
}

function HeaderStack({ lines }: { lines: [string, string] }) {
  return (
    <span className="th-stack">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

interface OrderPerformancePanelProps {
  profiles: ProfileSummary[];
  poolEmails?: PoolEmail[];
  cards?: CreditCard[];
  active?: boolean;
}

export function OrderPerformancePanel({
  profiles,
  poolEmails = [],
  cards = [],
  active = true,
}: OrderPerformancePanelProps) {
  const [orders, setOrders] = useState<ParsedOrder[]>([]);
  const [siteFilter, setSiteFilter] = useState<OrderRetailer>("target");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Showing emails with at least one cancelled order.");
  const [tone, setTone] = useState<"ok" | "error">("ok");
  const [analysisByKey, setAnalysisByKey] = useState<Record<string, OrderAnalysisRecord>>({});
  const [pendingKeys, setPendingKeys] = useState<Record<string, true>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const busyRef = useRef(false);
  const analysisByKeyRef = useRef(analysisByKey);
  const inflightRef = useRef(new Set<string>());
  const missingKeyWarnedRef = useRef(false);
  analysisByKeyRef.current = analysisByKey;

  const runRefresh = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus("Scanning confirmation emails…");
    setTone("ok");
    try {
      const result = await refreshTargetOrders();
      setOrders(result.orders);
      setStatus(result.status);
      setTone(result.tone);
    } catch (error) {
      setTone("error");
      setStatus(formatError(error, "Order scan failed."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      await ensureDataKey("profile-generator:orders");
      await ensureDataKey("profile-generator:order-analysis");
      try {
        const [stored, storedAnalysis] = await Promise.all([listOrders(), listOrderAnalysis()]);
        if (cancelled) return;
        setOrders(stored);
        setAnalysisByKey(
          Object.fromEntries(storedAnalysis.map((record) => [orderAnalysisKey(record.site, record.email), record])),
        );
      } catch (error) {
        if (!cancelled) {
          setTone("error");
          setStatus(formatError(error, "Could not load saved orders."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    return () => {
      releaseDataKey("profile-generator:orders");
      releaseDataKey("profile-generator:order-analysis");
    };
  }, []);

  const siteLabel = retailerLabel(siteFilter);
  const siteMetrics = useMemo(
    () => summarizeSitePerformance(filterOrdersBySite(orders, siteFilter)),
    [orders, siteFilter],
  );
  const accounts = useMemo(
    () =>
      summarizeOrderAccounts(orders, profiles, poolEmails, siteFilter).filter(
        (account) => account.cancelled > 0,
      ),
    [orders, profiles, poolEmails, siteFilter],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((account) => accountSearchHaystack(account).includes(needle));
  }, [accounts, query]);

  const analysisDueKey = useMemo(
    () => accounts.map((account) => `${account.retailer}:${account.email}:${account.cancelled}`).join("|"),
    [accounts],
  );

  useEffect(() => {
    if (!active || accounts.length === 0) return;
    let cancelled = false;
    const due = accounts.filter((account) =>
      analysisNeedsRun(analysisByKeyRef.current[orderAnalysisKey(account.retailer, account.email)], account.cancelled),
    );
    if (due.length === 0) return;

    void (async () => {
      const ready = await hasOrderAnalysisCredentials();
      if (cancelled) return;
      if (!ready) {
        if (!missingKeyWarnedRef.current) {
          missingKeyWarnedRef.current = true;
          setStatus("Set an OpenAI API key in Settings to fill Analysis.");
        }
        return;
      }
      for (const account of due) {
        if (cancelled) return;
        const key = orderAnalysisKey(account.retailer, account.email);
        if (inflightRef.current.has(key)) continue;
        inflightRef.current.add(key);
        setPendingKeys((current) => ({ ...current, [key]: true }));
        try {
          const record = await analyzeAccountCancellations(account, orders, cards, profiles);
          if (cancelled) return;
          await upsertOrderAnalysis(record);
          setAnalysisByKey((current) => ({ ...current, [key]: record }));
        } catch (error) {
          if (!cancelled && /OpenAI API key/i.test(error instanceof Error ? error.message : "")) {
            setTone("error");
            setStatus(formatError(error, "Set an OpenAI API key in Settings to fill Analysis."));
            break;
          }
        } finally {
          inflightRef.current.delete(key);
          setPendingKeys((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, analysisDueKey, accounts, orders, cards, profiles]);

  const tableColumns = useResizableTableColumns({
    columnIds: PERFORMANCE_TABLE_COLUMNS,
    flexIds: PERFORMANCE_TABLE_FLEX,
    minWidths: PERFORMANCE_TABLE_MIN_WIDTHS,
    maxWidths: PERFORMANCE_TABLE_MAX_WIDTHS,
    storageKey: "order-performance-v2",
    fitKey: filtered
      .map((account) =>
        [
          account.email,
          accountDisplayName(account),
          accountPaymentLabel(account),
          account.successTotal,
          account.cancelledTotal,
          account.successful,
          account.cancelled,
          account.warmup,
          account.successRate,
          analysisByKey[orderAnalysisKey(account.retailer, account.email)]?.result.display ?? "",
          analysisByKey[orderAnalysisKey(account.retailer, account.email)]?.result.action ?? "",
        ].join("\t"),
      )
      .join("\n"),
  });

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
            placeholder="Search email, profile, jig, card"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className={`profiles-toolbar-status${tone === "error" ? " is-error" : ""}`}>{status}</p>
      </div>

      <div className="orders-site-filter">
        <div role="tablist" aria-label="Retailer">
          {PERFORMANCE_SITES.map((site) => (
            <button
              key={site.id}
              type="button"
              role="tab"
              aria-selected={siteFilter === site.id}
              className={siteFilter === site.id ? "is-active" : undefined}
              onClick={() => {
                setSiteFilter(site.id);
                setExpandedKey(null);
              }}
            >
              {site.label}
            </button>
          ))}
        </div>
      </div>

      <div className="orders-overview orders-performance-overview">
        <div className="orders-tiles orders-performance-tiles">
          <div className="order-tile">
            <span className="order-tile-label">Succeeded / cancelled</span>
            <strong className="order-tile-value">
              <span className="order-metric-ok">{siteMetrics.successful}</span>
              <span className="order-metric-sep">/</span>
              <span className="order-metric-cxl">{siteMetrics.cancelled}</span>
            </strong>
            <span className="order-tile-hint">
              <span className="order-metric-ok">{formatOrderMoney(siteMetrics.successTotal)}</span>
              <span className="order-metric-sep"> / </span>
              <span className="order-metric-cxl">{formatOrderMoney(siteMetrics.cancelledTotal)}</span>
            </span>
          </div>
          <div className="order-tile order-tile-danger">
            <span className="order-tile-label">Cancellation rate</span>
            <strong className="order-tile-value order-metric-cxl">{formatStickRate(siteMetrics.cancelRate)}</strong>
            <span className="order-tile-hint">Cancelled ÷ all {siteLabel} orders</span>
          </div>
          <div className="order-tile order-tile-success">
            <span className="order-tile-label">Stick rate</span>
            <strong className="order-tile-value order-metric-ok">{formatStickRate(siteMetrics.stickRate)}</strong>
            <span className="order-tile-hint">Succeeded ÷ all {siteLabel} orders</span>
          </div>
        </div>
      </div>

      <div className="accounts-table-wrap orders-performance-wrap">
        <div className="table-scroll">
          {filtered.length === 0 ? (
            <p className="table-empty">
              {orders.length === 0
                ? "No Target orders with a confirmation email yet. Refresh to scan mail."
                : `No ${siteLabel} emails with cancelled orders.`}
            </p>
          ) : (
            <table
              ref={tableColumns.tableRef}
              className={`profiles-table accounts-table ${tableColumns.tableClassName}`.trim()}
            >
              <TableColGroup columns={tableColumns} />
              <thead>
                <tr>
                  <ResizableTh columns={tableColumns} id="email">
                    Email
                  </ResizableTh>
                  <ResizableTh columns={tableColumns} id="profile">
                    Profile
                  </ResizableTh>
                  <ResizableTh columns={tableColumns} id="card">
                    Card
                  </ResizableTh>
                  <ResizableTh columns={tableColumns} id="spend">
                    <HeaderStack lines={["Succeeded $", "Cancelled $"]} />
                  </ResizableTh>
                  <ResizableTh columns={tableColumns} id="count">
                    <HeaderStack lines={["Succeeded", "Cancelled"]} />
                  </ResizableTh>
                  <ResizableTh columns={tableColumns} id="warmup">
                    <HeaderStack lines={["Warm up", "orders"]} />
                  </ResizableTh>
                  <ResizableTh columns={tableColumns} id="stick">
                    Stick %
                  </ResizableTh>
                  <ResizableTh columns={tableColumns} id="analysis">
                    Analysis
                  </ResizableTh>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => {
                  const card = accountPaymentLines(account);
                  const successMoney = formatOrderMoney(account.successTotal);
                  const cancelMoney = formatOrderMoney(account.cancelledTotal);
                  const analysisKey = orderAnalysisKey(account.retailer, account.email);
                  const analysis = analysisByKey[analysisKey];
                  const analyzing = Boolean(pendingKeys[analysisKey]);
                  const rowKey = accountOrderKey(account.retailer, account.email);
                  const expanded = expandedKey === rowKey;
                  const timelineOrders = expanded
                    ? ordersForAccount(orders, account.retailer, account.email)
                    : [];
                  const fallbackAddress = accountJigLines(account).join("\n");
                  return (
                    <Fragment key={rowKey}>
                    <tr
                      className={expanded ? "row-focused" : undefined}
                      onClick={() => setExpandedKey(expanded ? null : rowKey)}
                    >
                      <td className="col-email" title={account.email}>
                        {account.email}
                      </td>
                      <td className="col-name" title={accountDisplayName(account) || undefined}>
                        {joinedOrDash(accountDisplayName(account))}
                      </td>
                      <td className="col-card-profile" title={accountPaymentLabel(account) || undefined}>
                        {!card.name && !card.brand ? (
                          "—"
                        ) : (
                          <div className="address-cell">
                            {card.name ? <span className="address-cell-line">{card.name}</span> : null}
                            {card.brand ? (
                              <span className="address-cell-line is-card-brand">{card.brand}</span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="col-spend" title={`${successMoney}/${cancelMoney}`}>
                        <span className="order-metric-ok">{successMoney}</span>
                        <span className="order-metric-sep">/</span>
                        <span className="order-metric-cxl">{cancelMoney}</span>
                      </td>
                      <td className="col-count">
                        <span className="order-metric-ok">{account.successful}</span>
                        <span className="order-metric-sep">/</span>
                        <span className="order-metric-cxl">{account.cancelled}</span>
                      </td>
                      <td className="col-warmup" title="Pickup orders used to warm up the account">
                        {account.warmup}
                      </td>
                      <td className="col-stick">
                        <span className={account.successRate != null && account.successRate < 0.5 ? "order-metric-cxl" : "order-metric-ok"}>
                          {formatStickRate(account.successRate)}
                        </span>
                      </td>
                      <td
                        className="col-analysis"
                        title={analyzing ? "Analyzing…" : analysisTooltip(analysis)}
                      >
                        {analyzing ? (
                          "Analyzing…"
                        ) : isValidAnalysisRecord(analysis) ? (
                          <div className="address-cell">
                            <span className={`analysis-verdict is-${analysis.result.severity}`}>
                              {analysis.result.display}
                            </span>
                            {analysis.result.action ? (
                              <span className="analysis-suggestion">{analysis.result.action}</span>
                            ) : null}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="performance-expand-row">
                        <td colSpan={PERFORMANCE_TABLE_COLUMNS.length}>
                          {timelineOrders.length === 0 ? (
                            <p className="muted">No succeeded or cancelled orders for this email yet.</p>
                          ) : (
                            <ol className="performance-order-timeline">
                              <li className="performance-order-row is-header" aria-hidden="true">
                                <span>Date</span>
                                <span>Order #</span>
                                <span>Item</span>
                                <span>Value</span>
                                <span>Card</span>
                                <span>Shipping address</span>
                                <span>Status</span>
                              </li>
                              {timelineOrders.map((order) => {
                                const succeeded = isSuccessfulOrder(order);
                                return (
                                <li key={order.id} className="performance-order-row">
                                  <span className="muted">{formatPlaced(order)}</span>
                                  <span className="performance-order-id">{order.orderId}</span>
                                  <span className="performance-order-item">{formatItemNames(order)}</span>
                                  <span className="performance-order-value">{formatOrderTotal(order)}</span>
                                  <span
                                    className="performance-order-card"
                                    title={
                                      orderCardSearchText(order, cards, profiles, accountPaymentLabel(account)) ||
                                      undefined
                                    }
                                  >
                                    <OrderCardLabel
                                      order={order}
                                      cards={cards}
                                      profiles={profiles}
                                      fallback={accountPaymentLabel(account)}
                                    />
                                  </span>
                                  <span className="performance-order-address">
                                    {formatAddressOneLine(order, fallbackAddress) || "—"}
                                  </span>
                                  <span className={succeeded ? "order-metric-ok" : "order-metric-cxl"}>
                                    {succeeded ? "Succeeded" : "Cancelled"}
                                  </span>
                                </li>
                                );
                              })}
                            </ol>
                          )}
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
