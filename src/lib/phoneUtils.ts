/** Strip to US digits-only storage (10 digits; drops leading country code 1). */
export function normalizeUsPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const withoutCountry = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return withoutCountry.slice(0, 10);
}

/** Format stored or raw phone as XXX-XXX-XXXX for display. */
export function formatUsPhone(value: string): string {
  const digits = normalizeUsPhone(value);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function phoneLastFour(phone: string): string {
  return normalizeUsPhone(phone).slice(-4);
}

export function phonePrefixBeforeLastFour(phone: string): string {
  const digits = normalizeUsPhone(phone);
  return digits.length <= 4 ? "" : digits.slice(0, digits.length - 4);
}

export function applyPhoneLastFourJig(basePhone: string, lastFour: string): string {
  const prefix = phonePrefixBeforeLastFour(basePhone);
  return normalizeUsPhone(`${prefix}${lastFour.padStart(4, "0")}`);
}

export function randomUniquePhoneLastFour(exclude: Set<string>): string | null {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (!exclude.has(suffix)) {
      return suffix;
    }
  }

  for (let index = 0; index < 10000; index += 1) {
    const suffix = String(index).padStart(4, "0");
    if (!exclude.has(suffix)) {
      return suffix;
    }
  }

  return null;
}
