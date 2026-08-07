import type { ExportTemplate, JigPreset } from "./types";

export const BUILTIN_JIG_PRESETS: JigPreset[] = [
  {
    id: "builtin-name-misspell",
    name: "Name misspell",
    description: "Typos, extra letters, and phonetic swaps (w/u, ph/f, etc.) on the full name.",
    nameRules: [{ type: "nameMisspell", charCount: 2 }],
    addressRules: [],
  },
  {
    id: "builtin-street-random-letters",
    name: "Street random letters",
    description: "Adds random letters at the start and end of the street (line 1).",
    nameRules: [],
    addressRules: [
      { type: "streetRandomLetters", charCount: 3, affixMode: "both" },
      { type: "splitLines" },
    ],
  },
  {
    id: "builtin-street-prefix-letters",
    name: "Street prefix letters",
    description: "Random letters at the beginning of the street address only.",
    nameRules: [],
    addressRules: [
      { type: "streetRandomLetters", charCount: 2, affixMode: "prefix" },
      { type: "splitLines" },
    ],
  },
  {
    id: "builtin-street-suffix-letters",
    name: "Street suffix letters",
    description: "Random letters at the end of the street address only.",
    nameRules: [],
    addressRules: [
      { type: "streetRandomLetters", charCount: 2, affixMode: "suffix" },
      { type: "splitLines" },
    ],
  },
  {
    id: "builtin-random-unit-line",
    name: "Random apt/suite line",
    description: "Line 2 uses Apt, Apartment, Ste, Suite, #, or Unit with a random number.",
    nameRules: [],
    addressRules: [{ type: "randomUnitLine" }, { type: "splitLines" }],
  },
  {
    id: "builtin-address-misspell",
    name: "Street misspell",
    description: "Misspells the street with typos, extra letters, and phonetic swaps.",
    nameRules: [],
    addressRules: [
      { type: "misspellField", field: "street", charCount: 2 },
      { type: "splitLines" },
    ],
  },
];

export const RETIRED_BUILTIN_JIG_IDS = [
  "builtin-uppercase",
  "builtin-maxlength",
  "builtin-apartment",
  "builtin-pobox",
  "builtin-name-noise",
  "builtin-address-suite",
  "builtin-address-apt-noise",
  "builtin-address-combo",
  "builtin-name-phonetic-heavy",
] as const;

export const BUILTIN_EXPORT_TEMPLATES: ExportTemplate[] = [
  {
    id: "builtin-postman",
    name: "Postman environment",
    description: "Minimal Postman-style environment JSON.",
    extension: ".json",
    mimeType: "application/json",
    isBuiltin: true,
    body: `{
  "name": "{{profile.name.full}}",
  "values": [
    { "key": "email", "value": "{{login.email}}", "enabled": true },
    { "key": "password", "value": "{{login.password}}", "enabled": true },
    { "key": "card_number", "value": "{{payment.number}}", "enabled": true },
    { "key": "card_exp", "value": "{{payment.expiry}}", "enabled": true },
    { "key": "card_cvv", "value": "{{payment.cvv}}", "enabled": true },
    { "key": "street", "value": "{{address.street}}", "enabled": true },
    { "key": "city", "value": "{{address.city}}", "enabled": true },
    { "key": "state", "value": "{{address.state}}", "enabled": true },
    { "key": "zip", "value": "{{address.postalCode}}", "enabled": true }
  ]
}`,
  },
  {
    id: "builtin-playwright-fixture",
    name: "Playwright fixture",
    description: "Single-profile object for test fixtures.",
    extension: ".json",
    mimeType: "application/json",
    isBuiltin: true,
    body: `{
  "email": "{{login.email}}",
  "password": "{{login.password}}",
  "billing": {
    "name": "{{profile.name.full}}",
    "address": "{{address.formatted}}",
    "card": "{{payment.number}}",
    "exp": "{{payment.expiry}}",
    "cvv": "{{payment.cvv}}"
  }
}`,
  },
];

const jigPresets = new Map(BUILTIN_JIG_PRESETS.map((preset) => [preset.id, preset]));

export function getJigPresetById(id: string): JigPreset | undefined {
  return jigPresets.get(id);
}

export function registerJigPreset(preset: JigPreset) {
  jigPresets.set(preset.id, preset);
}

export function listKnownJigPresets(): JigPreset[] {
  return Array.from(jigPresets.values());
}
