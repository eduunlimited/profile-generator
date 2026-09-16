import { addressHouseKey } from "../addressCheck";
import type { MasterProfile, ParsedOrder, PoolEmail, ProfileSummary } from "../types";
import { isInTransitOrder } from "./dashboard";
import { profilesMatchingOrderEmail } from "./performance";

export const INCOMING_VISIBLE_ROWS = 3;
export const INCOMING_ROW_PX = 28;

export interface IncomingShipment {
  orderId: string;
  tracking: string;
  eta: string;
}

export interface IncomingHouse {
  id: string;
  addressLine: string;
  shipments: IncomingShipment[];
}

function meaningfulHouseKey(key: string): boolean {
  return key.replace(/\|/g, "").trim().length > 0;
}

export function orderHouseKey(order: ParsedOrder): string {
  const address = order.shippingAddress;
  if (!address) return "";
  return addressHouseKey({
    street: address.line1?.trim() || "",
    city: address.city?.trim() || "",
    state: address.state?.trim() || "",
    postalCode: address.postalCode?.trim() || "",
  });
}

export function formatMasterAddressLine(master: MasterProfile): string {
  const street = master.address.street.trim();
  const city = master.address.city.trim();
  const state = master.address.state.trim();
  const zip = master.address.postalCode.trim();
  const cityLine = [city, state].filter(Boolean).join(", ");
  return [street, [cityLine, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

function formatParsedAddressLine(order: ParsedOrder): string {
  const address = order.shippingAddress;
  if (!address) return "Unmatched";
  const street = address.line1?.trim() || "";
  const city = address.city?.trim() || "";
  const state = address.state?.trim() || "";
  const zip = address.postalCode?.trim() || "";
  const cityLine = [city, state].filter(Boolean).join(", ");
  const line = [street, [cityLine, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return line || address.raw.trim() || "Unmatched";
}

function masterForOrder(
  order: ParsedOrder,
  masters: MasterProfile[],
  profiles: ProfileSummary[],
  poolEmails: PoolEmail[],
): MasterProfile | undefined {
  const matches = profilesMatchingOrderEmail(
    order.recipientEmail ?? "",
    profiles,
    poolEmails,
    order.retailer,
  );
  for (const profile of matches) {
    const master = masters.find((item) => item.id === profile.masterProfileId);
    if (master) return master;
  }
  const key = orderHouseKey(order);
  if (!meaningfulHouseKey(key)) return undefined;
  return masters.find((master) => addressHouseKey(master.address) === key);
}

function toShipment(order: ParsedOrder): IncomingShipment {
  return {
    orderId: order.id,
    tracking: order.trackingNumber?.trim() || "—",
    eta: "—",
  };
}

export function groupIncomingHouses(
  orders: ParsedOrder[],
  masters: MasterProfile[],
  profiles: ProfileSummary[],
  poolEmails: PoolEmail[],
): IncomingHouse[] {
  const groups = new Map<string, IncomingHouse>();
  for (const order of orders) {
    if (!isInTransitOrder(order)) continue;
    const master = masterForOrder(order, masters, profiles, poolEmails);
    const key = master ? `master:${master.id}` : `house:${orderHouseKey(order) || order.id}`;
    const previous = groups.get(key);
    const shipment = toShipment(order);
    if (previous) {
      previous.shipments.push(shipment);
      continue;
    }
    groups.set(key, {
      id: key,
      addressLine: master ? formatMasterAddressLine(master) : formatParsedAddressLine(order),
      shipments: [shipment],
    });
  }
  return [...groups.values()].sort(
    (a, b) => b.shipments.length - a.shipments.length || a.addressLine.localeCompare(b.addressLine),
  );
}

export function filterIncomingHouses(houses: IncomingHouse[], query: string): IncomingHouse[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return houses;
  return houses
    .map((house) => ({
      ...house,
      shipments: house.shipments.filter((shipment) => {
        const haystack = `${house.addressLine} ${shipment.tracking} ${shipment.eta}`.toLowerCase();
        return haystack.includes(needle);
      }),
    }))
    .filter((house) => house.shipments.length > 0);
}
