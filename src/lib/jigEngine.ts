import type { AddressRule, JigPreset, MasterProfile, NameRule, ProfileAddress, ProfileName, NameMisspellScope } from "./types";
import { resolveProfileNameBase } from "./profileNameUtils";
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

const UNIT_LINE_TEMPLATES = [  "Apt {n}",
  "Apt. {n}",
  "Apartment {n}",
  "Ste {n}",
  "Suite {n}",
  "# {n}",
  "Unit {n}",
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
  return template.replace("{n}", randomInt(1, 999).toString());
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
      case "addUnit":
        next.unit = (rule.unitFormat ?? "Apt {random}").replace(
          "{random}",
          randomInt(1, 20).toString(),
        );
        break;
      case "addSuite":
        next.unit = (rule.unitFormat ?? "Suite {random}").replace(
          "{random}",
          randomInt(100, 999).toString(),
        );
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

/** Streets already used in the category plus non-pending streets from the current batch. */
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
  return collectUniqueStreetLines(streets);
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

export function applyLocalJigRulesToMaster(
  master: MasterProfile,
  namePreset: JigPreset | null,
  addressPresets: JigPreset[],
  addressRulesOverride?: AddressRule[],
  nameMisspellScope: NameMisspellScope = "both",
): LocalJigSlot {
  const baseName = resolveProfileNameBase(master.name);
  const addressRules = resolveAddressRules(addressPresets, addressRulesOverride);
  const nameRules = namePreset?.nameRules ?? [];
  const nonMisspellNameRules = stripMisspellFromNameRules(nameRules);
  const nonMisspellAddressRules = stripMisspellFromAddressRules(addressRules);
  const needsNameMisspell = nameRules.some(isNameMisspellRule);
  const needsStreetMisspell = addressRules.some(isStreetMisspellRule);

  let jigName = baseName;
  if (namePreset) {
    if (nonMisspellNameRules.length > 0) {
      jigName = applyNameRulesForProfile(master.name, nonMisspellNameRules, nameMisspellScope);
    } else if (!needsNameMisspell) {
      jigName = baseName;
    }
  }

  const jigAddress =
    nonMisspellAddressRules.length > 0
      ? applyAddressRules({ ...master.address }, nonMisspellAddressRules)
      : { ...master.address, formatted: formatAddress(master.address) };

  return {
    jigName,
    jigAddress,
    needsNameMisspell,
    needsStreetMisspell,
    nameMisspellScope,
    addressRules,
  };
}

export function finalizeJigFromLocalAndMisspell(
  master: MasterProfile,
  local: LocalJigSlot,
  misspell: OpenAiMisspellResult | undefined,
  namePreset: JigPreset | null,
): { name: MasterProfile["name"]; address: ProfileAddress } {
  const baseName = resolveProfileNameBase(master.name);
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

  return {
    name: {
      ...master.name,
      full: baseName,
      jig: namePreset ? jigName : undefined,
    },
    address: {
      ...jigAddress,
      jig: local.addressRules.length > 0 ? jigAddress.formatted : undefined,
    },
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

    const request = buildMisspellRequest(
      local.needsNameMisspell ? master.name.first.trim() : undefined,
      local.needsNameMisspell ? master.name.last.trim() : undefined,
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
  indexedSlots: Array<{ index: number; slot: LocalJigSlot }>,
  reservedStreets: string[],
): Promise<Map<number, OpenAiMisspellResult>> {
  const indexedRequests = indexedSlots
    .map(({ index, slot }) => {
      if (!slot.needsNameMisspell && !slot.needsStreetMisspell) {
        return null;
      }
      const request = buildMisspellRequest(
        slot.needsNameMisspell ? master.name.first.trim() : undefined,
        slot.needsNameMisspell ? master.name.last.trim() : undefined,
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
    const request = buildMisspellRequest(
      needsNameMisspell ? profile.name.first.trim() : undefined,
      needsNameMisspell ? profile.name.last.trim() : undefined,
      needsStreetMisspell ? jigAddress.street : undefined,
      "both",
      buildStreetVariationHint(0, jigAddress.street),
    );
    if (request) {
      const misspelled = await misspellWithOpenAi(request);
      const jiggedName =
        misspelled.firstName !== undefined || misspelled.lastName !== undefined
          ? `${misspelled.firstName ?? profile.name.first.trim()} ${misspelled.lastName ?? profile.name.last.trim()}`.trim()
          : jigName;
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
        name: { ...profile.name, jig: jiggedName },
        address: { ...jigAddress, jig: jigAddress.formatted },
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return {
    ...profile,
    jigPresetId: preset.id,
    jigPresetName: preset.name,
    name: { ...profile.name, jig: jigName },
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
