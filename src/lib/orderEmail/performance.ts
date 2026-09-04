import type { OrderRetailer, OrderStatus, ParsedOrder, PoolEmail, ProfileSummary } from "../types";
import {
  filterOrdersBySite,
  isInTransitOrder,
  isNotShippedOrder,
  isSuccessfulOrder,
  orderEmailKey,
  retailerLabel,
  UNKNOWN_ORDER_EMAIL,
} from "./dashboard";

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

export function profileMatchesRetailer(profile: ProfileSummary, retailer: OrderRetailer): boolean {
  const site = profile.accountSite?.trim();
  if (!site) return false;
  const normalized = site.toLowerCase().replace(/\s+/g, "-");
  return normalized === retailer || site.toLowerCase() === retailerLabel(retailer).toLowerCase();
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
