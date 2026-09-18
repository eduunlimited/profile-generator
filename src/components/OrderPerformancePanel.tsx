import { useEffect, useMemo, useRef, useState } from "react";
import { listOrderAnalysis, listOrders, upsertOrderAnalysis } from "../lib/api";
import { formatError } from "../lib/errorUtils";
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
  accountOrderTimeline,
  accountPaymentLabel,
  accountSearchHaystack,
  filterOrdersBySite,
  formatOrderCardCompact,
  formatOrderMoney,
  isSuccessfulOrder,
  orderAddressLines,
  orderPlacedMs,
  PERFORMANCE_SITES,
  refreshTargetOrders,
  applyTargetCancelReasonsAfterRefresh,
  formatCancelledStatus,
  repairUtf8Mojibake,
  retailerLabel,
  summarizeOrderAccounts,
  summarizeSitePerformance,
  timelineFieldChanges,
  timelineRailTone,
  type AccountPerformance,
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

function formatStickRate(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}

function formatPlaced(order: ParsedOrder): string {
  const parsed = orderPlacedMs(order);
  if (!Number.isFinite(parsed) || parsed <= 0) return "—";
  return new Date(parsed).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatOrderTotal(order: ParsedOrder): string {
  return order.total != null ? formatOrderMoney(order.total, order.currency) : "—";
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
  return items.map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name)).join(", ");
}

function formatPaymentCompact(
  order: ParsedOrder,
  cards: CreditCard[],
  profiles: ProfileSummary[],
  fallback: string,
): string {
  return formatOrderCardCompact(order, cards, profiles, fallback);
}

function FieldLine({ value, changed }: { value: string; changed?: boolean }) {
  if (!value) return null;
  return (
    <span className={`performance-node-field${changed ? " is-changed" : ""}`} title={value}>
      {value}
    </span>
  );
}

function TimelineRail({
  slots,
  index,
}: {
  slots: Array<ParsedOrder | null>;
  index: number;
}) {
  const order = slots[index];
  const prev = index > 0 ? slots[index - 1] : null;
  const next = index < slots.length - 1 ? slots[index + 1] : null;
  const leftTone = index === 0 ? null : timelineRailTone(prev, order);
  const rightTone = index === slots.length - 1 ? null : timelineRailTone(order, next);
  const succeeded = order ? isSuccessfulOrder(order) : null;
  return (
    <div className="performance-node-rail" aria-hidden="true">
      <span className={`performance-node-rail-seg${leftTone ? ` is-${leftTone}` : ""}`} />
      <span
        className={`performance-node-dot${
          succeeded == null ? " is-empty" : succeeded ? " is-ok" : " is-cxl"
        }`}
      />
      <span className={`performance-node-rail-seg${rightTone ? ` is-${rightTone}` : ""}`} />
    </div>
  );
}

function TimelineNode({
  order,
  previous,
  slots,
  index,
  cards,
  profiles,
  poolEmails,
  fallbackPayment,
  fallbackAddress,
  fallbackProfile,
}: {
  order: ParsedOrder | null;
  previous: ParsedOrder | null;
  slots: Array<ParsedOrder | null>;
  index: number;
  cards: CreditCard[];
  profiles: ProfileSummary[];
  poolEmails: PoolEmail[];
  fallbackPayment: string;
  fallbackAddress: string;
  fallbackProfile: string;
}) {
  const succeeded = order ? isSuccessfulOrder(order) : null;
  const changes = timelineFieldChanges(previous, order, fallbackProfile, profiles, poolEmails);
  const address = order ? orderAddressLines(order, fallbackAddress) : null;
  return (
    <div className="performance-node">
      <TimelineRail slots={slots} index={index} />
      {order && succeeded != null && address ? (
        <div className="performance-node-body">
          <span
            className={succeeded ? "order-metric-ok" : "order-metric-cxl"}
            title={succeeded ? undefined : order.cancelReason?.trim() || undefined}
          >
            {succeeded ? "Succeeded" : formatCancelledStatus(order)}
          </span>
          <span className="performance-node-meta">
            <span className="muted">{formatPlaced(order)}</span>
            <span className="performance-node-value">{formatOrderTotal(order)}</span>
          </span>
          <span className="performance-node-id" title={order.orderId}>
            {order.orderId}
          </span>
          <span className="performance-node-item" title={formatItemNames(order)}>
            {formatItemNames(order)}
          </span>
          <FieldLine
            value={formatPaymentCompact(order, cards, profiles, fallbackPayment)}
            changed={changes.payment}
          />
          {address.shipName ? <FieldLine value={address.shipName} changed={changes.shipName} /> : null}
          <FieldLine value={address.street} changed={changes.address} />
          {address.line2 ? <FieldLine value={address.line2} changed={changes.address} /> : null}
          {address.cityLine ? (
            <FieldLine value={address.cityLine} changed={!address.pickup && changes.address} />
          ) : null}
        </div>
      ) : null}
      {index === 0 ? (
        <span className="performance-node-axis">Oldest</span>
      ) : index === slots.length - 1 ? (
        <span className="performance-node-axis is-end">Newest</span>
      ) : null}
    </div>
  );
}

function PerformanceEmailCard({
  account,
  orders,
  cards,
  profiles,
  poolEmails,
  analysis,
  analyzing,
}: {
  account: AccountPerformance;
  orders: ParsedOrder[];
  cards: CreditCard[];
  profiles: ProfileSummary[];
  poolEmails: PoolEmail[];
  analysis?: OrderAnalysisRecord;
  analyzing: boolean;
}) {
  const timeline = useMemo(
    () => accountOrderTimeline(orders, account.retailer, account.email),
    [orders, account.retailer, account.email],
  );
  const profileName = accountDisplayName(account);
  const fallbackPayment = accountPaymentLabel(account);
  const fallbackAddress = accountJigLines(account).join("\n");
  const successMoney = formatOrderMoney(account.successTotal);
  const cancelMoney = formatOrderMoney(account.cancelledTotal);
  return (
    <article className="performance-email-card">
      <header className="performance-email-head">
        <div className="performance-email-title">
          <h3 title={account.email}>{account.email}</h3>
          {profileName ? <span className="muted">{profileName}</span> : null}
        </div>
        <span className={`performance-email-hint${timeline.recovered ? " is-ok" : " is-cxl"}`}>
          {timeline.hint}
        </span>
      </header>
      <div className="performance-email-meta">
        <span>
          <span className="order-metric-ok">{timeline.succeededInLast}</span>
          <span className="order-metric-sep">/</span>
          <span className="order-metric-cxl">{timeline.cancelledInLast}</span>
          <span className="muted"> last {timeline.orders.length}</span>
        </span>
        <span>
          <span className="order-metric-ok">{account.successful}</span>
          <span className="order-metric-sep">/</span>
          <span className="order-metric-cxl">{account.cancelled}</span>
          <span className="muted"> overall</span>
        </span>
        <span className={account.successRate != null && account.successRate < 0.5 ? "order-metric-cxl" : "order-metric-ok"}>
          Stick {formatStickRate(account.successRate)}
        </span>
        <span>
          <span className="order-metric-ok">{successMoney}</span>
          <span className="order-metric-sep"> / </span>
          <span className="order-metric-cxl">{cancelMoney}</span>
        </span>
      </div>
      {analyzing ? (
        <p className="performance-email-analysis muted">Analyzing…</p>
      ) : isValidAnalysisRecord(analysis) ? (
        <p className="performance-email-analysis" title={analysisTooltip(analysis)}>
          <span className={`analysis-verdict is-${analysis.result.severity}`}>{analysis.result.display}</span>
          {analysis.result.action ? <span className="analysis-suggestion">{analysis.result.action}</span> : null}
        </p>
      ) : null}
      <ol className="performance-timeline">
        {timeline.slots.map((order, index) => (
          <li key={order?.id ?? `empty-${account.email}-${index}`}>
            <TimelineNode
              order={order}
              previous={index > 0 ? timeline.slots[index - 1] : null}
              slots={timeline.slots}
              index={index}
              cards={cards}
              profiles={profiles}
              poolEmails={poolEmails}
              fallbackPayment={fallbackPayment}
              fallbackAddress={fallbackAddress}
              fallbackProfile={profileName}
            />
          </li>
        ))}
      </ol>
    </article>
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
      const withDates = result.orders;
      setOrders(withDates);
      setStatus(result.status);
      setTone(result.tone);
      const cancel = await applyTargetCancelReasonsAfterRefresh(
        withDates,
        "button",
        result.newCancelledOrderIds,
        (message) => setStatus(message),
      );
      if (cancel.orders !== withDates) setOrders(cancel.orders);
      if (cancel.status) {
        setStatus(cancel.fetched > 0 || cancel.accounts > 0 ? cancel.status : result.status);
        setTone(cancel.tone);
      }
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
              onClick={() => setSiteFilter(site.id)}
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
            <div className="performance-cards">
              {filtered.map((account) => {
                const analysisKey = orderAnalysisKey(account.retailer, account.email);
                return (
                  <PerformanceEmailCard
                    key={`${account.retailer}:${account.email}`}
                    account={account}
                    orders={orders}
                    cards={cards}
                    profiles={profiles}
                    poolEmails={poolEmails}
                    analysis={analysisByKey[analysisKey]}
                    analyzing={Boolean(pendingKeys[analysisKey])}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
