/** Localhost orders export. Keep the public fields in sync with src-tauri/src/orders_api.rs. */

export const ORDERS_API_PORT = 47321;
export const ORDERS_API_BASE = `http://127.0.0.1:${ORDERS_API_PORT}`;

const ORDER_STATUSES = new Set(["placed", "shipped", "delivered", "picked_up", "cancelled"]);
const ORDER_RETAILERS = new Set(["target", "walmart", "pokemon-center"]);

export interface OrdersApiSettings {
  enabled: boolean;
  token: string;
}

export interface OrdersApiQuery {
  id?: string;
  status?: string;
  retailer?: string;
  since?: string;
}

export interface OrdersApiExport {
  exportedAt: string;
  count: number;
  orders: Record<string, unknown>[];
}

export function createOrdersApiToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** ISO date or datetime with Z or a numeric offset. Date-only values are UTC midnight. */
export function parseApiTimeMs(value: string): number | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hasTime = match[4] != null;
  if (hasTime && !match[8]) return null;
  const hour = hasTime ? Number(match[4]) : 0;
  const minute = hasTime ? Number(match[5]) : 0;
  const second = hasTime ? Number(match[6]) : 0;
  const fraction = match[7] ? match[7].slice(1, 4).padEnd(3, "0") : "0";
  const millis = Number(fraction);
  if (hour > 23 || minute > 59 || second > 59 || millis > 999) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  if (!Number.isFinite(utc)) return null;
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  const zone = match[8];
  if (!zone || zone === "Z") return utc;
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  if (!Number.isFinite(offsetMin)) return null;
  return utc - offsetMin * 60_000;
}

export function parseOrdersApiQuery(
  params: URLSearchParams,
): { query: OrdersApiQuery } | { error: string } {
  const id = params.get("id")?.trim() || undefined;
  const status = params.get("status")?.trim() || undefined;
  const retailer = params.get("retailer")?.trim() || undefined;
  const since = params.get("since")?.trim() || undefined;
  if (status && !ORDER_STATUSES.has(status)) {
    return { error: "status must be placed, shipped, delivered, picked_up, or cancelled." };
  }
  if (retailer && !ORDER_RETAILERS.has(retailer)) {
    return { error: "retailer must be target, walmart, or pokemon-center." };
  }
  if (since && parseApiTimeMs(since) == null) {
    return { error: "since must be an ISO date or datetime, such as 2026-10-16T00:00:00Z." };
  }
  return { query: { id, status, retailer, since } };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function amount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function toPublicOrder(raw: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(raw.items)
    ? raw.items.flatMap((item) => {
        const row = record(item);
        const name = text(row?.name);
        const quantity = amount(row?.quantity);
        if (!row || !name || quantity == null || quantity <= 0) return [];
        const price = amount(row.price);
        return [{ name, quantity, ...(price != null && price > 0 ? { price } : {}) }];
      })
    : [];
  const address = record(raw.shippingAddress);
  const payment = record(raw.payment);
  const events = Array.isArray(raw.events)
    ? raw.events.flatMap((event) => {
        const row = record(event);
        const kind = text(row?.kind);
        if (!row || !kind) return [];
        return [{ kind, subject: text(row.subject), date: text(row.date) }];
      })
    : [];
  return {
    id: text(raw.id),
    retailer: text(raw.retailer),
    orderId: text(raw.orderId),
    status: text(raw.status),
    fulfillment: text(raw.fulfillment),
    total: amount(raw.total),
    currency: text(raw.currency),
    trackingNumber: text(raw.trackingNumber),
    carrier: text(raw.carrier),
    expectedDelivery: text(raw.expectedDelivery),
    items,
    recipientEmail: text(raw.recipientEmail),
    shippingAddress: address
      ? {
          name: text(address.name),
          line1: text(address.line1),
          line2: text(address.line2),
          city: text(address.city),
          state: text(address.state),
          postalCode: text(address.postalCode),
          source: text(address.source),
        }
      : null,
    payment: payment
      ? {
          brand: text(payment.brand),
          last4: text(payment.last4),
        }
      : null,
    profileName: text(raw.profileName),
    cancelReason: text(raw.cancelReason),
    events,
    placedAt: text(raw.placedAt),
    updatedAt: text(raw.updatedAt),
  };
}

export function exportOrdersPayload(
  orders: Record<string, unknown>,
  dismissed: Record<string, unknown>,
  query: OrdersApiQuery,
  now = new Date(),
): OrdersApiExport | { error: string; status: 404 } {
  const dismissedIds = new Set(Object.keys(dismissed));
  const sinceMs = query.since ? parseApiTimeMs(query.since) : null;
  const rows = Object.values(orders).flatMap((value) => {
    const order = record(value);
    if (!order) return [];
    const id = text(order.id) ?? "";
    if (!id || dismissedIds.has(id)) return [];
    if (query.id && id !== query.id && text(order.orderId) !== query.id) return [];
    if (query.status && order.status !== query.status) return [];
    if (query.retailer && order.retailer !== query.retailer) return [];
    if (sinceMs != null) {
      const updated = parseApiTimeMs(String(order.updatedAt ?? ""));
      if (updated == null || updated < sinceMs) return [];
    }
    return [order];
  });
  rows.sort((a, b) => {
    const placed = (parseApiTimeMs(String(b.placedAt ?? "")) ?? 0) - (parseApiTimeMs(String(a.placedAt ?? "")) ?? 0);
    if (placed !== 0) return placed;
    return String(b.orderId ?? "").localeCompare(String(a.orderId ?? ""));
  });
  if (query.id && rows.length === 0) {
    return { error: "Order not found.", status: 404 };
  }
  const exported = rows.map(toPublicOrder);
  return {
    exportedAt: now.toISOString(),
    count: exported.length,
    orders: exported,
  };
}
