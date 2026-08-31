import type { ImapAccount, ImapMessage, ImapSettings, ProfileSummary, StoredImapMessage } from "./types";

export const IMAP_MAIL_CAP = 500;

export function emptyImapSettings(): ImapSettings {
  return {
    host: "",
    port: 993,
    username: "",
    password: "",
    mailbox: "INBOX",
  };
}

export function emptyImapAccount(): ImapAccount {
  return {
    ...emptyImapSettings(),
    id: crypto.randomUUID(),
    name: "",
    createdAt: new Date().toISOString(),
  };
}

export function imapAccountLabel(account: Pick<ImapAccount, "name" | "username" | "host">): string {
  return account.name.trim() || account.username.trim() || account.host.trim() || "IMAP key";
}

export function imapAccountToSettings(account: ImapAccount): ImapSettings {
  return {
    host: account.host,
    port: account.port,
    username: account.username,
    password: account.password,
    mailbox: account.mailbox,
  };
}

export function normalizeMailboxEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function extractEmailCode(text: string): string | undefined {
  const labeled = text.match(/(?:verification code|one[-\s]?time(?: password| code)?|security code|otp|pin)[^\d]{0,24}(\d{4,8})/i);
  if (labeled?.[1]) return labeled[1];
  const codeIs = text.match(/\b(?:is|code[:\s]+)(\d{4,8})\b/i);
  if (codeIs?.[1]) return codeIs[1];
  const six = text.match(/(?:^|\s)(\d{6})(?:\s|$)/);
  return six?.[1];
}

export function profileLookupEmail(profile: Pick<ProfileSummary, "email">): string {
  return normalizeMailboxEmail(profile.email ?? "");
}

export function matchImapMessageToProfiles(
  message: Pick<ImapMessage, "recipients">,
  profiles: ProfileSummary[],
): ProfileSummary[] {
  const recipients = new Set(message.recipients.map(normalizeMailboxEmail).filter(Boolean));
  if (recipients.size === 0) return [];
  return profiles.filter((profile) => {
    const email = profileLookupEmail(profile);
    return email.length > 0 && recipients.has(email);
  });
}

export function storedImapMessageKey(message: Pick<StoredImapMessage, "messageId" | "uid">): string {
  const messageId = message.messageId?.trim().toLowerCase();
  return messageId ? `id:${messageId}` : `uid:${message.uid}`;
}

export function parseSender(from: string, fromName?: string, fromEmail?: string): { name: string; email: string } {
  const name = fromName?.trim() ?? "";
  const email = fromEmail?.trim() ?? "";
  if (name || email) return { name, email };
  const trimmed = from.trim();
  const angled = trimmed.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angled) {
    return {
      name: angled[1].replace(/^["']|["']$/g, "").trim(),
      email: angled[2].trim(),
    };
  }
  if (trimmed.includes("@")) return { name: "", email: trimmed };
  return { name: trimmed, email: "" };
}

export function formatSender(from: string, fromName?: string, fromEmail?: string): string {
  const { name, email } = parseSender(from, fromName, fromEmail);
  if (name && email) return `${name} <${email}>`;
  return name || email || from.trim() || "—";
}

export function looksLikeEmailHtml(value: string): boolean {
  return /<(?:html|body|div|table|p|br|span|style|img|!doctype)\b/i.test(value);
}

export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function wrapEmailHtml(html: string): string {
  const safe = sanitizeEmailHtml(html);
  const chrome = `<meta charset="utf-8"><base target="_blank" rel="noopener noreferrer"><style>
    html, body { background: #ffffff; color: #111111; margin: 0; }
    body { padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; }
    img { max-width: 100%; height: auto; }
  </style>`;
  if (/<html[\s>]/i.test(safe)) {
    if (/<head[\s>]/i.test(safe)) {
      return safe.replace(/<head([^>]*)>/i, `<head$1>${chrome}`);
    }
    return safe.replace(/<html([^>]*)>/i, `<html$1><head>${chrome}</head>`);
  }
  return `<!DOCTYPE html><html><head>${chrome}</head><body>${safe}</body></html>`;
}

export function messageHtmlBody(message: Pick<ImapMessage, "body" | "htmlBody">): string {
  const html = message.htmlBody?.trim();
  if (html) return html;
  return looksLikeEmailHtml(message.body) ? message.body : "";
}

export function toStoredImapMessage(message: ImapMessage, fetchedAt = new Date().toISOString()): StoredImapMessage {
  const parsed = Date.parse(message.date);
  return {
    ...message,
    messageId: message.messageId?.trim() || undefined,
    dateMs: Number.isFinite(parsed) ? parsed : 0,
    fetchedAt,
  };
}

export function toStoredImapHeaders(
  message: ImapMessage,
  fetchedAt = new Date().toISOString(),
): StoredImapMessage {
  const stored = toStoredImapMessage(message, fetchedAt);
  const existingMs = "dateMs" in message ? (message as StoredImapMessage).dateMs : undefined;
  const snippet = (stored.snippet || stored.body).replace(/\s+/g, " ").trim().slice(0, 280);
  return {
    ...stored,
    dateMs: Number.isFinite(existingMs) && (existingMs ?? 0) > 0 ? existingMs : stored.dateMs,
    snippet,
    body: "",
    htmlBody: undefined,
  };
}

export function mergeStoredImapMessages(
  existing: StoredImapMessage[],
  incoming: ImapMessage[],
  cap = IMAP_MAIL_CAP,
): StoredImapMessage[] {
  const fetchedAt = new Date().toISOString();
  const byKey = new Map<string, StoredImapMessage>();
  for (const message of existing) {
    byKey.set(storedImapMessageKey(message), toStoredImapHeaders(message, message.fetchedAt));
  }
  for (const message of incoming) {
    const stored = toStoredImapHeaders(message, fetchedAt);
    const previous = byKey.get(storedImapMessageKey(stored));
    if (previous && !stored.dateMs && previous.dateMs) {
      stored.dateMs = previous.dateMs;
      stored.date = stored.date || previous.date;
    }
    if (previous && !stored.snippet && previous.snippet) {
      stored.snippet = previous.snippet;
    }
    byKey.set(storedImapMessageKey(stored), stored);
  }
  return [...byKey.values()]
    .sort((a, b) => b.dateMs - a.dateMs || b.uid - a.uid)
    .slice(0, cap);
}
