import { addressHouseKey } from "../addressCheck";
import type { MasterProfile, ParsedOrder, PoolEmail, ProfileSummary } from "../types";
import { isInTransitOrder, retailerLabel } from "./dashboard";
import { profilesMatchingOrderEmail } from "./performance";

export const INCOMING_VISIBLE_ROWS = 3;
export const INCOMING_ROW_PX = 28;

export interface IncomingShipment {
  orderId: string;
  tracking: string;
  site: string;
  eta: string;
}

export interface IncomingHouse {
  id: string;
  addressLine: string;
  shipments: IncomingShipment[];
}

const UNIT_TOKEN = /^(?:apt\.?|apartment|ste\.?|suite|#|unit|rm\.?|room|door|fl\.?|floor)$/i;
const UNIT_SUFFIX = /[, ]+(?:apt\.?|apartment|ste\.?|suite|unit|rm\.?|room|door|#)\s*[a-z0-9-]+$/i;
const STREET_TYPES: Record<string, string> = {
  street: "st",
  str: "st",
  st: "st",
  avenue: "ave",
  ave: "ave",
  boulevard: "blvd",
  blvd: "blvd",
  drive: "dr",
  dr: "dr",
  lane: "ln",
  ln: "ln",
  road: "rd",
  rd: "rd",
  court: "ct",
  ct: "ct",
  place: "pl",
  pl: "pl",
  circle: "cir",
  cir: "cir",
  terrace: "ter",
  ter: "ter",
  way: "way",
};
const DIRECTIONS: Record<string, string> = {
  n: "n",
  north: "n",
  s: "s",
  south: "s",
  e: "e",
  east: "e",
  w: "w",
  west: "w",
  ne: "ne",
  northeast: "ne",
  se: "se",
  southeast: "se",
  nw: "nw",
  northwest: "nw",
  sw: "sw",
  southwest: "sw",
};
const STREET_TYPE_TOKENS = new Set(Object.values(STREET_TYPES));
const DIRECTION_TOKENS = new Set(Object.values(DIRECTIONS));

function meaningfulHouseKey(key: string): boolean {
  return key.replace(/\|/g, "").trim().length > 0;
}

function zip5(value?: string): string {
  return (value ?? "").replace(/\D/g, "").slice(0, 5);
}

function stripUnit(street: string): string {
  let next = street.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = next.replace(UNIT_SUFFIX, "").replace(/\s+#\s*[a-z0-9-]+$/i, "").trim();
    if (stripped === next) break;
    next = stripped;
  }
  return next;
}

export function streetCore(street: string): string {
  const tokens = stripUnit(street)
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token, index, all) => {
      if (UNIT_TOKEN.test(token)) return false;
      return !(index > 0 && UNIT_TOKEN.test(all[index - 1] ?? "") && /^[a-z0-9-]+$/i.test(token));
    })
    .map((token) => STREET_TYPES[token] ?? DIRECTIONS[token] ?? token);
  return tokens.join(" ");
}

function coresCompatible(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const number = (value: string) => value.match(/^\d+/)?.[0] ?? "";
  const rest = (value: string) => value.replace(/^\d+[a-z]?\s*/i, "");
  return number(left) === number(right) && rest(left) === rest(right) && number(left) !== "";
}

function streetNameKey(street: string): string {
  return streetCore(street)
    .split(/\s+/)
    .filter(
      (token) => token && !/^\d+[a-z]?$/i.test(token) && !STREET_TYPE_TOKENS.has(token) && !DIRECTION_TOKENS.has(token),
    )
    .join(" ");
}

function hydrateOrderAddress(order: ParsedOrder): {
  street: string;
  city: string;
  state: string;
  postalCode: string;
} {
  const address = order.shippingAddress;
  let street = [address?.line1, address?.line2].filter(Boolean).join(" ").trim();
  let city = address?.city?.trim() ?? "";
  let state = address?.state?.trim() ?? "";
  let postalCode = address?.postalCode?.trim() ?? "";
  if (!city || !state || !zip5(postalCode)) {
    const blob = [street, address?.raw].filter(Boolean).join(", ").replace(/\s+/g, " ").trim();
    const match = blob.match(/^(.*),\s*([^,]+),\s*([A-Za-z]{2}),?\s+(\d{5})(?:-\d{4})?\s*$/);
    if (match) {
      street = match[1].trim() || street;
      city = city || match[2].trim();
      state = state || match[3].trim();
      postalCode = postalCode || match[4].trim();
    }
  }
  return { street, city, state, postalCode };
}

export function orderHouseKey(order: ParsedOrder): string {
  const address = hydrateOrderAddress(order);
  if (!address.street && !address.city && !address.postalCode) return "";
  return addressHouseKey({
    street: address.street,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
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

function unmatchedAddressLine(order: ParsedOrder): string {
  const address = hydrateOrderAddress(order);
  const cityLine = [address.city, address.state].filter(Boolean).join(", ");
  const place = [cityLine, address.postalCode].filter(Boolean).join(" ");
  return place ? `Unmatched · ${place}` : "Unmatched";
}

function masterFromProfile(
  profile: ProfileSummary | undefined,
  masters: MasterProfile[],
): MasterProfile | undefined {
  if (!profile?.masterProfileId) return undefined;
  return masters.find((item) => item.id === profile.masterProfileId);
}

function locationCompatible(order: ParsedOrder, master: MasterProfile): boolean {
  const address = hydrateOrderAddress(order);
  const city = address.city.trim().toLowerCase();
  const state = address.state.trim().toLowerCase();
  const postal = zip5(address.postalCode);
  const masterCity = master.address.city.trim().toLowerCase();
  const masterState = master.address.state.trim().toLowerCase();
  const masterZip = zip5(master.address.postalCode);
  if (postal && masterZip) return postal === masterZip;
  if (city && state) return city === masterCity && state === masterState;
  return true;
}

function streetNameCompatible(order: ParsedOrder, master: MasterProfile): boolean {
  const orderName = streetNameKey(hydrateOrderAddress(order).street);
  const masterName = streetNameKey(master.address.street);
  if (!orderName || !masterName) return true;
  return orderName === masterName;
}

function masterIfCompatible(
  master: MasterProfile | undefined,
  order: ParsedOrder,
): MasterProfile | undefined {
  if (!master || !locationCompatible(order, master)) return undefined;
  return streetNameCompatible(order, master) ? master : undefined;
}

function pickUniqueMaster(matches: MasterProfile[]): MasterProfile | undefined {
  const unique = [...new Map(matches.map((master) => [master.id, master])).values()];
  return unique.length === 1 ? unique[0] : undefined;
}

function profilesForOrderEmail(
  order: ParsedOrder,
  profiles: ProfileSummary[],
  poolEmails: PoolEmail[],
): ProfileSummary[] {
  const keyed = profilesMatchingOrderEmail(
    order.recipientEmail ?? "",
    profiles,
    poolEmails,
    order.retailer,
  );
  if (keyed.length > 0) return keyed;
  const email = order.recipientEmail?.trim().toLowerCase() ?? "";
  if (!email) return [];
  const poolIds = new Set(
    poolEmails.filter((item) => item.email.trim().toLowerCase() === email).map((item) => item.id),
  );
  return profiles.filter((profile) => {
    if (profile.email.trim().toLowerCase() === email) return true;
    return Boolean(profile.emailPoolId && poolIds.has(profile.emailPoolId));
  });
}

function masterForOrder(
  order: ParsedOrder,
  masters: MasterProfile[],
  profiles: ProfileSummary[],
  poolEmails: PoolEmail[],
): MasterProfile | undefined {
  const key = orderHouseKey(order);
  if (meaningfulHouseKey(key)) {
    const byHouse = masters.find((master) => addressHouseKey(master.address) === key);
    if (byHouse) return byHouse;
  }

  const hydrated = hydrateOrderAddress(order);
  const orderCore = streetCore(hydrated.street);
  if (orderCore) {
    const byStreet = masters.find(
      (master) => coresCompatible(orderCore, streetCore(master.address.street)) && locationCompatible(order, master),
    );
    if (byStreet) return byStreet;
  }

  const orderName = streetNameKey(hydrated.street);
  if (orderName) {
    const unique = pickUniqueMaster(
      masters.filter(
        (master) => streetNameKey(master.address.street) === orderName && locationCompatible(order, master),
      ),
    );
    if (unique) return unique;
  }

  for (const profile of profilesForOrderEmail(order, profiles, poolEmails)) {
    const master = masterIfCompatible(masterFromProfile(profile, masters), order);
    if (master) return master;
  }

  if (order.profileId) {
    return masterIfCompatible(
      masterFromProfile(
        profiles.find((profile) => profile.id === order.profileId),
        masters,
      ),
      order,
    );
  }

  return undefined;
}

export function masterAddressForOrder(
  order: ParsedOrder,
  masters: MasterProfile[],
  profiles: ProfileSummary[],
  poolEmails: PoolEmail[],
): string | undefined {
  const master = masterForOrder(order, masters, profiles, poolEmails);
  return master ? formatMasterAddressLine(master) : undefined;
}

function toShipment(order: ParsedOrder): IncomingShipment {
  return {
    orderId: order.id,
    tracking: order.trackingNumber?.trim() || "—",
    site: retailerLabel(order.retailer),
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
    const key = master
      ? `master:${master.id}`
      : `house:${orderHouseKey(order) || streetCore(hydrateOrderAddress(order).street) || order.id}`;
    const previous = groups.get(key);
    const shipment = toShipment(order);
    if (previous) {
      previous.shipments.push(shipment);
      continue;
    }
    groups.set(key, {
      id: key,
      addressLine: master ? formatMasterAddressLine(master) : unmatchedAddressLine(order),
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
        const haystack = `${house.addressLine} ${shipment.tracking} ${shipment.site} ${shipment.eta}`.toLowerCase();
        return haystack.includes(needle);
      }),
    }))
    .filter((house) => house.shipments.length > 0);
}
