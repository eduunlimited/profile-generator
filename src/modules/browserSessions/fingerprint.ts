const TIMEZONES_BY_STATE: Record<string, string> = {
  CA: "America/Los_Angeles",
  FL: "America/New_York",
  NY: "America/New_York",
  TX: "America/Chicago",
  AZ: "America/Phoenix",
  CO: "America/Denver",
  IL: "America/Chicago",
  WA: "America/Los_Angeles",
};

const DEFAULT_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
];

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickFrom<T>(items: readonly T[], seed: string): T {
  return items[stableHash(seed) % items.length] ?? items[0];
}

/** IANA timezone passed to Camoufox for an account. */
export function resolveTimezoneForAccount(
  accountId: string,
  timezoneHint?: string,
): string {
  const state = timezoneHint?.trim().toUpperCase() ?? "";
  return TIMEZONES_BY_STATE[state] ?? pickFrom(DEFAULT_TIMEZONES, `${accountId}:timezone`);
}

export function summarizeCamoufoxSession(summary?: string): string {
  return summary?.trim() || "Camoufox session";
}
