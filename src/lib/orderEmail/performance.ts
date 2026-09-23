import type { OrderRetailer, OrderStatus, ParsedOrder, PoolEmail, ProfileSummary } from "../types";
import { parseCardNumberDigits } from "../creditCardUtils";
import {
  filterOrdersBySite,
  isInTransitOrder,
  isNotShippedOrder,
  isSuccessfulOrder,
  orderEmailKey,
  orderPlacedMs,
  retailerLabel,
  sortOrdersByPlaced,
  startOfLocalWeek,
  UNKNOWN_ORDER_EMAIL,
} from "./dashboard";
import { formatOrderAddress } from "./parse";

export interface AccountProfileContext {
  profileId?: string;
  profileName: string;
  billingName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  paymentLabel: string;
  cardBrand: string;
  nameJigPresetName: string;
  addressJigPresetName: string;
  addressCheckStatus: string;
  addressMasterMatch?: boolean;
}

export interface AccountOrderValue {
  orderId: string;
  status: OrderStatus;
  total?: number;
  placedAt: string;
}

export interface AccountPerformance {
  email: string;
  retailer: OrderRetailer;
  orders: number;
  successful: number;
  cancelled: number;
  inTransit: number;
  notShipped: number;
  pickedUp: number;
  warmup: number;
  delivered: number;
  successTotal: number;
  cancelledTotal: number;
  avgOrderValue?: number;
  avgSuccessValue?: number;
  avgCancelledValue?: number;
  successRate?: number;
  dollarSuccessRate?: number;
  profiles: AccountProfileContext[];
  orderValues: AccountOrderValue[];
}

export interface AccountPerformanceSnapshot {
  generatedAt: string;
  site: OrderRetailer;
  account: AccountPerformance;
}

function uniqueLabels(values: string[]): string {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join(", ");
}

export function profileMatchesRetailer(
  profile: Pick<ProfileSummary, "accountSite">,
  retailer: OrderRetailer,
): boolean {
  const site = profile.accountSite?.trim();
  if (!site) return false;
  const normalized = site.toLowerCase().replace(/\s+/g, "-");
  return normalized === retailer || site.toLowerCase() === retailerLabel(retailer).toLowerCase();
}

const ORDER_RETAILERS: OrderRetailer[] = ["target", "walmart", "pokemon-center"];

export function retailerFromAccountSite(site?: string): OrderRetailer | null {
  if (!site?.trim()) return null;
  return ORDER_RETAILERS.find((retailer) => profileMatchesRetailer({ accountSite: site }, retailer)) ?? null;
}

function profileAccountEmails(profile: ProfileSummary, poolEmails: PoolEmail[]): string[] {
  const emails = new Set<string>();
  for (const value of [profile.email, profile.billingEmail]) {
    const email = value.trim().toLowerCase();
    if (email) emails.add(email);
  }
  if (profile.emailPoolId) {
    const pooled = poolEmails.find((item) => item.id === profile.emailPoolId)?.email.trim().toLowerCase();
    if (pooled) emails.add(pooled);
  }
  return [...emails];
}

export interface ProfileOrderCounts {
  successful: number;
  cancelled: number;
}

function emptyProfileOrderCounts(): ProfileOrderCounts {
  return { successful: 0, cancelled: 0 };
}

/** Succeeded and cancelled orders for this jig's site and account email only. */
export function orderCountsForProfile(
  profile: ProfileSummary,
  orders: ParsedOrder[],
  poolEmails: PoolEmail[],
): ProfileOrderCounts {
  const retailer = retailerFromAccountSite(profile.accountSite);
  if (!retailer) return emptyProfileOrderCounts();
  const emails = new Set(profileAccountEmails(profile, poolEmails));
  if (emails.size === 0) return emptyProfileOrderCounts();

  const counts = emptyProfileOrderCounts();
  for (const order of orders) {
    if (order.retailer !== retailer) continue;
    const email = orderEmailKey(order);
    if (email === UNKNOWN_ORDER_EMAIL || !emails.has(email)) continue;
    if (isSuccessfulOrder(order)) counts.successful += 1;
    else counts.cancelled += 1;
  }
  return counts;
}

export function cancelledOrderCountForProfile(
  profile: ProfileSummary,
  orders: ParsedOrder[],
  poolEmails: PoolEmail[],
): number {
  return orderCountsForProfile(profile, orders, poolEmails).cancelled;
}

export function orderCountsByProfileId(
  profiles: ProfileSummary[],
  orders: ParsedOrder[],
  poolEmails: PoolEmail[],
): Map<string, ProfileOrderCounts> {
  const counts = new Map<string, ProfileOrderCounts>();
  for (const profile of profiles) {
    const next = orderCountsForProfile(profile, orders, poolEmails);
    if (next.successful > 0 || next.cancelled > 0) counts.set(profile.id, next);
  }
  return counts;
}

export function cancelledOrderCountsByProfileId(
  profiles: ProfileSummary[],
  orders: ParsedOrder[],
  poolEmails: PoolEmail[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [profileId, next] of orderCountsByProfileId(profiles, orders, poolEmails)) {
    if (next.cancelled > 0) counts.set(profileId, next.cancelled);
  }
  return counts;
}

export function profilesMatchingOrderEmail(
  email: string,
  profiles: ProfileSummary[],
  poolEmails: PoolEmail[],
  retailer: OrderRetailer,
): ProfileSummary[] {
  const key = email.trim().toLowerCase();
  if (!key || key === UNKNOWN_ORDER_EMAIL.toLowerCase()) return [];
  const poolIds = new Set(
    poolEmails.filter((item) => item.email.trim().toLowerCase() === key).map((item) => item.id),
  );
  return profiles.filter((profile) => {
    if (!profileMatchesRetailer(profile, retailer)) return false;
    if (profile.email.trim().toLowerCase() === key) return true;
    return Boolean(profile.emailPoolId && poolIds.has(profile.emailPoolId));
  });
}

export function accountProfileContext(profile: ProfileSummary): AccountProfileContext {
  return {
    profileId: profile.id,
    profileName: profile.name?.trim() || "",
    billingName: profile.billingFullName?.trim() || "",
    line1: profile.billingAddressLine1?.trim() || "",
    line2: profile.billingAddressLine2?.trim() || "",
    city: profile.city?.trim() || "",
    state: profile.state?.trim() || "",
    postalCode: profile.postalCode?.trim() || "",
    paymentLabel: profile.creditCardLabel?.trim() || "",
    cardBrand: profile.cardBrand?.trim() || "",
    nameJigPresetName: profile.nameJigPresetName?.trim() || profile.jigPresetName?.trim() || "",
    addressJigPresetName: profile.addressJigPresetName?.trim() || profile.jigPresetName?.trim() || "",
    addressCheckStatus: profile.addressCheckStatus?.trim() || "",
    addressMasterMatch: profile.addressMasterMatch,
  };
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(part: number, whole: number): number | undefined {
  if (whole <= 0) return undefined;
  return part / whole;
}

export function isWarmupOrder(order: ParsedOrder): boolean {
  return order.fulfillment === "pickup" || order.status === "picked_up";
}

export function summarizeAccountOrders(
  email: string,
  retailer: OrderRetailer,
  orders: ParsedOrder[],
  profiles: AccountProfileContext[],
): AccountPerformance {
  const successTotals: number[] = [];
  const cancelledTotals: number[] = [];
  const allTotals: number[] = [];
  let successful = 0;
  let cancelled = 0;
  let inTransit = 0;
  let notShipped = 0;
  let pickedUp = 0;
  let warmup = 0;
  let delivered = 0;
  const orderValues: AccountOrderValue[] = [];
  for (const order of orders) {
    if (isSuccessfulOrder(order)) successful += 1;
    else cancelled += 1;
    if (isInTransitOrder(order)) inTransit += 1;
    if (isNotShippedOrder(order)) notShipped += 1;
    if (order.status === "picked_up") pickedUp += 1;
    if (isWarmupOrder(order)) warmup += 1;
    if (order.status === "delivered") delivered += 1;
    if (order.total != null) {
      allTotals.push(order.total);
      if (isSuccessfulOrder(order)) successTotals.push(order.total);
      else cancelledTotals.push(order.total);
    }
    orderValues.push({
      orderId: order.orderId,
      status: order.status,
      total: order.total,
      placedAt: order.placedAt,
    });
  }
  const successTotal = successTotals.reduce((sum, value) => sum + value, 0);
  const cancelledTotal = cancelledTotals.reduce((sum, value) => sum + value, 0);
  return {
    email,
    retailer,
    orders: orders.length,
    successful,
    cancelled,
    inTransit,
    notShipped,
    pickedUp,
    warmup,
    delivered,
    successTotal,
    cancelledTotal,
    avgOrderValue: average(allTotals),
    avgSuccessValue: average(successTotals),
    avgCancelledValue: average(cancelledTotals),
    successRate: rate(successful, orders.length),
    dollarSuccessRate: rate(successTotal, successTotal + cancelledTotal),
    profiles,
    orderValues,
  };
}

export function summarizeOrderAccounts(
  orders: ParsedOrder[],
  profiles: ProfileSummary[],
  poolEmails: PoolEmail[],
  retailer: OrderRetailer,
): AccountPerformance[] {
  const siteOrders = filterOrdersBySite(orders, retailer);
  const grouped = new Map<string, ParsedOrder[]>();
  for (const order of siteOrders) {
    const email = orderEmailKey(order);
    const list = grouped.get(email) ?? [];
    list.push(order);
    grouped.set(email, list);
  }
  const accounts: AccountPerformance[] = [];
  for (const [email, group] of grouped) {
    const matchedProfiles = profilesMatchingOrderEmail(email, profiles, poolEmails, retailer);
    const exact = matchedProfiles.filter((profile) => profile.email.trim().toLowerCase() === email);
    const chosen = exact[0] ?? matchedProfiles[0];
    accounts.push(summarizeAccountOrders(email, retailer, group, chosen ? [accountProfileContext(chosen)] : []));
  }
  return accounts.sort(
    (a, b) =>
      b.cancelledTotal - a.cancelledTotal ||
      b.cancelled - a.cancelled ||
      b.successTotal - a.successTotal ||
      a.email.localeCompare(b.email),
  );
}

export function accountDisplayName(account: AccountPerformance): string {
  return uniqueLabels(account.profiles.map((profile) => profile.profileName));
}

export function accountBillingName(account: AccountPerformance): string {
  return uniqueLabels(account.profiles.map((profile) => profile.billingName));
}

/** USPS last line: CITY, ST ZIP (comma optional; ZIP has no extra comma). */
function formatUspsLastLine(city: string, state: string, postalCode: string): string {
  const cityPart = city.trim();
  const statePart = state.trim();
  const zipPart = postalCode.trim();
  const locality = [cityPart, statePart].filter(Boolean).join(", ");
  return [locality, zipPart].filter(Boolean).join(" ");
}

export function accountJigLines(account: AccountPerformance): string[] {
  const profile = account.profiles[0];
  if (!profile) return [];
  return [
    profile.billingName,
    profile.line1,
    profile.line2,
    formatUspsLastLine(profile.city, profile.state, profile.postalCode),
  ].filter((line) => line.trim().length > 0);
}

export function accountAddress(account: AccountPerformance): string {
  return accountJigLines(account).slice(1).join(" ");
}

export function accountPaymentLines(account: AccountPerformance): { name: string; brand: string } {
  const name = uniqueLabels(account.profiles.map((profile) => profile.paymentLabel));
  const brand = uniqueLabels(account.profiles.map((profile) => profile.cardBrand));
  const brandShown = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "";
  return { name, brand: brandShown };
}

export function accountPaymentLabel(account: AccountPerformance): string {
  const { name, brand } = accountPaymentLines(account);
  return [name, brand].filter(Boolean).join(" ");
}

export function summarizeSitePerformance(orders: ParsedOrder[]) {
  let successful = 0;
  let cancelled = 0;
  let successTotal = 0;
  let cancelledTotal = 0;
  for (const order of orders) {
    if (isSuccessfulOrder(order)) {
      successful += 1;
      if (order.total != null) successTotal += order.total;
    } else {
      cancelled += 1;
      if (order.total != null) cancelledTotal += order.total;
    }
  }
  const total = successful + cancelled;
  return {
    successful,
    cancelled,
    successTotal,
    cancelledTotal,
    cancelRate: rate(cancelled, total),
    stickRate: rate(successful, total),
  };
}

export interface WeeklyPerformancePoint {
  weekStartMs: number;
  weekStartIso: string;
  label: string;
  successful: number;
  cancelled: number;
  total: number;
  successRate: number | undefined;
}

function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function summarizeWeeklyPerformance(
  orders: ParsedOrder[],
  weekCount = 12,
  now = new Date(),
): WeeklyPerformancePoint[] {
  const count = Math.max(1, Math.floor(weekCount));
  const thisWeek = startOfLocalWeek(now);
  const buckets = new Map<number, { successful: number; cancelled: number }>();
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - index * 7);
    buckets.set(start.getTime(), { successful: 0, cancelled: 0 });
  }

  const rangeStart = thisWeek.getTime() - (count - 1) * 7 * 24 * 60 * 60 * 1000;
  const rangeEnd = thisWeek.getTime() + 7 * 24 * 60 * 60 * 1000;
  for (const order of orders) {
    const placed = orderPlacedMs(order);
    if (!Number.isFinite(placed) || placed <= 0 || placed < rangeStart || placed >= rangeEnd) continue;
    const weekStart = startOfLocalWeek(new Date(placed)).getTime();
    const bucket = buckets.get(weekStart);
    if (!bucket) continue;
    if (isSuccessfulOrder(order)) bucket.successful += 1;
    else bucket.cancelled += 1;
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([weekStartMs, counts]) => {
      const total = counts.successful + counts.cancelled;
      const start = new Date(weekStartMs);
      return {
        weekStartMs,
        weekStartIso: toIsoDateLocal(start),
        label: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        successful: counts.successful,
        cancelled: counts.cancelled,
        total,
        successRate: rate(counts.successful, total),
      };
    });
}

export function accountSearchHaystack(account: AccountPerformance): string {
  return [
    account.email,
    accountDisplayName(account),
    accountBillingName(account),
    accountAddress(account),
    accountPaymentLabel(account),
    ...account.orderValues.map((order) => order.orderId),
  ]
    .join(" ")
    .toLowerCase();
}

export function toAccountPerformanceSnapshot(
  account: AccountPerformance,
  now = new Date(),
): AccountPerformanceSnapshot {
  return {
    generatedAt: now.toISOString(),
    site: account.retailer,
    account,
  };
}

export const LAST_ORDERS_PER_EMAIL = 5;

export type TimelineRailTone = "ok" | "cxl";

export interface TimelineFieldChanges {
  payment: boolean;
  address: boolean;
  profile: boolean;
  shipName: boolean;
}

export interface OrderAddressLines {
  street: string;
  line2: string;
  cityLine: string;
  pickup: boolean;
  shipName: string;
}

export interface AccountOrderTimeline {
  orders: ParsedOrder[];
  slots: Array<ParsedOrder | null>;
  cancelledInLast: number;
  succeededInLast: number;
  hint: string;
  recovered: boolean;
}

export function lastOrdersForEmail(
  orders: ParsedOrder[],
  retailer: OrderRetailer,
  email: string,
  limit = LAST_ORDERS_PER_EMAIL,
): ParsedOrder[] {
  return sortOrdersByPlaced(
    orders.filter((order) => order.retailer === retailer && orderEmailKey(order) === email),
  )
    .slice(0, limit)
    .reverse();
}

export function padTimelineSlots<T>(items: T[], limit = LAST_ORDERS_PER_EMAIL): Array<T | null> {
  const missing = Math.max(0, limit - items.length);
  return [...items, ...Array.from({ length: missing }, () => null)];
}

export function orderPaymentFingerprint(order: ParsedOrder): string {
  const last4 = order.payment?.last4?.trim() ?? "";
  const brand = (order.payment?.brand ?? "").trim().toLowerCase();
  if (brand || last4) return `${brand}|${last4}`;
  return (order.payment?.raw ?? "").trim().toLowerCase();
}

export function orderAddressFingerprint(order: ParsedOrder): string {
  if (isWarmupOrder(order) || order.shippingAddress?.source === "pickup") return "pickup";
  const address = order.shippingAddress;
  if (!address) return "";
  const key = [address.line1, address.line2, address.city, address.state, address.postalCode]
    .map((part) => (part ?? "").trim().toLowerCase())
    .join("|");
  if (key.replace(/\|/g, "")) return key;
  return (address.raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function orderProfileFingerprint(
  order: ParsedOrder,
  fallback = "",
  profiles: ProfileSummary[] = [],
  poolEmails: PoolEmail[] = [],
): string {
  return resolveOrderProfileName(order, profiles, poolEmails, fallback).toLowerCase();
}

export function resolveOrderProfileName(
  order: ParsedOrder,
  profiles: ProfileSummary[],
  poolEmails: PoolEmail[],
  fallback = "",
): string {
  const siteProfiles = profilesMatchingOrderEmail(
    orderEmailKey(order),
    profiles,
    poolEmails,
    order.retailer,
  );
  if (order.profileId) {
    const byId = siteProfiles.find((profile) => profile.id === order.profileId);
    if (byId?.name.trim()) return byId.name.trim();
  }
  const stored = order.profileName?.trim() ?? "";
  if (stored) {
    const byName = siteProfiles.find((profile) => profile.name.trim().toLowerCase() === stored.toLowerCase());
    if (byName?.name.trim()) return byName.name.trim();
  }
  const last4 = order.payment?.last4?.trim() ?? "";
  if (/^\d{4}$/.test(last4)) {
    const byCard = siteProfiles.filter((profile) => {
      const digits = parseCardNumberDigits(profile.paymentNumber ?? profile.cardNumberMasked ?? "");
      return digits.length >= 4 && digits.slice(-4) === last4;
    });
    if (byCard.length === 1 && byCard[0].name.trim()) return byCard[0].name.trim();
  }
  if (fallback.trim()) {
    const byFallback = siteProfiles.find(
      (profile) => profile.name.trim().toLowerCase() === fallback.trim().toLowerCase(),
    );
    if (byFallback?.name.trim()) return byFallback.name.trim();
  }
  return siteProfiles[0]?.name.trim() || fallback.trim();
}

export function orderShipNameFingerprint(order: ParsedOrder): string {
  if (isWarmupOrder(order) || order.shippingAddress?.source === "pickup") return "";
  return (order.shippingAddress?.name ?? "").trim().toLowerCase();
}

export function timelineFieldChanges(
  previous: ParsedOrder | null | undefined,
  current: ParsedOrder | null | undefined,
  fallbackProfile = "",
  profiles: ProfileSummary[] = [],
  poolEmails: PoolEmail[] = [],
): TimelineFieldChanges {
  if (!previous || !current) {
    return { payment: false, address: false, profile: false, shipName: false };
  }
  return {
    payment: orderPaymentFingerprint(previous) !== orderPaymentFingerprint(current),
    address: orderAddressFingerprint(previous) !== orderAddressFingerprint(current),
    profile:
      orderProfileFingerprint(previous, fallbackProfile, profiles, poolEmails) !==
      orderProfileFingerprint(current, fallbackProfile, profiles, poolEmails),
    shipName: orderShipNameFingerprint(previous) !== orderShipNameFingerprint(current),
  };
}

export function timelineRailTone(
  left: ParsedOrder | null | undefined,
  right: ParsedOrder | null | undefined,
): TimelineRailTone | null {
  if (!left || !right) return null;
  return isSuccessfulOrder(right) ? "ok" : "cxl";
}

export function orderAddressLines(order: ParsedOrder, fallback = ""): OrderAddressLines {
  if (isWarmupOrder(order) || order.shippingAddress?.source === "pickup") {
    const store = [order.shippingAddress?.name, order.shippingAddress?.city].filter(Boolean).join(" · ");
    return { street: "Pickup order", cityLine: store, line2: "", pickup: true, shipName: "" };
  }
  const address = order.shippingAddress;
  const shipName = address?.name?.trim() || "";
  const street = address?.line1?.trim() || "";
  const line2 = address?.line2?.trim() || "";
  const cityLine = formatUspsLastLine(address?.city ?? "", address?.state ?? "", address?.postalCode ?? "");
  if (street || line2 || cityLine) return { street, line2, cityLine, pickup: false, shipName };
  const raw = (formatOrderAddress(address) || fallback).replace(/\n+/g, ", ").trim();
  return { street: raw, line2: "", cityLine: "", pickup: false, shipName };
}

export function accountOrderTimeline(
  orders: ParsedOrder[],
  retailer: OrderRetailer,
  email: string,
): AccountOrderTimeline {
  const last = lastOrdersForEmail(orders, retailer, email);
  const cancelledInLast = last.filter((order) => !isSuccessfulOrder(order)).length;
  const succeededInLast = last.length - cancelledInLast;
  const newest = last[last.length - 1];
  const recovered = Boolean(newest && isSuccessfulOrder(newest));
  const windowLabel = last.length >= LAST_ORDERS_PER_EMAIL ? "last 5" : `last ${last.length}`;
  return {
    orders: last,
    slots: last,
    cancelledInLast,
    succeededInLast,
    recovered,
    hint: recovered ? "recovered" : `${cancelledInLast} cancelled in ${windowLabel}`,
  };
}
