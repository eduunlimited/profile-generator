const KEYBOARD_NEIGHBORS: Record<string, string> = {
  "1": "2q",
  "2": "13qw",
  "3": "24we",
  "4": "35er",
  "5": "46rt",
  "6": "57ty",
  "7": "68yu",
  "8": "79ui",
  "9": "80io",
  "0": "9op-",
  q: "12wa",
  w: "23qase",
  e: "34wsdr",
  r: "45edft",
  t: "56rfgy",
  y: "67tgihu",
  u: "78yhji",
  i: "89ujko",
  o: "90iklp",
  p: "0ol",
  a: "qwsz",
  s: "wedxza",
  d: "erfcsx",
  f: "rtgvcd",
  g: "tyhbvf",
  h: "yujnbg",
  j: "uikmnh",
  k: "iolmj",
  l: "opk",
  z: "asx",
  x: "zsdc",
  c: "xdfv",
  v: "cfgb",
  b: "vghn",
  n: "bhjm",
  m: "njk",
};

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function preserveCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement.toLowerCase();
}

export function isKeyboardLetterNeighbor(a: string, b: string): boolean {
  if (a.length !== 1 || b.length !== 1) return false;
  const neighbors = KEYBOARD_NEIGHBORS[a.toLowerCase()];
  return Boolean(neighbors?.includes(b.toLowerCase()));
}

function keyboardLetterNeighbor(char: string): string | null {
  const neighbors = KEYBOARD_NEIGHBORS[char.toLowerCase()];
  if (!neighbors) return null;
  const letters = neighbors.split("").filter((candidate) => /[a-z]/i.test(candidate));
  if (letters.length === 0) return null;
  return pickRandom(letters);
}

/** True when result is exactly one fat-finger on a name part: extra letter or adjacent-key swap, first letter unchanged. */
export function isValidNameFatFingerTypo(original: string, result: string): boolean {
  const source = original.trim();
  const typed = result.trim();
  if (!source || !typed || source === typed) return false;
  if (source[0]?.toLowerCase() !== typed[0]?.toLowerCase()) return false;
  if (/\d/.test(typed) && !/\d/.test(source)) return false;

  if (typed.length === source.length) {
    let diffIndex = -1;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === typed[index]) continue;
      if (diffIndex !== -1 || index === 0) return false;
      diffIndex = index;
    }
    if (diffIndex < 1) return false;
    return isKeyboardLetterNeighbor(source[diffIndex], typed[diffIndex]);
  }

  if (typed.length !== source.length + 1) return false;
  for (let index = 1; index < typed.length; index += 1) {
    if (typed.slice(0, index) + typed.slice(index + 1) === source) {
      return /[a-z]/i.test(typed[index]);
    }
  }
  return false;
}

/** One name typo: extra letter or adjacent-key replacement. Never changes the first letter, never deletes. */
export function keyboardNameFatFingerOnce(text: string): string {
  const base = text.trim();
  if (!base) return text;

  const editableIndexes = base
    .split("")
    .map((char, index) => (/[a-z]/i.test(char) && index > 0 ? index : -1))
    .filter((index) => index >= 0);

  if (editableIndexes.length === 0) {
    const seed = base[0];
    const neighbor = seed ? keyboardLetterNeighbor(seed) : null;
    const extra = neighbor ? preserveCase(seed, neighbor) : seed;
    return extra ? `${base}${extra}` : base;
  }

  const index = pickRandom(editableIndexes);
  const char = base[index];
  const neighbor = keyboardLetterNeighbor(char);

  if (neighbor && Math.random() < 0.55) {
    return base.slice(0, index) + preserveCase(char, neighbor) + base.slice(index + 1);
  }

  if (neighbor && Math.random() < 0.5) {
    return base.slice(0, index) + preserveCase(char, neighbor) + base.slice(index);
  }

  return base.slice(0, index) + char + base.slice(index);
}

/** One realistic typo on a single token — letters only, never digits, never the first letter. */
export function keyboardFatFingerOncePreserveFirst(text: string): string {
  if (text.length < 2) return text;

  const editableIndexes = text
    .split("")
    .map((char, index) => (/[a-z]/i.test(char) && index > 0 ? index : -1))
    .filter((index) => index >= 0);

  if (editableIndexes.length === 0) return text;

  const index = pickRandom(editableIndexes);
  const char = text[index];
  const neighbor = keyboardLetterNeighbor(char);
  const roll = Math.random();

  if (roll < 0.62 && neighbor) {
    const replacement = preserveCase(char, neighbor);
    return text.slice(0, index) + replacement + text.slice(index + 1);
  }

  if (roll < 0.78 && neighbor) {
    const extra = preserveCase(char, neighbor);
    return text.slice(0, index) + extra + text.slice(index);
  }

  if (roll < 0.9 && index < text.length - 1 && /[a-z]/i.test(text[index + 1])) {
    const nextIndex = index + 1;
    return text.slice(0, index) + text[nextIndex] + text[index] + text.slice(nextIndex + 1);
  }

  return text.slice(0, index) + text.slice(index + 1);
}

/** One realistic typo on a single token — letters only, never digits. */
export function keyboardFatFingerOnce(text: string): string {
  if (text.length < 2) return text;

  const editableIndexes = text
    .split("")
    .map((char, index) => (/[a-z]/i.test(char) ? index : -1))
    .filter((index) => index >= 0);

  if (editableIndexes.length === 0) return text;

  const index = pickRandom(editableIndexes);
  const char = text[index];
  const neighbor = keyboardLetterNeighbor(char);
  const roll = Math.random();

  if (roll < 0.62 && neighbor) {
    const replacement = preserveCase(char, neighbor);
    return text.slice(0, index) + replacement + text.slice(index + 1);
  }

  if (roll < 0.78 && neighbor) {
    const extra = preserveCase(char, neighbor);
    return text.slice(0, index) + extra + text.slice(index);
  }

  if (roll < 0.9 && index < text.length - 1 && /[a-z]/i.test(text[index + 1])) {
    const nextIndex = index + 1;
    return text.slice(0, index) + text[nextIndex] + text[index] + text.slice(nextIndex + 1);
  }

  return text.slice(0, index) + text.slice(index + 1);
}

export function keyboardFatFinger(text: string, maxEdits = 1): string {
  if (!/[a-z]/i.test(text)) return text;
  const edits = Math.max(1, maxEdits);
  let value = text;
  for (let index = 0; index < edits; index += 1) {
    const next = keyboardFatFingerOnce(value);
    if (next === value) break;
    value = next;
  }
  return value;
}

function protectedTokenRanges(text: string, isProtectedToken?: (token: string) => boolean): [number, number][] {
  if (!isProtectedToken) return [];

  const ranges: [number, number][] = [];
  let offset = 0;

  for (const part of text.split(/(\s+)/)) {
    if (!/\s/.test(part) && isProtectedToken(part)) {
      ranges.push([offset, offset + part.length]);
    }
    offset += part.length;
  }

  return ranges;
}

function editableStreetCharIndexes(text: string, isProtectedToken?: (token: string) => boolean): number[] {
  const protectedRanges = protectedTokenRanges(text, isProtectedToken);

  return text
    .split("")
    .map((char, index) => {
      if (!/[a-z]/i.test(char)) return -1;
      if (protectedRanges.some(([start, end]) => index >= start && index < end)) return -1;
      return index;
    })
    .filter((index) => index >= 0);
}

export function isHouseNumberToken(token: string): boolean {
  return /^\d+[a-zA-Z]?$/.test(token.trim());
}

const DIRECTION_TOKEN_PATTERN =
  /^(N\.?\s*E\.?|Northeast|N\.?\s*W\.?|Northwest|S\.?\s*E\.?|Southeast|S\.?\s*W\.?|Southwest|N\.?|North|S\.?|South|E\.?|East|W\.?|West)$/i;

export function isDirectionToken(token: string): boolean {
  return DIRECTION_TOKEN_PATTERN.test(token.trim());
}

export function isAllUppercaseLetterToken(token: string): boolean {
  return /^[A-Z]+$/.test(token.trim());
}

export function isShortDirectionToken(token: string): boolean {
  const trimmed = token.trim();
  return /^(NE|NW|SE|SW|N|S|E|W)$/i.test(trimmed);
}

export function containsDigit(token: string): boolean {
  return /\d/.test(token);
}

/** Skip typos on house numbers, random letter blocks, short direction codes, and any token with digits. */
export function isProtectedFromTypo(token: string): boolean {
  return (
    isHouseNumberToken(token) ||
    isAllUppercaseLetterToken(token) ||
    isShortDirectionToken(token) ||
    containsDigit(token)
  );
}

/** @deprecated Use isProtectedFromTypo for street misspell typos. */
export function isProtectedStreetToken(token: string): boolean {
  return isProtectedFromTypo(token);
}

function replaceIndexWithNeighbor(text: string, index: number): string {
  const char = text[index];
  const neighbor = keyboardLetterNeighbor(char);
  if (!neighbor) return text;
  return text.slice(0, index) + preserveCase(char, neighbor) + text.slice(index + 1);
}

/** Fat-finger the first and/or last characters of a street line (not random letter blocks). */
export function keyboardBoundaryTypos(
  text: string,
  charCount: number,
  mode: "prefix" | "suffix" | "both",
  isProtectedToken: (token: string) => boolean = isProtectedStreetToken,
): string {
  const count = Math.max(1, Math.min(8, charCount));
  const indexes = editableStreetCharIndexes(text, isProtectedToken);
  if (indexes.length === 0) return text;

  let value = text;
  const applyAt = (fromStart: boolean) => {
    for (let edit = 0; edit < count; edit += 1) {
      const currentIndexes = editableStreetCharIndexes(value, isProtectedToken);
      if (currentIndexes.length === 0) break;
      const targetIndex = fromStart
        ? currentIndexes[edit] ?? currentIndexes[0]
        : currentIndexes[Math.max(0, currentIndexes.length - 1 - edit)] ?? currentIndexes[currentIndexes.length - 1];
      value = replaceIndexWithNeighbor(value, targetIndex);
    }
  };

  if (mode === "prefix" || mode === "both") {
    applyAt(true);
  }
  if (mode === "suffix" || mode === "both") {
    applyAt(false);
  }

  return value;
}

/** Apply at most one keyboard typo to one word in a phrase (street line). */
export function keyboardFatFingerPhrase(
  text: string,
  maxWordEdits = 1,
  isProtectedToken: (token: string) => boolean = isProtectedFromTypo,
): string {
  const parts = text.split(/(\s+)/);
  const wordIndexes = parts
    .map((part, index) => ({ part, index }))
    .filter(
      ({ part }) =>
        !/\s/.test(part) &&
        /[a-z]/i.test(part) &&
        !containsDigit(part) &&
        part.length >= 2 &&
        !isProtectedToken(part),
    );

  if (wordIndexes.length === 0) return text;

  const edits = Math.max(0, Math.min(maxWordEdits, wordIndexes.length));
  if (edits === 0) return text;
  const targets = [...wordIndexes].sort(() => Math.random() - 0.5).slice(0, edits);
  const next = [...parts];

  for (const target of targets) {
    next[target.index] = keyboardFatFingerOnce(target.part);
  }

  return next.join("");
}
