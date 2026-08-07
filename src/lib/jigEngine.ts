import type { AddressRule, JigPreset, MasterProfile, NameRule, ProfileAddress, ProfileName } from "./types";

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

const PHONETIC_REPLACEMENTS: { pattern: RegExp; replace: string }[] = [
  { pattern: /ph/gi, replace: "f" },
  { pattern: /ough/gi, replace: "uff" },
  { pattern: /tion/gi, replace: "shun" },
  { pattern: /([aeiou])r\b/gi, replace: "$1re" },
  { pattern: /\bw\b/gi, replace: "u" },
  { pattern: /\bu\b/gi, replace: "w" },
  { pattern: /([ck])\1/gi, replace: "$1" },
  { pattern: /([sz])\1/gi, replace: "$1" },
  { pattern: /ee/gi, replace: "ea" },
  { pattern: /ea/gi, replace: "ee" },
  { pattern: /ie/gi, replace: "ei" },
  { pattern: /ei/gi, replace: "ie" },
  { pattern: /ou/gi, replace: "ow" },
  { pattern: /ow/gi, replace: "ou" },
  { pattern: /c/gi, replace: "k" },
  { pattern: /k/gi, replace: "c" },
  { pattern: /s/gi, replace: "z" },
  { pattern: /z/gi, replace: "s" },
  { pattern: /i/gi, replace: "y" },
  { pattern: /y/gi, replace: "i" },
];

const UNIT_LINE_TEMPLATES = [
  "Apt {n}",
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

function preserveCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement.toLowerCase();
}

function applyPhoneticSwap(text: string): string {
  const replacement = PHONETIC_REPLACEMENTS[Math.floor(Math.random() * PHONETIC_REPLACEMENTS.length)];
  return text.replace(replacement.pattern, (match) => preserveCase(match, replacement.replace));
}

function misspellOnce(text: string): string {
  if (text.length < 2) return text;

  const vowelIndexes = text
    .split("")
    .map((char, index) => (/[aeiou]/i.test(char) ? index : -1))
    .filter((index) => index >= 0);

  const operations = [
    () => {
      if (!vowelIndexes.length) return text;
      const index = vowelIndexes[Math.floor(Math.random() * vowelIndexes.length)];
      return text.slice(0, index) + text.slice(index + 1);
    },
    () => {
      const index = Math.floor(Math.random() * (text.length - 1));
      return text.slice(0, index) + text[index + 1] + text[index] + text.slice(index + 2);
    },
    () => {
      const index = Math.floor(Math.random() * text.length);
      return text.slice(0, index) + text[index] + text.slice(index);
    },
    () => {
      const index = Math.floor(Math.random() * text.length);
      return text.slice(0, index) + randomLetters(1) + text.slice(index);
    },
    () => applyPhoneticSwap(text),
    () => text.replace(/er\b/gi, "re").replace(/re\b/gi, "er"),
  ];

  return operations[Math.floor(Math.random() * operations.length)]();
}

function misspell(text: string, intensity = 1): string {
  let value = text;
  const passes = Math.max(1, intensity);
  for (let index = 0; index < passes; index += 1) {
    value = misspellOnce(value);
  }
  return value;
}

function applyRandomAffix(value: string, rule: NameRule | AddressRule, position: "prefix" | "suffix"): string {
  const count = rule.charCount ?? randomInt(1, 3);
  const letters = randomLetters(count);
  return position === "prefix" ? `${letters}${value}` : `${value}${letters}`;
}

function applyStreetRandomLetters(street: string, rule: AddressRule): string {
  const count = rule.charCount ?? randomInt(1, 4);
  const mode = rule.affixMode ?? "both";
  let value = street;
  if (mode === "prefix" || mode === "both") {
    value = `${randomLetters(count)}${value}`;
  }
  if (mode === "suffix" || mode === "both") {
    value = `${value}${randomLetters(count)}`;
  }
  return value;
}

function applyRandomUnitLine(): string {
  const template = UNIT_LINE_TEMPLATES[Math.floor(Math.random() * UNIT_LINE_TEMPLATES.length)];
  return template.replace("{n}", randomInt(1, 999).toString());
}

function applyNameMisspell(value: string, rule: NameRule): string {
  return misspell(value, rule.charCount ?? 2);
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
        value = applyNameMisspell(value, rule);
        break;
      case "prefixRandom":
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
    case "misspellField":
      return misspell(value, rule.charCount ?? 2);
    case "prefixRandom":
      return applyRandomAffix(value, rule, "prefix");
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

export function jigFingerprint(parts: {
  name: Pick<ProfileName, "full" | "jig">;
  address: Pick<ProfileAddress, "street" | "unit">;
}): string {
  const displayName = (parts.name.jig ?? parts.name.full).trim().toLowerCase();
  const street = parts.address.street.trim().toLowerCase();
  const unit = (parts.address.unit ?? "").trim().toLowerCase();
  return `${displayName}|${street}|${unit}`;
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

export function applyJigRulesToMaster(
  master: MasterProfile,
  namePreset: JigPreset | null,
  addressPresets: JigPreset[],
): { name: MasterProfile["name"]; address: ProfileAddress } {
  const baseName = master.name.full || `${master.name.first} ${master.name.last}`.trim();
  const jigName = namePreset ? applyNameRules(baseName, namePreset.nameRules) : baseName;
  const jigAddress =
    addressPresets.length > 0
      ? applyAddressRules({ ...master.address }, mergeAddressRulesFromPresets(addressPresets))
      : { ...master.address, formatted: formatAddress(master.address) };

  return {
    name: {
      ...master.name,
      full: baseName,
      jig: namePreset ? jigName : undefined,
    },
    address: {
      ...jigAddress,
      jig: addressPresets.length > 0 ? jigAddress.formatted : undefined,
    },
  };
}

export function applyJigPresetToProfile(profile: import("./types").Profile, preset: JigPreset): import("./types").Profile {
  const jigName = applyNameRules(profile.name.full, preset.nameRules);
  const jigAddress = applyAddressRules(profile.address, preset.addressRules);
  return {
    ...profile,
    jigPresetId: preset.id,
    jigPresetName: preset.name,
    name: { ...profile.name, jig: jigName },
    address: { ...jigAddress, jig: jigAddress.formatted },
    updatedAt: new Date().toISOString(),
  };
}

export function reapplyJigPreset(profile: import("./types").Profile, preset: JigPreset | null): import("./types").Profile {
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
