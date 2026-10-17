import { listOrders } from "./api";
import type { ParsedOrder } from "./types";

export const POKEMON_TRACKER_ORDERS_URL = "https://pokemon-tracker-kappa-murex.vercel.app/api/profile-orders";

export interface PokemonTrackerPushSettings {
  url: string;
  token: string;
}

export interface PokemonTrackerPushResult {
  skipped?: boolean;
  message: string;
}

type PushOrder = {
  id: string;
  retailer: string;
  orderId: string;
  status: string;
  total: number | null;
  placedAt: string;
};

function toPushOrder(order: ParsedOrder): PushOrder {
  return {
    id: order.id,
    retailer: order.retailer,
    orderId: order.orderId,
    status: order.status,
    total: typeof order.total === "number" ? order.total : null,
    placedAt: order.placedAt,
  };
}

async function readSettings(): Promise<PokemonTrackerPushSettings> {
  const { getPokemonTrackerPushSettings } = await import("./api");
  return getPokemonTrackerPushSettings();
}

export async function pushOrdersToPokemonTracker(
  orders: ParsedOrder[],
  settings?: PokemonTrackerPushSettings,
  probe = false,
): Promise<PokemonTrackerPushResult> {
  const stored = settings ?? (await readSettings());
  const url = stored.url.trim();
  const token = stored.token.trim();
  if (!url || !token) {
    return { skipped: true, message: "Add the Pokemon Tracker address and API key first." };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(probe ? { probe: true } : { orders: orders.map(toPushOrder) }),
  });
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(body?.message?.trim() || `Pokemon Tracker returned ${response.status}.`);
  }
  return { message: body?.message?.trim() || "Orders sent." };
}

let pushTimer = 0;

/** Send the latest full order list after the hourly refresh settles. */
export function schedulePokemonTrackerPush(orders: ParsedOrder[]): void {
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    void pushOrdersToPokemonTracker(orders).catch((error: unknown) => {
      console.error("Pokemon Tracker order push failed.", error);
    });
  }, 2000);
}

export async function pushCurrentOrdersToPokemonTracker(
  settings?: PokemonTrackerPushSettings,
): Promise<PokemonTrackerPushResult> {
  return pushOrdersToPokemonTracker(await listOrders(), settings);
}
