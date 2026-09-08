import type { Plugin } from "vite";
import { ImapFlow } from "imapflow";

type ImapSettings = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  mailbox?: string;
};

type Address = { name?: string; address?: string };

function addresses(list: Address[] | undefined): string {
  return (list ?? [])
    .map((entry) => {
      const email = entry.address?.trim() ?? "";
      const name = entry.name?.trim() ?? "";
      if (name && email) return `${name} <${email}>`;
      return email || name;
    })
    .filter(Boolean)
    .join(", ");
}

function emailsFrom(list: Address[] | undefined): string[] {
  return [...new Set((list ?? []).map((entry) => entry.address?.trim().toLowerCase()).filter(Boolean))];
}

function toMessage(
  uid: number,
  envelope: {
    subject?: string;
    date?: Date;
    from?: Address[];
    to?: Address[];
    cc?: Address[];
    messageId?: string;
  } | null,
  source: Buffer | undefined,
): Record<string, unknown> {
  const raw = source?.toString("utf8") ?? "";
  const fromList = envelope?.from ?? [];
  const fromEmail = fromList[0]?.address ?? "";
  const fromName = fromList[0]?.name ?? "";
  const recipients = [...emailsFrom(envelope?.to), ...emailsFrom(envelope?.cc)];
  return {
    uid,
    messageId: envelope?.messageId?.trim() || undefined,
    date: envelope?.date ? envelope.date.toISOString() : "",
    from: addresses(fromList),
    fromName,
    fromEmail,
    to: addresses(envelope?.to),
    recipients,
    subject: envelope?.subject ?? "",
    snippet: raw.replace(/\s+/g, " ").trim().slice(0, 280),
    body: raw,
    htmlBody: raw,
  };
}

async function readJson(req: { on: (event: string, cb: (chunk?: Buffer) => void) => void }): Promise<unknown> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      if (chunk) chunks.push(chunk);
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function connectSettings(settings: ImapSettings) {
  const host = settings.host?.trim() ?? "";
  const username = settings.username?.trim() ?? "";
  const password = settings.password ?? "";
  const mailbox = settings.mailbox?.trim() || "INBOX";
  const port = Number(settings.port) || 993;
  if (!host || !username || !password) {
    throw new Error("IMAP host, username, and password are required.");
  }
  return { host, username, password, mailbox, port };
}

async function withMailbox<T>(
  settings: ImapSettings,
  run: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const { host, username, password, mailbox, port } = connectSettings(settings);
  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user: username, pass: password },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(mailbox);
  try {
    return await run(client);
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
}

async function fetchMessages(settings: ImapSettings, uids: number[]) {
  const unique = [...new Set(uids.filter((uid) => Number.isFinite(uid) && uid > 0))];
  if (unique.length === 0) return [];
  return withMailbox(settings, async (client) => {
    const messages: Record<string, unknown>[] = [];
    for await (const item of client.fetch(
      unique.join(","),
      { uid: true, envelope: true, source: true },
      { uid: true },
    )) {
      messages.push(toMessage(item.uid, item.envelope ?? null, item.source));
    }
    return messages;
  });
}

async function searchHeaders(settings: ImapSettings, subjects: string[]) {
  const terms = [...new Set(subjects.map((value) => value.trim()).filter(Boolean))];
  if (terms.length === 0) return [];
  return withMailbox(settings, async (client) => {
    const uids = new Set<number>();
    for (const subject of terms) {
      const found = await client.search({ subject }, { uid: true });
      if (!found) continue;
      for (const uid of found) uids.add(uid);
    }
    if (uids.size === 0) return [];
    const messages: Record<string, unknown>[] = [];
    for await (const item of client.fetch(
      [...uids].join(","),
      { uid: true, envelope: true },
      { uid: true },
    )) {
      messages.push(toMessage(item.uid, item.envelope ?? null, undefined));
    }
    return messages;
  });
}

export function imapDevPlugin(): Plugin {
  return {
    name: "local-imap",
    configureServer(server) {
      server.middlewares.use("/__imap/headers", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        void (async () => {
          try {
            const payload = (await readJson(req)) as { settings?: ImapSettings; subjects?: string[] };
            const messages = await searchHeaders(payload.settings ?? {}, payload.subjects ?? []);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(messages));
          } catch (error) {
            const message = error instanceof Error && error.message.trim() ? error.message : "IMAP search failed.";
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify({ error: message }));
          }
        })();
      });
      server.middlewares.use("/__imap/messages", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        void (async () => {
          try {
            const payload = (await readJson(req)) as { settings?: ImapSettings; uids?: number[] };
            const messages = await fetchMessages(payload.settings ?? {}, payload.uids ?? []);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(messages));
          } catch (error) {
            const message = error instanceof Error && error.message.trim() ? error.message : "IMAP fetch failed.";
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify({ error: message }));
          }
        })();
      });
    },
  };
}
