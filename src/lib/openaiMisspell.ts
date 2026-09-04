import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./env";
import {
  isAllUppercaseLetterToken,
  isHouseNumberToken,
  isShortDirectionToken,
  isValidNameFatFingerTypo,
  keyboardFatFingerOncePreserveFirst,
  keyboardNameFatFingerOnce,
} from "./keyboardFatFinger";
import type { NameMisspellScope } from "./types";

export interface OpenAiMisspellRequest {
  firstName?: string;
  lastName?: string;
  street?: string;
  nameMisspellScope?: NameMisspellScope;
  variationHint?: string;
}

export interface OpenAiMisspellResult {
  firstName?: string;
  lastName?: string;
  street?: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const DEFAULT_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini";

export const OPENAI_MISSPELL_SYSTEM_PROMPT = `You apply light, realistic misspellings for shipping-profile jigs. Return JSON only.

CONTEXT:
- "street" is ALWAYS a US mailing address — street address line 1 only (house number + street name + suffix + direction).
- It is NOT a person's name, company name, or city. Focus on address tokens: house number, street name words, suffixes (St, Ave, Blvd, Cir, etc.), and directions (SE, NE, etc.).
- Names (firstName, lastName) are person names — use human typing typos only there.

GOAL: Subtle, believable typos that keep names and addresses recognizable and deliverable by UPS/USPS carriers.

CRITICAL:
- Every field you return MUST differ from the input. Never echo input unchanged.
- In a batch, every returned street MUST be a different string from every other street in that batch.

NAME RULES (when requested):
Exactly ONE fat-finger typo per requested name part (first and last are separate). Looks like a user mistyped.
Allowed styles only:
- Extra letter (including a double): Eduardo → Eduarddo / Eduarado, Camacho → Camachoo
- Adjacent-key replacement: Eduardo → Eduatdo (r→t), Camacho → Canacho (m→n)
Hard limits:
- The first letter of each name part MUST stay the same (Eduardo stays E…, Camacho stays C…).
- Never delete a letter (not Eduado / Camaco).
- Never transpose letters, never phonetic rewrites, never change more than one character.
- Letters only. Never add, remove, or change digits.

STREET ADDRESS RULES (when requested — street line 1 only):
The line looks like: [optional random block] [house number] [street name words] [suffix] [direction]
Example input: "Gvv 161 Aquarius Ave SE"

Allowed changes across the WHOLE line (variant swap is OPTIONAL — at most ONE suffix/direction swap PLUS at most ONE typo on one word):

IMPORTANT — VARIETY ACROSS PROFILES:
- Do NOT expand SE→Southeast or Ave→Avenue on every profile. That is wrong.
- Short forms (Ave, SE, St, Cir) are valid and preferred on many profiles — leave them unchanged and typo the street name instead (e.g. Aquarius → Aquariuss with Ave SE kept).
- Spread strategies across a batch: some keep Ave+SE; some use Southeast only; some use Avenue only; some use typo'd long forms (Southest, Souftheast, Southeeast, Avenuue); some expand both.
- Follow each profile's "street variation" hint when provided.

1) SUFFIX / TYPE VARIANT SWAPS (optional — at most one per line; skip entirely if the hint says keep short form):
   - St ↔ Street
   - Ave ↔ Avenue ↔ Av
   - Blvd ↔ Boulevard
   - Dr ↔ Drive
   - Ln ↔ Lane
   - Rd ↔ Road
   - Ct ↔ Court
   - Pl ↔ Place
   - Cir ↔ Circle
   - Pkwy ↔ Parkway
   - Hwy ↔ Highway
   - Ter ↔ Terrace
   - Trl ↔ Trail

2) DIRECTION VARIANT SWAPS (optional — at most one; skip if hint says keep SE/NE/etc.):
   - SE ↔ Southeast
   - NE ↔ Northeast
   - NW ↔ Northwest
   - SW ↔ Southwest
   - N ↔ North, S ↔ South, E ↔ East, W ↔ West
   Short forms (SE, NE, NW, SW, N, S, E, W) must stay exact OR swap to/from the long form only — never SE→SW and never misspell the short code (not SE→S,E or Se).

   When you expand a short direction to its long form, you MAY apply the one allowed typo ON that long direction word (counts as the single word typo for the line):
   - SE → Southeast (exact long form) OR SE → Southest, SE → Souftheast, SE → Southeeast (typo on expanded form)
   - NE → Northeast or Northest, Northeas
   - NW → Northwest or Nortwest, SW → Southwest or Soutwest
   Or keep SE unchanged and typo the street name instead — often the best choice.

3) TYPO STYLES on ONE word — street name, expanded suffix, or expanded direction (one typo max; variant swap is separate):
   - NEVER change the first letter of a street name word (Aquarius must still start with A). Carriers need that letter to recognize the street.
   - Extra letter: Aquarius → Aquariuss, Avenue → Avenuue, Southeast → Southeasst
   - Missed letter: Aquarius → Aquaris, Avenue → Avenu, Southeast → Southest
   - Double letter: Aquarius → Aquariuus, Street → Streeet, Northeast → Northeasst
   - Adjacent-key fat-finger: Aquarius → Aquariud, Maple → Mapke, Southeast → Southeasr

   When you expand a suffix (Ave → Avenue, St → Street, Cir → Circle), you MAY apply the one typo on that expanded suffix word:
   - Ave → Avenue (exact) OR Ave → Avenuue, Ave → Avenu (typo on expanded form)
   Or keep Ave unchanged and typo the street name instead — often the best choice.

HARD LIMITS (never break):
- NEVER change the house number (leading token like 161, 1234, 123A).
- NEVER change, add, or remove any digit anywhere on the line.
- NEVER modify all-uppercase random letter blocks at the start or end (e.g. Gvv, XYZ) — copy exactly.
- NEVER typo short direction codes in place (SE must stay SE or become Southeast/Southest — not Se, S.E, or SW).
- Long direction words (Southeast, etc.) and expanded suffixes (Avenue, Street, Circle) ARE valid targets for typos.
- NEVER change the first letter of any street name word (keep Aquarius→Aquariud ok, Aquarius→Muarius not ok).

OUTPUT:
Return JSON with only the keys you were asked to modify.

BATCH OUTPUT (multiple profiles):
Return: { "results": [ { "index": 0, "firstName": "...", "lastName": "...", "street": "..." }, ... ] }
Include every input index exactly once. All streets in results must be pairwise unique.`;

function buildMisspellUserPrompt(request: OpenAiMisspellRequest): string {
  const lines = ["Apply light misspellings to these fields:"];

  if (request.firstName !== undefined) {
    lines.push(`firstName (person name): ${JSON.stringify(request.firstName)}`);
  }
  if (request.lastName !== undefined) {
    lines.push(`lastName (person name): ${JSON.stringify(request.lastName)}`);
  }
  if (request.street !== undefined) {
    lines.push(
      `street (US mailing address line 1 — house number, street name, suffix like Ave/St/Cir, direction like SE/NE): ${JSON.stringify(request.street)}`,
    );
  }

  lines.push("Every returned value must differ from the input above.");
  if (request.firstName !== undefined || request.lastName !== undefined) {
    lines.push(
      "For names: exactly one fat-finger per requested part — extra letter or adjacent-key replacement. Keep the first letter. No deletions.",
    );
  }
  if (request.street !== undefined) {
    lines.push(
      "For street: follow the street variation hint. Short forms (Ave, SE) are valid — do not expand every profile to Avenue/Southeast. Mix: keep short forms + typo street name; exact long forms; typo'd long forms (Avenuue, Southest, Souftheast). Never change the first letter of a street name word.",
    );
  }

  if (request.variationHint) {
    lines.push(`Variation hint: ${request.variationHint}`);
  }

  lines.push(
    'Respond with JSON like {"firstName":"...","lastName":"...","street":"..."} including only the keys listed above.',
  );
  lines.push("Single profile only — do not use batch {\"results\":[...]} format.");

  return lines.join("\n");
}

function splitStreetTokens(street: string): string[] {
  return street.split(/(\s+)/).filter((part) => !/\s/.test(part));
}

/** All-caps tokens that may expand (St→Street, SE→Southeast) — not random letter jig blocks. */
const STREET_TYPE_TOKENS = new Set([
  "ST",
  "STREET",
  "AVE",
  "AV",
  "AVENUE",
  "BLVD",
  "BOULEVARD",
  "DR",
  "DRIVE",
  "LN",
  "LANE",
  "RD",
  "ROAD",
  "CT",
  "COURT",
  "PL",
  "PLACE",
  "WAY",
  "TRL",
  "TRAIL",
  "CIR",
  "CIRCLE",
  "PKWY",
  "PARKWAY",
  "HWY",
  "HIGHWAY",
  "LP",
  "LOOP",
  "TER",
  "TERRACE",
]);

const DIRECTION_LONG_FORMS: Record<string, string[][]> = {
  NE: [["NORTHEAST"], ["NORTH", "EAST"]],
  NW: [["NORTHWEST"], ["NORTH", "WEST"]],
  SE: [["SOUTHEAST"], ["SOUTH", "EAST"]],
  SW: [["SOUTHWEST"], ["SOUTH", "WEST"]],
  N: [["NORTH"]],
  S: [["SOUTH"]],
  E: [["EAST"]],
  W: [["WEST"]],
};

/** Random uppercase letter blocks from streetRandomLetters sit at the first or last token. */
function isPreservedRandomLetterBlock(token: string, tokenIndex: number, tokens: string[]): boolean {
  if (!isAllUppercaseLetterToken(token)) return false;
  if (isShortDirectionToken(token)) return false;
  if (STREET_TYPE_TOKENS.has(token.toUpperCase())) return false;
  return tokenIndex === 0 || tokenIndex === tokens.length - 1;
}

function hasDirectionLongForm(resultTokens: string[], shortDirection: string): boolean {
  const forms = DIRECTION_LONG_FORMS[shortDirection.toUpperCase()] ?? [];
  for (const form of forms) {
    if (form.length === 1) {
      if (resultTokens.some((part) => part.toUpperCase() === form[0])) {
        return true;
      }
      continue;
    }
    for (let index = 0; index <= resultTokens.length - form.length; index += 1) {
      if (form.every((word, offset) => resultTokens[index + offset]?.toUpperCase() === word)) {
        return true;
      }
    }
  }
  return false;
}

const DIRECTION_LONG_CANONICAL: Record<string, string> = {
  SE: "SOUTHEAST",
  NE: "NORTHEAST",
  NW: "NORTHWEST",
  SW: "SOUTHWEST",
  N: "NORTH",
  S: "SOUTH",
  E: "EAST",
  W: "WEST",
};

const SUFFIX_LONG_LABEL: Record<string, string> = {
  ST: "Street",
  STREET: "Street",
  AVE: "Avenue",
  AV: "Avenue",
  AVENUE: "Avenue",
  BLVD: "Boulevard",
  BOULEVARD: "Boulevard",
  DR: "Drive",
  DRIVE: "Drive",
  LN: "Lane",
  LANE: "Lane",
  RD: "Road",
  ROAD: "Road",
  CT: "Court",
  COURT: "Court",
  PL: "Place",
  PLACE: "Place",
  CIR: "Circle",
  CIRCLE: "Circle",
  PKWY: "Parkway",
  PARKWAY: "Parkway",
  HWY: "Highway",
  HIGHWAY: "Highway",
  LP: "Loop",
  LOOP: "Loop",
  TER: "Terrace",
  TERRACE: "Terrace",
  TRL: "Trail",
  TRAIL: "Trail",
  WAY: "Way",
};

function isStreetSuffixToken(token: string): boolean {
  return STREET_TYPE_TOKENS.has(token.toUpperCase());
}

function findStreetSuffixToken(tokens: string[]): string | null {
  for (const token of tokens) {
    if (isStreetSuffixToken(token)) {
      return token;
    }
  }
  return null;
}

function findShortDirectionToken(tokens: string[]): string | null {
  for (const token of tokens) {
    if (isShortDirectionToken(token)) {
      return token;
    }
  }
  return null;
}

function suffixLongLabel(token: string): string {
  return SUFFIX_LONG_LABEL[token.toUpperCase()] ?? token;
}

function directionLongLabel(token: string): string {
  const canonical = DIRECTION_LONG_CANONICAL[token.toUpperCase()];
  if (!canonical) return token;
  return canonical.charAt(0) + canonical.slice(1).toLowerCase();
}

/** Per-profile hint so batch results mix short forms, long forms, and typo'd long forms. */
export function buildStreetVariationHint(profileIndex: number, street: string): string {
  const tokens = splitStreetTokens(street);
  const suffix = findStreetSuffixToken(tokens);
  const direction = findShortDirectionToken(tokens);

  if (!suffix && !direction) {
    return "Typo one street name word only. Do not change suffix or direction tokens.";
  }

  if (suffix && !direction) {
    const long = suffixLongLabel(suffix);
    const strategies = [
      `Keep "${suffix}" exactly. Typo one street name word only — do not expand to ${long}.`,
      `Expand "${suffix}" → ${long} (correct spelling). No typo on ${long}.`,
      `Expand "${suffix}" → ${long} with one typo on ${long} (e.g. extra/missed/double letter).`,
      `Keep "${suffix}" exactly. Typo one street name word only.`,
    ];
    return strategies[profileIndex % strategies.length];
  }

  if (direction && !suffix) {
    const long = directionLongLabel(direction);
    const strategies = [
      `Keep "${direction}" exactly. Typo one street name word only — do not expand to ${long}.`,
      `Expand "${direction}" → ${long} (correct spelling). No typo on ${long}.`,
      `Expand "${direction}" → ${long} with one typo on ${long} (e.g. Southest, Souftheast, Southeeast).`,
      `Keep "${direction}" exactly. Typo one street name word only.`,
    ];
    return strategies[profileIndex % strategies.length];
  }

  const suffixLong = suffixLongLabel(suffix!);
  const directionLong = directionLongLabel(direction!);
  const strategies = [
    `Keep "${suffix}" and "${direction}" exactly as written. Do NOT expand to ${suffixLong} or ${directionLong}. Typo one street name word only.`,
    `Keep "${suffix}" exactly. Expand "${direction}" → ${directionLong} (correct spelling, no typo on direction).`,
    `Keep "${suffix}" exactly. Expand "${direction}" → ${directionLong} with one typo on ${directionLong} (e.g. Southest, Souftheast, Southeeast).`,
    `Expand "${suffix}" → ${suffixLong} (correct spelling). Keep "${direction}" exactly — do not expand to ${directionLong}.`,
    `Expand "${suffix}" → ${suffixLong} with one typo on ${suffixLong} (e.g. Avenuue, Avenu). Keep "${direction}" exactly.`,
    `Expand "${suffix}" → ${suffixLong} and "${direction}" → ${directionLong} (both correct long forms).`,
    `Expand "${suffix}" → ${suffixLong} and "${direction}" → ${directionLong}, with one typo on ${directionLong} only.`,
    `Expand "${suffix}" → ${suffixLong} with typo on ${suffixLong}; keep "${direction}" exactly.`,
    `Keep "${suffix}" and "${direction}" exactly. Typo one street name word only (use a different name typo than other profiles).`,
  ];

  return strategies[profileIndex % strategies.length];
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

/** Allow light typos on expanded direction words (SE → Southest, Souftheast; not SE → SW). */
function isTypoedDirectionLongForm(token: string, shortDirection: string): boolean {
  const canonical = DIRECTION_LONG_CANONICAL[shortDirection.toUpperCase()];
  if (!canonical) return false;

  const upper = token.toUpperCase();
  if (upper === canonical) return true;
  if (!/^[A-Z]+$/.test(upper)) return false;
  if (Math.abs(upper.length - canonical.length) > 2) return false;

  return levenshteinDistance(upper, canonical) <= 3;
}

function directionChangeAllowed(
  shortToken: string,
  resultTokens: string[],
): boolean {
  const normalized = shortToken.toUpperCase();
  const stillShort = resultTokens.some((part) => part.toUpperCase() === normalized);
  if (stillShort) return true;
  if (hasDirectionLongForm(resultTokens, normalized)) return true;
  return resultTokens.some((part) => isTypoedDirectionLongForm(part, normalized));
}

function localNameMisspellFallback(original: string): string {
  const base = original.trim();
  if (!base) return original;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = keyboardNameFatFingerOnce(base).trim();
    if (isValidNameFatFingerTypo(base, candidate)) {
      return candidate;
    }
  }

  const last = base[base.length - 1] ?? "e";
  return `${base}${last}`;
}

function streetResultFingerprint(street: string): string {
  return street.trim().toLowerCase();
}

function isProtectedStreetTypoToken(token: string, tokenIndex: number, tokens: string[]): boolean {
  return (
    isHouseNumberToken(token) ||
    isShortDirectionToken(token) ||
    isStreetSuffixToken(token) ||
    isPreservedRandomLetterBlock(token, tokenIndex, tokens) ||
    /\d/.test(token)
  );
}

function pickEditableWordSpan(
  street: string,
): { start: number; end: number; word: string } | null {
  const tokens = splitStreetTokens(street);
  let searchFrom = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const start = street.indexOf(token, searchFrom);
    if (start < 0) continue;
    searchFrom = start + token.length;

    if (isProtectedStreetTypoToken(token, index, tokens)) continue;
    if (!/[a-z]/i.test(token) || token.length < 2) continue;

    return { start, end: start + token.length, word: token };
  }

  return null;
}

function localStreetUniqueFallback(original: string, current: string, blocked: Set<string>): string {
  let value = current.trim();

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const span = pickEditableWordSpan(value);
    if (span) {
      const rotated =
        pickEditableWordSpan(value.slice(span.end) + " " + value.slice(0, span.start)) ?? span;
      const target = attempt % 3 === 0 ? span : rotated;
      const typo = keyboardFatFingerOncePreserveFirst(target.word);
      if (typo !== target.word) {
        value = value.slice(0, target.start) + typo + value.slice(target.end);
      }
    }

    try {
      assertStreetMisspellRules(original, value);
      if (!blocked.has(streetResultFingerprint(value))) {
        return value.trim();
      }
    } catch {
      // try another edit
    }
  }

  const span = pickEditableWordSpan(original);
  if (span) {
    const suffix = span.word.slice(-1);
    const bumped = `${span.word}${suffix}`;
    value = original.slice(0, span.start) + bumped + original.slice(span.end);
    try {
      assertStreetMisspellRules(original, value);
      if (!blocked.has(streetResultFingerprint(value))) {
        return value.trim();
      }
    } catch {
      // fall through
    }
  }

  throw new Error("Could not derive a unique street misspell locally.");
}

function ensureUniqueBatchStreets(
  output: Map<number, OpenAiMisspellResult>,
  items: IndexedMisspellRequest[],
  options: BatchMisspellOptions,
): void {
  const seenStreets = new Set<string>();
  const reserved = new Set(
    options.reservedStreets?.map((street) => street.trim().toLowerCase()) ?? [],
  );

  for (const item of [...items].sort((a, b) => a.index - b.index)) {
    const entry = output.get(item.index);
    if (!entry?.street || item.request.street === undefined) continue;

    const originalStreet = item.request.street;
    let street = entry.street;
    let fingerprint = streetResultFingerprint(street);
    const blocked = () => new Set([...seenStreets, ...reserved]);

    if (blocked().has(fingerprint)) {
      street = localStreetUniqueFallback(originalStreet, street, blocked());
      fingerprint = streetResultFingerprint(street);
      output.set(item.index, { ...entry, street });
    }

    seenStreets.add(fingerprint);
  }
}

function validateNamePart(original: string, result: string, label: string): string {
  let trimmed = result.trim();
  if (!trimmed) {
    throw new Error(`OpenAI returned an empty ${label}.`);
  }
  if (!isValidNameFatFingerTypo(original, trimmed)) {
    trimmed = localNameMisspellFallback(original);
  }
  if (/\d/.test(trimmed) && !/\d/.test(original)) {
    throw new Error(`OpenAI ${label} misspell must not introduce digits.`);
  }
  if (/\d/.test(original)) {
    const originalDigits = original.replace(/\D/g, "");
    const resultDigits = trimmed.replace(/\D/g, "");
    if (originalDigits !== resultDigits) {
      throw new Error(`OpenAI ${label} misspell must not change digits.`);
    }
  }
  return trimmed;
}

function getStreetNameWords(street: string): string[] {
  const tokens = splitStreetTokens(street);
  return tokens.filter((token, index) => {
    if (isProtectedStreetTypoToken(token, index, tokens)) return false;
    return /[a-z]/i.test(token);
  });
}

function assertStreetNameFirstLettersPreserved(original: string, result: string): void {
  const originalWords = getStreetNameWords(original);
  const resultWords = getStreetNameWords(result);
  if (originalWords.length === 0) return;

  const pairs = Math.min(originalWords.length, resultWords.length);
  for (let index = 0; index < pairs; index += 1) {
    const originalFirst = originalWords[index][0]?.toLowerCase();
    const resultFirst = resultWords[index][0]?.toLowerCase();
    if (originalFirst && resultFirst && originalFirst !== resultFirst) {
      throw new Error(
        `OpenAI street misspell must not change the first letter of street name word "${originalWords[index]}".`,
      );
    }
  }
}

function applyOneLocalStreetTypo(street: string): string {
  const span = pickEditableWordSpan(street);
  if (!span) {
    return localNameMisspellFallback(street);
  }

  const typo = keyboardFatFingerOncePreserveFirst(span.word);
  if (typo !== span.word) {
    return street.slice(0, span.start) + typo + street.slice(span.end);
  }

  if (span.word.length >= 2) {
    const index = Math.max(1, span.word.length - 1);
    const bumped = span.word.slice(0, index) + span.word[index] + span.word.slice(index);
    return street.slice(0, span.start) + bumped + street.slice(span.end);
  }

  return street;
}

function assertStreetMisspellRules(original: string, trimmed: string): void {
  const originalTokens = splitStreetTokens(original);
  const resultTokens = splitStreetTokens(trimmed);

  const originalHouse = originalTokens.find(isHouseNumberToken);
  const resultHouse = resultTokens.find(isHouseNumberToken);
  if (originalHouse && originalHouse !== resultHouse) {
    throw new Error("OpenAI street misspell must not change the house number.");
  }

  for (let index = 0; index < originalTokens.length; index += 1) {
    const token = originalTokens[index];
    if (!isPreservedRandomLetterBlock(token, index, originalTokens)) continue;
    if (!trimmed.includes(token)) {
      throw new Error(`OpenAI street misspell must preserve random letter block "${token}".`);
    }
  }

  if (/\d/.test(original)) {
    const originalDigits = original.replace(/\D/g, "");
    const resultDigits = trimmed.replace(/\D/g, "");
    if (originalDigits !== resultDigits) {
      throw new Error("OpenAI street misspell must not change digits.");
    }
  }

  for (const token of originalTokens) {
    if (!isShortDirectionToken(token)) continue;
    if (!directionChangeAllowed(token, resultTokens)) {
      throw new Error(`OpenAI street misspell must not alter direction "${token}" beyond its long form.`);
    }
  }

  assertStreetNameFirstLettersPreserved(original, trimmed);
}

function validateStreetMisspell(original: string, result: string): string {
  let trimmed = result.trim();
  if (!trimmed) {
    throw new Error("OpenAI returned an empty street misspell.");
  }
  if (trimmed === original.trim()) {
    trimmed = applyOneLocalStreetTypo(original).trim();
  }
  assertStreetMisspellRules(original, trimmed);
  return trimmed;
}

function normalizeSingleMisspellPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  if (
    typeof parsed.street === "string" ||
    typeof parsed.firstName === "string" ||
    typeof parsed.lastName === "string"
  ) {
    return parsed;
  }

  const results = parsed.results;
  if (Array.isArray(results) && results[0] && typeof results[0] === "object") {
    return results[0] as Record<string, unknown>;
  }

  return parsed;
}

function parseMisspellResponse(raw: string, request: OpenAiMisspellRequest): OpenAiMisspellResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = normalizeSingleMisspellPayload(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    throw new Error("OpenAI misspell response was not valid JSON.");
  }

  const result: OpenAiMisspellResult = {};

  if (request.firstName !== undefined) {
    if (typeof parsed.firstName !== "string") {
      throw new Error("OpenAI misspell response missing firstName.");
    }
    result.firstName = validateNamePart(request.firstName, parsed.firstName, "firstName");
  }

  if (request.lastName !== undefined) {
    if (typeof parsed.lastName !== "string") {
      throw new Error("OpenAI misspell response missing lastName.");
    }
    result.lastName = validateNamePart(request.lastName, parsed.lastName, "lastName");
  }

  if (request.street !== undefined) {
    if (typeof parsed.street !== "string") {
      throw new Error("OpenAI misspell response missing street.");
    }
    result.street = validateStreetMisspell(request.street, parsed.street);
  }

  return result;
}

let storedOpenAiApiKey = "";

export function cacheOpenAiApiKey(apiKey: string) {
  storedOpenAiApiKey = apiKey.trim();
}

async function resolveStoredOpenAiApiKey(): Promise<string> {
  if (storedOpenAiApiKey) return storedOpenAiApiKey;
  try {
    const settings = await import("./browserStorage").then((mod) => mod.getOpenAiSettings());
    storedOpenAiApiKey = settings.apiKey.trim();
  } catch {
    // Fall back to the environment key in Tauri or the Vite proxy.
  }
  return storedOpenAiApiKey;
}

async function callOpenAiChat(messages: ChatMessage[]): Promise<string> {
  const apiKey = await resolveStoredOpenAiApiKey();
  if (isTauriRuntime()) {
    return invoke<string>("openai_chat_completion", {
      messages,
      model: DEFAULT_MODEL,
      apiKey: apiKey || undefined,
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch("/openai/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.9,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail || response.statusText}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty misspell response.");
  }
  return content;
}

export function buildMisspellRequest(
  firstName: string | undefined,
  lastName: string | undefined,
  street: string | undefined,
  nameMisspellScope: NameMisspellScope = "both",
  variationHint?: string,
): OpenAiMisspellRequest | null {
  const request: OpenAiMisspellRequest = { nameMisspellScope, variationHint };

  if (firstName !== undefined && (nameMisspellScope === "both" || nameMisspellScope === "first")) {
    request.firstName = firstName;
  }
  if (lastName !== undefined && (nameMisspellScope === "both" || nameMisspellScope === "last")) {
    request.lastName = lastName;
  }
  if (street !== undefined) {
    request.street = street;
  }

  if (request.firstName === undefined && request.lastName === undefined && request.street === undefined) {
    return null;
  }

  return request;
}

const MAX_MISSPELL_VALIDATION_RETRIES = 3;

function isMisspellValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /OpenAI (street misspell|returned an empty|misspell response|firstName|lastName|must differ|missing firstName|missing lastName|first letter)/.test(
    error.message,
  );
}

export async function misspellWithOpenAi(request: OpenAiMisspellRequest): Promise<OpenAiMisspellResult> {
  const hasKeyHint = "Set an OpenAI API key in Settings.";

  const baseUserPrompt = buildMisspellUserPrompt(request);
  const messages: ChatMessage[] = [
    { role: "system", content: OPENAI_MISSPELL_SYSTEM_PROMPT },
    { role: "user", content: baseUserPrompt },
  ];

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_MISSPELL_VALIDATION_RETRIES; attempt += 1) {
    if (attempt > 0) {
      messages[1] = {
        role: "user",
        content: `${baseUserPrompt}\n\nPrevious attempt was rejected: ${lastError?.message ?? "invalid misspell"}. Return different typos than before.`,
      };
    }

    try {
      const content = await callOpenAiChat(messages);
      return parseMisspellResponse(content, request);
    } catch (error) {
      if (error instanceof Error && /OPENAI_API_KEY|401|403/.test(error.message)) {
        throw new Error(`${error.message} ${hasKeyHint}`);
      }
      if (isMisspellValidationError(error) && attempt < MAX_MISSPELL_VALIDATION_RETRIES) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("OpenAI misspell failed after retries.");
}

export function isOpenAiMisspellConfigured(): boolean {
  if (storedOpenAiApiKey) return true;
  if (isTauriRuntime()) return true;
  return Boolean(import.meta.env.VITE_OPENAI_API_KEY);
}

export async function testOpenAiConnection(apiKey: string): Promise<string> {
  const trimmed = apiKey.trim();
  if (isTauriRuntime()) {
    return invoke<string>("test_openai_connection", { apiKey: trimmed || undefined });
  }
  const headers: Record<string, string> = {};
  if (trimmed) headers.Authorization = `Bearer ${trimmed}`;
  const response = await fetch("/openai/v1/models", { headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI test failed (${response.status}): ${detail || response.statusText}`);
  }
  return "OpenAI connection works.";
}

export interface IndexedMisspellRequest {
  index: number;
  request: OpenAiMisspellRequest;
}

export interface BatchMisspellOptions {
  reservedStreets?: string[];
}

function buildBatchMisspellUserPrompt(
  items: IndexedMisspellRequest[],
  options: BatchMisspellOptions = {},
): string {
  const lines = [
    `Apply light misspellings to ${items.length} shipping profile(s).`,
    "street = US mailing address line 1 (not a name). Use suffix/direction variants and light typos on address words only.",
  ];

  for (const item of items) {
    lines.push(`Profile ${item.index}:`);
    if (item.request.firstName !== undefined) {
      lines.push(`  firstName (person name): ${JSON.stringify(item.request.firstName)}`);
    }
    if (item.request.lastName !== undefined) {
      lines.push(`  lastName (person name): ${JSON.stringify(item.request.lastName)}`);
    }
    if (item.request.street !== undefined) {
      lines.push(
        `  street (address line 1): ${JSON.stringify(item.request.street)}`,
      );
      lines.push(`  street variation: ${buildStreetVariationHint(item.index, item.request.street)}`);
    }
  }

  lines.push("Every returned value must differ from its input.");
  lines.push(
    "Names: exactly one fat-finger per requested part (extra letter or adjacent-key replacement). Keep the first letter. No deletions. Vary typos across profiles.",
  );
  lines.push(
    "Streets: follow each profile's street variation hint. Do NOT expand Ave→Avenue or SE→Southeast on every profile. Mix short forms (Ave SE), exact long forms (Avenue, Southeast), and typo'd long forms (Avenuue, Southest, Souftheast). Never change the first letter of a street name word. Every street in results must be unique.",
  );

  if (options.reservedStreets?.length) {
    lines.push(
      `These address line 1 values are already used in this category — do not return any of them exactly:\n${options.reservedStreets.map((street) => `- ${JSON.stringify(street)}`).join("\n")}`,
    );
  }

  lines.push(
    'Respond with JSON: {"results":[{"index":0,"firstName":"...","lastName":"...","street":"..."}]} — one result per profile index, only requested keys.',
  );

  return lines.join("\n");
}

function parseBatchMisspellResponse(
  raw: string,
  items: IndexedMisspellRequest[],
  options: BatchMisspellOptions = {},
): Map<number, OpenAiMisspellResult> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI batch misspell response was not valid JSON.");
  }

  const rows = parsed.results;
  if (!Array.isArray(rows)) {
    throw new Error("OpenAI batch misspell response missing results array.");
  }

  const byIndex = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (typeof record.index !== "number") continue;
    byIndex.set(record.index, record);
  }

  const output = new Map<number, OpenAiMisspellResult>();
  for (const item of items) {
    const row = byIndex.get(item.index);
    if (!row) {
      throw new Error(`OpenAI batch misspell response missing index ${item.index}.`);
    }
    output.set(
      item.index,
      parseMisspellResponse(JSON.stringify(row), item.request),
    );
  }

  ensureUniqueBatchStreets(output, items, options);

  return output;
}

const MAX_BATCH_MISSPELL_RETRIES = 2;

export async function misspellBatchWithOpenAi(
  items: IndexedMisspellRequest[],
  options: BatchMisspellOptions = {},
): Promise<Map<number, OpenAiMisspellResult>> {
  if (items.length === 0) {
    return new Map();
  }

  if (items.length === 1) {
    const only = items[0];
    const result = await misspellWithOpenAi(only.request);
    return new Map([[only.index, result]]);
  }

  const hasKeyHint = "Set an OpenAI API key in Settings.";

  const baseUserPrompt = buildBatchMisspellUserPrompt(items, options);
  const messages: ChatMessage[] = [
    { role: "system", content: OPENAI_MISSPELL_SYSTEM_PROMPT },
    { role: "user", content: baseUserPrompt },
  ];

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_BATCH_MISSPELL_RETRIES; attempt += 1) {
    if (attempt > 0) {
      messages[1] = {
        role: "user",
        content: `${baseUserPrompt}\n\nPrevious attempt was rejected: ${lastError?.message ?? "invalid batch misspell"}. Fix every issue and return different streets than before.`,
      };
    }

    try {
      const content = await callOpenAiChat(messages);
      return parseBatchMisspellResponse(content, items, options);
    } catch (error) {
      if (error instanceof Error && /OPENAI_API_KEY|401|403/.test(error.message)) {
        throw new Error(`${error.message} ${hasKeyHint}`);
      }
      if (isMisspellValidationError(error) && attempt < MAX_BATCH_MISSPELL_RETRIES) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("OpenAI batch misspell failed after retries.");
}
