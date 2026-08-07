import type { AddressRule, NameRule, StreetAffixMode } from "./types";

export const NAME_RULE_LABELS: Record<NameRule["type"], string> = {
  truncate: "Truncate",
  appendSuffix: "Append suffix",
  removeSpaces: "Remove spaces",
  toUpperCase: "UPPERCASE",
  toTitleCase: "Title Case",
  addHyphen: "Hyphenate",
  misspell: "Misspell (typos + phonetic)",
  nameMisspell: "Name misspell",
  prefixRandom: "Random prefix letters",
  suffixRandom: "Random suffix letters",
  insertRandomLetters: "Insert random letters",
};

export const ADDRESS_RULE_LABELS: Record<AddressRule["type"], string> = {
  abbreviate: "Abbreviate street",
  addUnit: "Add unit (fixed format)",
  addSuite: "Add suite (fixed format)",
  randomUnitLine: "Random apt/suite line 2",
  poBox: "PO Box",
  truncateField: "Truncate field",
  splitLines: "Format lines",
  misspellField: "Misspell field",
  prefixRandom: "Random prefix on field",
  suffixRandom: "Random suffix on field",
  streetRandomLetters: "Street random letters",
};

export const AFFIX_MODE_LABELS: Record<StreetAffixMode, string> = {
  prefix: "Beginning only",
  suffix: "End only",
  both: "Beginning and end",
};

export const RECOMMENDED_NAME_JIG_IDS = ["builtin-name-misspell"] as const;

export const RECOMMENDED_ADDRESS_JIG_IDS = [
  "builtin-street-random-letters",
  "builtin-street-prefix-letters",
  "builtin-street-suffix-letters",
  "builtin-random-unit-line",
  "builtin-address-misspell",
] as const;
