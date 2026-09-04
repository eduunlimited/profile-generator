import type { OrderRetailer, ParsedOrder } from "../types";

export const ORDER_REFRESH_MS = 60 * 60 * 1000;
export type SpendPeriod = "this_week" | "last_week" | "1m" | "3m" | "6m" | "ytd" | "1y";
export type OrderListFilter = "all" | "successful" | "cancelled" | "in_transit" | "not_shipped" | "spend";
export type OrderSiteFilter = "all" | OrderRetailer;

export const ORDER_SITES: { id: OrderSiteFilter; label: string }[] = [
  { id: "all", label: "All sites" },
  { id: "target", label: "Target" },
  { id: "walmart", label: "Walmart" },
  { id: "pokemon-center", label: "Pokemon Center" },
];

export const PERFORMANCE_SITES: { id: OrderRetailer; label: string }[] = [
  { id: "target", label: "Target" },
  { id: "walmart", label: "Walmart" },
  { id: "pokemon-center", label: "Pokemon Center" },
];

export const PARSED_ORDER_SITES = new Set<OrderRetailer>(["target"]);

export function retailerLabel(retailer: OrderRetailer): string {
  if (retailer === "walmart") return "Walmart";
  if (retailer === "pokemon-center") return "Pokemon Center";
  return "Target";
}

export function siteFilterLabel(site: OrderSiteFilter): string {
  return ORDER_SITES.find((entry) => entry.id === site)?.label ?? "All sites";
}

export function filterOrdersBySite(orders: ParsedOrder[], site: OrderSiteFilter): ParsedOrder[] {
  if (site === "all") return orders;
  return orders.filter((order) => order.retailer === site);
}

export const SPEND_PERIODS: { id: SpendPeriod; label: string }[] = [
  { id: "this_week", label: "this week" },
  { id: "last_week", label: "last week" },
  { id: "1m", label: "1 month" },
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1 year" },
];

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalWeek(date: Date): Date {
  const start = startOfLocalDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export function spendPeriodRange(period: SpendPeriod, now = new Date()): { start: Date; end?: Date } {
  if (period === "this_week") return { start: startOfLocalWeek(now) };
  if (period === "last_week") {
    const thisWeek = startOfLocalWeek(now);
    const lastWeek = new Date(thisWeek);
    lastWeek.setDate(lastWeek.getDate() - 7);
    return { start: lastWeek, end: thisWeek };
  }
  if (period === "ytd") return { start: new Date(now.getFullYear(), 0, 1) };
  const start = new Date(now);
  if (period === "1m") start.setMonth(start.getMonth() - 1);
  else if (period === "3m") start.setMonth(start.getMonth() - 3);
  else if (period === "6m") start.setMonth(start.getMonth() - 6);
  else start.setFullYear(start.getFullYear() - 1);
  return { start };
}

export function spendPeriodStart(period: SpendPeriod, now = new Date()): Date {
  return spendPeriodRange(period, now).start;
}

export function orderPlacedMs(order: ParsedOrder): number {
  const parsed = Date.parse(order.placedAt);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const placed = order.events.find((event) => event.kind === "placed");
  return placed?.dateMs && placed.dateMs > 0 ? placed.dateMs : Date.parse(order.updatedAt) || 0;
}

export function isSuccessfulOrder(order: ParsedOrder): boolean {
  return order.status !== "cancelled";
}

export function isInTransitOrder(order: ParsedOrder): boolean {
  return order.status === "shipped";
}

export function isNotShippedOrder(order: ParsedOrder): boolean {
  return order.status === "placed";
}

export function orderInPeriod(order: ParsedOrder, period: SpendPeriod, now = new Date()): boolean {
  const placed = orderPlacedMs(order);
  const { start, end } = spendPeriodRange(period, now);
  if (placed < start.getTime()) return false;
  if (end && placed >= end.getTime()) return false;
  return true;
}

export function orderInSpendPeriod(order: ParsedOrder, period: SpendPeriod, now = new Date()): boolean {
  return isSuccessfulOrder(order) && orderInPeriod(order, period, now);
}

export function formatOrderMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function summarizeOrders(orders: ParsedOrder[], period: SpendPeriod, now = new Date()) {
  let successful = 0;
  let cancelled = 0;
  let inTransit = 0;
  let notShipped = 0;
  let spent = 0;
  for (const order of orders) {
    if (!orderInPeriod(order, period, now)) continue;
    if (order.status === "cancelled") cancelled += 1;
    else successful += 1;
    if (isInTransitOrder(order)) inTransit += 1;
    if (isNotShippedOrder(order)) notShipped += 1;
    if (isSuccessfulOrder(order) && order.total != null) spent += order.total;
  }
  return { successful, cancelled, inTransit, notShipped, spent };
}

export const UNKNOWN_ORDER_EMAIL = "Unknown";

export interface EmailOrderSummary {
  email: string;
  cancelled: number;
  successful: number;
  total: number;
}

export function orderEmailKey(order: ParsedOrder): string {
  return order.recipientEmail?.trim().toLowerCase() || UNKNOWN_ORDER_EMAIL;
}

export function summarizeOrdersByEmail(orders: ParsedOrder[]): EmailOrderSummary[] {
  const byEmail = new Map<string, EmailOrderSummary>();
  for (const order of orders) {
    const email = orderEmailKey(order);
    const current = byEmail.get(email) ?? { email, cancelled: 0, successful: 0, total: 0 };
    current.total += 1;
    if (order.status === "cancelled") current.cancelled += 1;
    else current.successful += 1;
    byEmail.set(email, current);
  }
  return [...byEmail.values()].sort(
    (a, b) => b.cancelled - a.cancelled || b.total - a.total || a.email.localeCompare(b.email),
  );
}

export function summarizeCancelledByEmail(orders: ParsedOrder[]): { email: string; cancelled: number }[] {
  return summarizeOrdersByEmail(orders)
    .filter((row) => row.cancelled > 0)
    .map((row) => ({ email: row.email, cancelled: row.cancelled }));
}

export function sortOrdersByPlaced(orders: ParsedOrder[]): ParsedOrder[] {
  return [...orders].sort(
    (a, b) => orderPlacedMs(b) - orderPlacedMs(a) || b.orderId.localeCompare(a.orderId),
  );
}

export function filterOrders(
  orders: ParsedOrder[],
  filter: OrderListFilter,
  period: SpendPeriod,
): ParsedOrder[] {
  const inPeriod = orders.filter((order) => orderInPeriod(order, period));
  const scoped =
    filter === "successful"
      ? inPeriod.filter(isSuccessfulOrder)
      : filter === "cancelled"
        ? inPeriod.filter((order) => order.status === "cancelled")
        : filter === "in_transit"
          ? inPeriod.filter(isInTransitOrder)
          : filter === "not_shipped"
            ? inPeriod.filter(isNotShippedOrder)
            : filter === "spend"
              ? inPeriod.filter((order) => isSuccessfulOrder(order) && order.total != null)
              : inPeriod;
  return sortOrdersByPlaced(scoped);
}
