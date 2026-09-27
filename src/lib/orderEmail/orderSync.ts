import type { ParsedOrder } from "../types";

type OrdersListener = (orders: ParsedOrder[]) => void;

const listeners = new Set<OrdersListener>();
let current: ParsedOrder[] | null = null;

/** Orders produced by the latest mail catch-up. Null until that pass finishes. */
export function syncedOrders(): ParsedOrder[] | null {
  return current;
}

export function publishSyncedOrders(orders: ParsedOrder[]): void {
  current = orders;
  for (const listener of listeners) listener(orders);
}

export function subscribeSyncedOrders(listener: OrdersListener): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => {
    listeners.delete(listener);
  };
}
