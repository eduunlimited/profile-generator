import { useEffect, useMemo, useRef, useState } from "react";
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
  formatOrderMoney,
  PERFORMANCE_SITES,
  refreshTargetOrders,
  retailerLabel,
  summarizeOrderAccounts,
  summarizeSitePerformance,
} from "../lib/orderEmail";
import type { OrderAnalysisRecord, OrderRetailer, ParsedOrder, PoolEmail, ProfileSummary } from "../lib/types";
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
  "address",
  "card",
  "spend",
  "count",
  "warmup",
  "stick",
  "analysis",
] as const;

const PERFORMANCE_TABLE_FLEX = ["address"] as const;
const PERFORMANCE_TABLE_MAX_WIDTHS: Partial<Record<(typeof PERFORMANCE_TABLE_COLUMNS)[number], number>> = {
  spend: 128,
  count: 108,
  warmup: 80,
  stick: 68,
  analysis: 200,
};

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
  active?: boolean;
}

export function OrderPerformancePanel({
  profiles,
  poolEmails = [],
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
    setStatus("Scanning Target confirmation emails…");
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
          const record = await analyzeAccountCancellations(account, orders);
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
  }, [active, analysisDueKey, accounts, orders]);

  const tableColumns = useResizableTableColumns({
    columnIds: PERFORMANCE_TABLE_COLUMNS,
    flexIds: PERFORMANCE_TABLE_FLEX,
    maxWidths: PERFORMANCE_TABLE_MAX_WIDTHS,
    storageKey: "order-performance",
    fitKey: filtered
      .map((account) =>
        [
          account.email,
          accountDisplayName(account),
          accountJigLines(account).join("\n"),
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
                  <ResizableTh columns={tableColumns} id="address">
                    Name &amp; address
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
                  const jigLines = accountJigLines(account);
                  const card = accountPaymentLines(account);
                  const successMoney = formatOrderMoney(account.successTotal);
                  const cancelMoney = formatOrderMoney(account.cancelledTotal);
                  const analysisKey = orderAnalysisKey(account.retailer, account.email);
                  const analysis = analysisByKey[analysisKey];
                  const analyzing = Boolean(pendingKeys[analysisKey]);
                  return (
                    <tr key={`${account.retailer}:${account.email}`}>
                      <td className="col-email" title={account.email}>
                        {account.email}
                      </td>
                      <td className="col-name" title={accountDisplayName(account) || undefined}>
                        {joinedOrDash(accountDisplayName(account))}
                      </td>
                      <td className="col-address" title={jigLines.join("\n") || undefined}>
                        {jigLines.length === 0 ? (
                          "—"
                        ) : (
                          <div className="address-cell">
                            {jigLines.map((line, index) => (
                              <span
                                key={`${line}:${index}`}
                                className={`address-cell-line${index === 0 ? " is-jig-name" : ""}`}
                              >
                                {line}
                              </span>
                            ))}
                          </div>
                        )}
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
