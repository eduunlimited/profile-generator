import type { AddressRule, NameMisspellScope, NameRule, StreetAffixMode } from "./types";

export const NAME_RULE_LABELS: Record<NameRule["type"], string> = {
  truncate: "Truncate",
  appendSuffix: "Append suffix",
  removeSpaces: "Remove spaces",
  toUpperCase: "UPPERCASE",
  toTitleCase: "Title Case",
  addHyphen: "Hyphenate",
  misspell: "Misspell (OpenAI)",
  nameMisspell: "Name misspell (OpenAI)",
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
  streetTypeCombo: "Street type combo (PKC/Target)",
  houseNumberLetter: "House number letter",
};

export const AFFIX_MODE_LABELS: Record<StreetAffixMode, string> = {
  prefix: "Beginning only",
  suffix: "End only",
  both: "Beginning and end",
};

export const NAME_MISSPELL_SCOPE_LABELS: Record<NameMisspellScope, string> = {
  both: "First and last name",
  first: "First name only",
  last: "Last name only",
};

export const NAME_MISSPELL_SCOPE_OPTIONS: NameMisspellScope[] = ["both", "first", "last"];

export const RECOMMENDED_NAME_JIG_IDS = ["builtin-name-misspell"] as const;

export const RECOMMENDED_ADDRESS_JIG_IDS = [
  "builtin-street-random-letters",
  "builtin-street-prefix-letters",
  "builtin-street-suffix-letters",
  "builtin-house-number-letter",
  "builtin-street-type-combo",
  "builtin-random-unit-line",
  "builtin-address-misspell",
] as const;
