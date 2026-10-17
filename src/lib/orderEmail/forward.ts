import { emailPlainText } from "./parse";

const FORWARD_SUBJECT = /^(?:fwd|fw)\s*:/i;
const FORWARD_PREFIX = /^(?:(?:fwd|fw|re)\s*:\s*)+/i;
const FORWARD_MARKER = /forwarded message|begin forwarded message|original message/i;
const CONFIRMATION_SUBJECT = /thank you for shopping|here['\u2019]s your order/i;

export function isForwardedSubject(subject: string): boolean {
  return FORWARD_SUBJECT.test(subject.trim());
}

export function stripForwardSubject(subject: string): string {
  return subject.trim().replace(FORWARD_PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function hasForwardMarker(subject: string, ...parts: string[]): boolean {
  if (isForwardedSubject(subject)) return true;
  return FORWARD_MARKER.test(parts.filter(Boolean).join("\n"));
}

export function parseLooseEmailDate(value: string): number | undefined {
  const cleaned = value
    .replace(/[\u202f\u00a0\u2007\u2009]/g, " ")
    .replace(/\s+at\s+/gi, " ")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const attempts = [
    cleaned,
    cleaned.replace(/\s+(?:eastern|central|mountain|pacific|hawaii|alaska)(?:\s+(?:daylight|standard))?\s+time$/i, ""),
    cleaned.replace(/\s+[A-Z]{2,5}$/, ""),
  ];
  for (const attempt of attempts) {
    const parsed = Date.parse(attempt);
    if (!Number.isFinite(parsed)) continue;
    if (parsed < Date.UTC(2015, 0, 1) || parsed > Date.now() + 36 * 60 * 60 * 1000) continue;
    return parsed;
  }
  return undefined;
}

/** Earliest Date/Sent line inside a forwarded message, which is the original send time. */
export function originalForwardDateMs(subject: string, ...parts: string[]): number | undefined {
  const text = emailPlainText(parts.filter(Boolean).join("\n"));
  if (!hasForwardMarker(subject, text)) return undefined;
  const dates: number[] = [];
  for (const match of text.matchAll(/\b(?:Date|Sent):\s*([^\n\r]{6,120})/gi)) {
    const parsed = parseLooseEmailDate(match[1] ?? "");
    if (parsed) dates.push(parsed);
  }
  if (dates.length > 0) return Math.min(...dates);
  if (!CONFIRMATION_SUBJECT.test(subject) && !CONFIRMATION_SUBJECT.test(text.slice(0, 600))) return undefined;
  const orderDate = text.match(/\border\s*date\s*[:\-]?\s*([^\n\r]{6,80})/i);
  return orderDate ? parseLooseEmailDate(orderDate[1] ?? "") : undefined;
}

export function orderMessageDate(message: {
  date?: string;
  dateMs?: number;
  subject?: string;
  snippet?: string;
  body?: string;
  htmlBody?: string;
}): { date: string; dateMs: number } {
  const parsed = Date.parse(message.date ?? "");
  const wrapper =
    message.dateMs && message.dateMs > 0 ? message.dateMs : Number.isFinite(parsed) ? parsed : 0;
  const original = originalForwardDateMs(
    message.subject ?? "",
    message.snippet ?? "",
    message.body ?? "",
    message.htmlBody ?? "",
  );
  if (original && (wrapper <= 0 || original + 60_000 < wrapper)) {
    return { date: new Date(original).toISOString(), dateMs: original };
  }
  return {
    date: wrapper > 0 ? new Date(wrapper).toISOString() : (message.date ?? ""),
    dateMs: wrapper,
  };
}
