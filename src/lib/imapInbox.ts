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

export function toStoredImapMessage(message: ImapMessage, fetchedAt = new Date().toISOString()): StoredImapMessage {
  const parsed = Date.parse(message.date);
  return {
    ...message,
    messageId: message.messageId?.trim() || undefined,
    dateMs: Number.isFinite(parsed) ? parsed : 0,
    fetchedAt,
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
    byKey.set(storedImapMessageKey(message), message);
  }
  for (const message of incoming) {
    const stored = toStoredImapMessage(message, fetchedAt);
    byKey.set(storedImapMessageKey(stored), stored);
  }
  return [...byKey.values()]
    .sort((a, b) => b.dateMs - a.dateMs || b.uid - a.uid)
    .slice(0, cap);
}
