import type {
  AddressRule,
  AddressRuleType,
  JigPreset,
  MasterProfile,
  NameRule,
  Profile,
  ProfileAddress,
  ProfileName,
  NameMisspellScope,
} from "./types";
import { cloneProfileName, namePartsForMisspell, resolveProfileNameBase } from "./profileNameUtils";
import { buildMisspellRequest, buildStreetVariationHint, misspellBatchWithOpenAi, misspellWithOpenAi } from "./openaiMisspell";
import type { OpenAiMisspellResult } from "./openaiMisspell";
const STREET_ABBREVIATIONS: Record<string, string> = {
  street: "St",
  avenue: "Ave",
  boulevard: "Blvd",
  drive: "Dr",
  lane: "Ln",
  road: "Rd",
  court: "Ct",
  place: "Pl",
};

const UNIT_LINE_TEMPLATES = [
  "Apt {n}",
  "Apt. {n}",
  "Apartment {n}",
  "Ste {n}",
  "Suite {n}",
  "# {n}",
  "Unit {n}",
  "Room {n}",
  "Door {n}",
  "1{letter}",
];

const UNIT_NUMBER_MIN = 1;
const UNIT_NUMBER_MAX = 100;

/** Same jigged line 1 may be used on this many profiles per category. */
export const MAX_STREET_LINE1_USES = 3;

const STREET_TYPE_PAIRS = [
  { key: "street", long: "Street", short: "St", match: /^(street|str\.?|st\.?)$/i },
  { key: "drive", long: "Drive", short: "Dr", match: /^(drive|dr\.?)$/i },
  { key: "avenue", long: "Avenue", short: "Ave", match: /^(avenue|ave\.?)$/i },
  { key: "place", long: "Place", short: "Pl", match: /^(place|pl\.?)$/i },
] as const;

const DIRECTION_GROUPS = [
  {
    key: "SE",
    match: /^(se|s\.e\.?|southeast|south[\s-]+east)$/i,
    variants: ["SE", "S.E.", "Southeast", "South East"],
  },
  {
    key: "NE",
    match: /^(ne|n\.e\.?|northeast|north[\s-]+east)$/i,
    variants: ["NE", "N.E.", "Northeast", "North East"],
  },
  {
    key: "NW",
    match: /^(nw|n\.w\.?|northwest|north[\s-]+west)$/i,
    variants: ["NW", "N.W.", "Northwest", "North West"],
  },
  {
    key: "SW",
    match: /^(sw|s\.w\.?|southwest|south[\s-]+west)$/i,
    variants: ["SW", "S.W.", "Southwest", "South West"],
  },
] as const;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUnitNumber(): string {
  return randomInt(UNIT_NUMBER_MIN, UNIT_NUMBER_MAX).toString();
}

function randomUnitLetter(): string {
  return randomUpperLetters(1);
}

function substituteUnitFormat(template: string): string {
  return template
    .replace(/\{random\}/gi, () => randomUnitNumber())
    .replace(/\{n\}/gi, () => randomUnitNumber())
    .replace(/\{letter\}/gi, () => randomUnitLetter());
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function tokenizeStreet(street: string): string[] {
  return street.trim().split(/\s+/).filter(Boolean);
}

function titleCaseStreetName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function matchStreetType(token: string): (typeof STREET_TYPE_PAIRS)[number] | null {
  return STREET_TYPE_PAIRS.find((pair) => pair.match.test(token)) ?? null;
}

function matchDirection(value: string): (typeof DIRECTION_GROUPS)[number] | null {
  return DIRECTION_GROUPS.find((group) => group.match.test(value.trim())) ?? null;
}

function consumeTrailingDirection(tokens: string[]): {
  group: (typeof DIRECTION_GROUPS)[number];
  remaining: string[];
} | null {
  if (tokens.length === 0) return null;
  if (tokens.length >= 2) {
    const two = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`;
    const group = matchDirection(two);
    if (group) {
      return { group, remaining: tokens.slice(0, -2) };
    }
  }
  const group = matchDirection(tokens[tokens.length - 1] ?? "");
  if (group) {
    return { group, remaining: tokens.slice(0, -1) };
  }
  return null;
}

function applyStreetTypeCombo(street: string): string {
  const tokens = tokenizeStreet(street);
  if (tokens.length === 0) return street;

  const direction = consumeTrailingDirection(tokens);
  const afterDirection = direction?.remaining ?? tokens;
  const typeToken = afterDirection[afterDirection.length - 1];
  const matchedType = typeToken ? matchStreetType(typeToken) : null;
  const coreTokens = matchedType ? afterDirection.slice(0, -1) : afterDirection;

  if (!matchedType && !direction) {
    return street;
  }

  const house = coreTokens[0] && /^\d/.test(coreTokens[0]) ? coreTokens[0] : "";
  const nameTokens = house ? coreTokens.slice(1) : coreTokens;
  const name = titleCaseStreetName(nameTokens.join(" "));

  const typePair = matchedType ? pickRandom(STREET_TYPE_PAIRS) : null;
  const typeText = typePair ? (Math.random() < 0.5 ? typePair.short : typePair.long) : "";
  const directionText = direction ? pickRandom(direction.group.variants) : "";

  return [house, name, typeText, directionText].filter(Boolean).join(" ");
}

function randomLetters(count: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: count }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function isNameMisspellRule(rule: NameRule): boolean {
  return rule.type === "nameMisspell" || rule.type === "misspell";
}

function isStreetMisspellRule(rule: AddressRule): boolean {
  return rule.type === "misspellField";
}

const LINE2_ADDRESS_RULE_TYPES = new Set<AddressRuleType>([
  "randomUnitLine",
  "addUnit",
  "addSuite",
  "splitLines",
]);

/** True when any rule changes street line 1 (not apt/suite line 2). */
export function addressRulesChangeStreetLine(rules: AddressRule[]): boolean {
  return rules.some((rule) => !LINE2_ADDRESS_RULE_TYPES.has(rule.type));
}

function stripMisspellFromNameRules(rules: NameRule[]): NameRule[] {
  return rules.filter((rule) => !isNameMisspellRule(rule));
}

function stripMisspellFromAddressRules(rules: AddressRule[]): AddressRule[] {
  return rules.filter((rule) => !isStreetMisspellRule(rule));
}

function applyRandomAffix(value: string, rule: NameRule | AddressRule, position: "prefix" | "suffix"): string {
  const count = rule.charCount ?? randomInt(1, 3);
  const letters = randomLetters(count);
  return position === "prefix" ? `${letters}${value}` : `${value}${letters}`;
}
function randomUpperLetters(count: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from({ length: count }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function applyStreetRandomLetters(street: string, rule: AddressRule): string {
  const count = rule.charCount ?? randomInt(1, 4);
  const mode = rule.affixMode ?? "both";
  let value = street.trim();
  if (mode === "prefix" || mode === "both") {
    value = `${randomUpperLetters(count)} ${value}`;
  }
  if (mode === "suffix" || mode === "both") {
    value = `${value} ${randomUpperLetters(count)}`;
  }
  return value;
}

function applyRandomUnitLine(): string {
  const template = UNIT_LINE_TEMPLATES[Math.floor(Math.random() * UNIT_LINE_TEMPLATES.length)];
  return substituteUnitFormat(template);
}

function applyNameRulesForProfile(
  name: ProfileName,
  rules: NameRule[],
  misspellScope: NameMisspellScope = "both",
): string {
  const first = name.first.trim();
  const last = name.last.trim();
  const onlyMisspellRules = rules.every((rule) => isNameMisspellRule(rule));

  if (first && last && onlyMisspellRules) {
    void misspellScope;
    return `${first} ${last}`.trim();
  }
  return applyNameRules(resolveProfileNameBase(name), rules);
}

export function applyNameRules(fullName: string, rules: NameRule[]): string {
  let value = fullName;
  for (const rule of rules) {
    switch (rule.type) {
      case "truncate":
        if (rule.maxLength) value = value.slice(0, rule.maxLength);
        break;
      case "appendSuffix":
        if (rule.suffix) value = `${value}${rule.suffix}`;
        break;
      case "removeSpaces":
        value = value.replace(/\s+/g, "");
        break;
      case "toUpperCase":
        value = value.toUpperCase();
        break;
      case "toTitleCase":
        value = value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
        break;
      case "addHyphen":
        value = value.replace(/\s+/g, "-");
        break;
      case "misspell":
      case "nameMisspell":
        break;      case "prefixRandom":
        value = applyRandomAffix(value, rule, "prefix");
        break;
      case "suffixRandom":
        value = applyRandomAffix(value, rule, "suffix");
        break;
      case "insertRandomLetters": {
        const count = rule.charCount ?? 2;
        const index = Math.max(1, Math.floor(Math.random() * (value.length - 1)));
        value = value.slice(0, index) + randomLetters(count) + value.slice(index);
        break;
      }
      default:
        break;
    }
  }
  return value;
}

function abbreviateStreet(street: string): string {
  return street.replace(
    /\b(street|avenue|boulevard|drive|lane|road|court|place)\b/gi,
    (match) => STREET_ABBREVIATIONS[match.toLowerCase()] ?? match,
  );
}

export function formatAddress(address: ProfileAddress): string {
  const lines = [address.street];
  if (address.unit) lines.push(address.unit);
  lines.push(`${address.city}, ${address.state} ${address.postalCode}`);
  if (address.country) lines.push(address.country);
  return lines.join("\n");
}

function applyFieldRule(value: string, rule: AddressRule): string {
  switch (rule.type) {
    case "prefixRandom":      return applyRandomAffix(value, rule, "prefix");
    case "suffixRandom":
      return applyRandomAffix(value, rule, "suffix");
    default:
      return value;
  }
}

export function applyAddressRules(address: ProfileAddress, rules: AddressRule[]): ProfileAddress {
  const next: ProfileAddress = { ...address };

  for (const rule of rules) {
    switch (rule.type) {
      case "abbreviate":
        next.street = abbreviateStreet(next.street);
        break;
      case "streetTypeCombo":
        next.street = applyStreetTypeCombo(next.street);
        break;
      case "addUnit":
        next.unit = substituteUnitFormat(rule.unitFormat ?? "Apt {random}");
        break;
      case "addSuite":
        next.unit = substituteUnitFormat(rule.unitFormat ?? "Suite {random}");
        break;
      case "randomUnitLine":
        next.unit = applyRandomUnitLine();
        break;
      case "streetRandomLetters":
        next.street = applyStreetRandomLetters(next.street, rule);
        break;
      case "poBox":
        next.street = `PO Box ${randomInt(1000, 9999)}`;
        next.unit = undefined;
        break;
      case "truncateField":
        if (rule.field && rule.maxLength && typeof next[rule.field] === "string") {
          next[rule.field] = (next[rule.field] as string).slice(0, rule.maxLength);
        }
        break;
      case "misspellField":
        break;
      case "prefixRandom":
      case "suffixRandom":
        if (rule.field && typeof next[rule.field] === "string") {
          next[rule.field] = applyFieldRule(next[rule.field] as string, rule);
        } else {
          next.street = applyFieldRule(next.street, rule);
        }
        break;
      case "splitLines":
        next.formatted = formatAddress(next);
        break;
      default:
        break;
    }
  }

  next.formatted = next.formatted ?? formatAddress(next);
  return next;
}

export function streetLineFingerprint(street: string): string {
  return street.trim().toLowerCase();
}

/** Deduped street line 1 strings (preserves one casing variant per fingerprint). */
export function collectUniqueStreetLines(streets: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const street of streets) {
    const fingerprint = streetLineFingerprint(street);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    lines.push(street.trim());
  }
  return lines;
}

export function streetUseCount(counts: Map<string, number>, fingerprint: string): number {
  return counts.get(fingerprint) ?? 0;
}

export function canAssignStreetLine(
  counts: Map<string, number>,
  fingerprint: string,
  maxUses = MAX_STREET_LINE1_USES,
): boolean {
  return streetUseCount(counts, fingerprint) < maxUses;
}

export function incrementStreetUse(counts: Map<string, number>, fingerprint: string): number {
  const next = streetUseCount(counts, fingerprint) + 1;
  counts.set(fingerprint, next);
  return next;
}

export function cloneStreetUseCounts(counts: Map<string, number>): Map<string, number> {
  return new Map(counts);
}

/** Streets already at the line-1 cap, plus non-pending batch streets that would hit the cap. */
export function buildReservedStreetLinesForMisspell(
  categoryStreets: string[],
  batchStreetsByIndex: Array<{ index: number; street: string }>,
  excludeBatchIndexes: Set<number>,
): string[] {
  const streets = [...categoryStreets];
  for (const { index, street } of batchStreetsByIndex) {
    if (excludeBatchIndexes.has(index)) continue;
    streets.push(street);
  }
  const counts = buildStreetUseCounts(streets.map((street) => ({ street })));
  return collectUniqueStreetLines(
    streets.filter((street) => !canAssignStreetLine(counts, streetLineFingerprint(street))),
  );
}

/** Uniqueness within a category is based on jigged street line 1 only — not unit line 2. */
export function addressJigFingerprint(address: Pick<ProfileAddress, "street">): string {
  return streetLineFingerprint(address.street);
}

export function buildStreetUseCounts(profiles: Array<Pick<ProfileAddress, "street">>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    const fingerprint = streetLineFingerprint(profile.street);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  return counts;
}

export function pickLeastUsedStreetFingerprint(counts: Map<string, number>): string | null {
  let lowestCount = Infinity;
  let picked: string | null = null;
  for (const [fingerprint, count] of counts) {
    if (count < lowestCount) {
      lowestCount = count;
      picked = fingerprint;
    }
  }
  return picked;
}

export function jigFingerprint(parts: {
  name: Pick<ProfileName, "full" | "jig">;
  address: Pick<ProfileAddress, "street">;
}): string {
  const displayName = (parts.name.jig ?? parts.name.full).trim().toLowerCase();
  const street = streetLineFingerprint(parts.address.street);
  return `${displayName}|${street}`;
}

export function mergeAddressRulesFromPresets(presets: JigPreset[]): AddressRule[] {
  const rules: AddressRule[] = [];
  for (const preset of presets) {
    for (const rule of preset.addressRules) {
      if (rule.type !== "splitLines") {
        rules.push(rule);
      }
    }
  }
  if (rules.length > 0) {
    rules.push({ type: "splitLines" });
  }
  return rules;
}

export interface LocalJigSlot {
  jigName: string;
  jigAddress: ProfileAddress;
  needsNameMisspell: boolean;
  needsStreetMisspell: boolean;
  nameMisspellScope: NameMisspellScope;
  addressRules: AddressRule[];
}

function resolveAddressRules(
  addressPresets: JigPreset[],
  addressRulesOverride?: AddressRule[],
): AddressRule[] {
  if (addressRulesOverride !== undefined) {
    return addressRulesOverride;
  }
  if (addressPresets.length > 0) {
    return mergeAddressRulesFromPresets(addressPresets);
  }
  return [];
}

function buildLocalJigSlot(
  name: ProfileName,
  addressBase: ProfileAddress,
  namePreset: JigPreset | null,
  addressPresets: JigPreset[],
  addressRulesOverride?: AddressRule[],
  nameMisspellScope: NameMisspellScope = "both",
): LocalJigSlot {
  const baseName = resolveProfileNameBase(name);
  const addressRules = resolveAddressRules(addressPresets, addressRulesOverride);
  const nameRules = namePreset?.nameRules ?? [];
  const nonMisspellNameRules = stripMisspellFromNameRules(nameRules);
  const nonMisspellAddressRules = stripMisspellFromAddressRules(addressRules);
  const needsNameMisspell = nameRules.some(isNameMisspellRule);
  const needsStreetMisspell = addressRules.some(isStreetMisspellRule);

  let jigName = baseName;
  if (namePreset) {
    if (nonMisspellNameRules.length > 0) {
      jigName = applyNameRulesForProfile(name, nonMisspellNameRules, nameMisspellScope);
    } else if (!needsNameMisspell) {
      jigName = baseName;
    }
  }

  const jigAddress =
    nonMisspellAddressRules.length > 0
      ? applyAddressRules({ ...addressBase }, nonMisspellAddressRules)
      : { ...addressBase, formatted: formatAddress(addressBase) };

  return {
    jigName,
    jigAddress,
    needsNameMisspell,
    needsStreetMisspell,
    nameMisspellScope,
    addressRules,
  };
}

export function applyLocalJigRulesToMaster(
  master: MasterProfile,
  namePreset: JigPreset | null,
  addressPresets: JigPreset[],
  addressRulesOverride?: AddressRule[],
  nameMisspellScope: NameMisspellScope = "both",
): LocalJigSlot {
  return buildLocalJigSlot(
    master.name,
    master.address,
    namePreset,
    addressPresets,
    addressRulesOverride,
    nameMisspellScope,
  );
}

/** Re-jig: keep the profile name. Line-2 jigs stay on the current address; line-1 jigs start from the master. */
export function applyLocalJigRulesToProfile(
  profile: Profile,
  master: MasterProfile,
  namePreset: JigPreset | null,
  addressPresets: JigPreset[],
  addressRulesOverride?: AddressRule[],
  nameMisspellScope: NameMisspellScope = "both",
): LocalJigSlot {
  const addressRules = resolveAddressRules(addressPresets, addressRulesOverride);
  const addressBase = addressRulesChangeStreetLine(addressRules) ? master.address : profile.address;
  return buildLocalJigSlot(
    profile.name,
    addressBase,
    namePreset,
    addressPresets,
    addressRulesOverride,
    nameMisspellScope,
  );
}

function stripNameFieldsFromMisspell(
  misspell: OpenAiMisspellResult | undefined,
  slot: LocalJigSlot,
): OpenAiMisspellResult | undefined {
  if (!misspell) return undefined;
  if (slot.needsNameMisspell) return misspell;
  if (misspell.street === undefined) return undefined;
  return { street: misspell.street };
}

function applyNameMisspell(
  name: ProfileName,
  jigName: string,
  misspell: OpenAiMisspellResult | undefined,
): { first: string; last: string; full: string; jig: string } {
  const parts = namePartsForMisspell(name);
  const first = misspell?.firstName?.trim() || parts.first;
  const last = misspell?.lastName?.trim() || parts.last;
  const full = `${first} ${last}`.trim() || jigName || name.full;
  return { first, last, full, jig: full };
}

export function finalizeJigFromLocalAndMisspell(
  master: MasterProfile,
  local: LocalJigSlot,
  misspell: OpenAiMisspellResult | undefined,
  namePreset: JigPreset | null,
): { name: MasterProfile["name"]; address: ProfileAddress } {
  let jigName = local.jigName;
  let jigAddress = local.jigAddress;

  if (misspell) {
    if (misspell.firstName !== undefined || misspell.lastName !== undefined) {
      const first = misspell.firstName ?? master.name.first.trim();
      const last = misspell.lastName ?? master.name.last.trim();
      jigName = `${first} ${last}`.trim();
    }
    if (misspell.street !== undefined) {
      jigAddress = {
        ...jigAddress,
        street: misspell.street,
        formatted: formatAddress({ ...jigAddress, street: misspell.street }),
      };
    }
  }

  const nameParts = namePreset ? applyNameMisspell(master.name, jigName, misspell) : null;

  return {
    name: {
      ...master.name,
      ...(nameParts ?? { full: resolveProfileNameBase(master.name) }),
      jig: namePreset ? (nameParts?.jig ?? jigName) : undefined,
    },
    address: {
      ...jigAddress,
      jig: local.addressRules.length > 0 ? jigAddress.formatted : undefined,
    },
  };
}

/** Re-jig merge: preserve profile name when no name jig; otherwise jig from the profile's name base. */
export function finalizeRejigFromLocalAndMisspell(
  profile: Profile,
  master: MasterProfile,
  local: LocalJigSlot,
  misspell: OpenAiMisspellResult | undefined,
  namePreset: JigPreset | null,
): { name: ProfileName; address: ProfileAddress } {
  const scopedMisspell = stripNameFieldsFromMisspell(misspell, local);
  const jiggedAddress = finalizeJigFromLocalAndMisspell(
    master,
    local,
    scopedMisspell,
    namePreset,
  ).address;

  if (!namePreset) {
    return {
      name: cloneProfileName(profile.name),
      address: jiggedAddress,
    };
  }

  let jigName = local.jigName;
  if (scopedMisspell) {
    if (scopedMisspell.firstName !== undefined || scopedMisspell.lastName !== undefined) {
      const first = scopedMisspell.firstName ?? profile.name.first.trim();
      const last = scopedMisspell.lastName ?? profile.name.last.trim();
      jigName = `${first} ${last}`.trim();
    }
  }

  const nameParts = applyNameMisspell(profile.name, jigName, scopedMisspell);

  return {
    name: {
      ...profile.name,
      ...nameParts,
    },
    address: jiggedAddress,
  };
}

export async function applyJigRulesToMasterAsync(
  master: MasterProfile,
  namePreset: JigPreset | null,
  addressPresets: JigPreset[],
  addressRulesOverride?: AddressRule[],
  nameMisspellScope: NameMisspellScope = "both",
  misspellVariationHint?: string,
): Promise<{ name: MasterProfile["name"]; address: ProfileAddress }> {
  const local = applyLocalJigRulesToMaster(
    master,
    namePreset,
    addressPresets,
    addressRulesOverride,
    nameMisspellScope,
  );

  if (local.needsNameMisspell || local.needsStreetMisspell) {
    let variationHint = misspellVariationHint;
    if (local.needsStreetMisspell) {
      const previewSeed = misspellVariationHint?.startsWith("preview-")
        ? Number.parseInt(misspellVariationHint.slice("preview-".length), 10)
        : 0;
      variationHint = buildStreetVariationHint(Number.isFinite(previewSeed) ? previewSeed : 0, local.jigAddress.street);
    }

    const parts = namePartsForMisspell(master.name);
    const request = buildMisspellRequest(
      local.needsNameMisspell ? parts.first : undefined,
      local.needsNameMisspell ? parts.last : undefined,
      local.needsStreetMisspell ? local.jigAddress.street : undefined,
      nameMisspellScope,
      variationHint,
    );

    if (request) {
      const misspelled = await misspellWithOpenAi(request);
      return finalizeJigFromLocalAndMisspell(master, local, misspelled, namePreset);
    }
  }

  return finalizeJigFromLocalAndMisspell(master, local, undefined, namePreset);
}

export async function applyJigRulesBatchToMasterAsync(
  master: MasterProfile,
  _namePreset: JigPreset | null,
  _addressPresets: JigPreset[],
  _addressRulesOverride: AddressRule[] | undefined,
  nameMisspellScope: NameMisspellScope,
  indexedSlots: Array<{ index: number; slot: LocalJigSlot; nameSource?: ProfileName }>,
  reservedStreets: string[],
): Promise<Map<number, OpenAiMisspellResult>> {
  const indexedRequests = indexedSlots
    .map(({ index, slot, nameSource }) => {
      if (!slot.needsNameMisspell && !slot.needsStreetMisspell) {
        return null;
      }
      const name = nameSource ?? master.name;
      const parts = namePartsForMisspell(name);
      const request = buildMisspellRequest(
        slot.needsNameMisspell ? parts.first : undefined,
        slot.needsNameMisspell ? parts.last : undefined,
        slot.needsStreetMisspell ? slot.jigAddress.street : undefined,
        nameMisspellScope,
        buildStreetVariationHint(index, slot.jigAddress.street),
      );
      if (!request) return null;
      return { index, request };
    })
    .filter((item): item is { index: number; request: NonNullable<ReturnType<typeof buildMisspellRequest>> } =>
      Boolean(item),
    );

  if (indexedRequests.length === 0) {
    return new Map();
  }

  return misspellBatchWithOpenAi(indexedRequests, { reservedStreets });
}

export async function applyJigPresetToProfile(
  profile: import("./types").Profile,
  preset: JigPreset,
): Promise<import("./types").Profile> {
  const jigName = applyNameRules(profile.name.full, stripMisspellFromNameRules(preset.nameRules));
  let jigAddress = applyAddressRules(profile.address, stripMisspellFromAddressRules(preset.addressRules));

  const needsNameMisspell = preset.nameRules.some(isNameMisspellRule);
  const needsStreetMisspell = preset.addressRules.some(isStreetMisspellRule);

  if (needsNameMisspell || needsStreetMisspell) {
    const parts = namePartsForMisspell(profile.name);
    const request = buildMisspellRequest(
      needsNameMisspell ? parts.first : undefined,
      needsNameMisspell ? parts.last : undefined,
      needsStreetMisspell ? jigAddress.street : undefined,
      "both",
      buildStreetVariationHint(0, jigAddress.street),
    );
    if (request) {
      const misspelled = await misspellWithOpenAi(request);
      if (misspelled.street !== undefined) {
        jigAddress = {
          ...jigAddress,
          street: misspelled.street,
          formatted: formatAddress({ ...jigAddress, street: misspelled.street }),
        };
      }
      return {
        ...profile,
        jigPresetId: preset.id,
        jigPresetName: preset.name,
        name: { ...profile.name, ...applyNameMisspell(profile.name, jigName, misspelled) },
        address: { ...jigAddress, jig: jigAddress.formatted },
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return {
    ...profile,
    jigPresetId: preset.id,
    jigPresetName: preset.name,
    name: {
      ...profile.name,
      ...(needsNameMisspell ? applyNameMisspell(profile.name, jigName, undefined) : { jig: jigName }),
    },
    address: { ...jigAddress, jig: jigAddress.formatted },
    updatedAt: new Date().toISOString(),
  };
}

export async function reapplyJigPreset(
  profile: import("./types").Profile,
  preset: JigPreset | null,
): Promise<import("./types").Profile> {
  if (!preset) {
    const { name, address, ...rest } = profile;
    return {
      ...rest,
      name: { first: name.first, last: name.last, full: name.full },
      address: {
        street: address.street,
        unit: address.unit,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      },
      updatedAt: new Date().toISOString(),
    };
  }
  return applyJigPresetToProfile(profile, preset);
}
export const applyJigPreset = applyJigPresetToProfile;
