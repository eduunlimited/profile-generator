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
