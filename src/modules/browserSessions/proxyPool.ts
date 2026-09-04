import type { ProxyEntry } from "./types";

export type ProxyAssignments = Record<string, string>;

export const MAX_PROXY_ATTEMPTS = 10;

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function enabledProxies(proxies: ProxyEntry[]): ProxyEntry[] {
  return proxies.filter((proxy) => proxy.enabled);
}

function proxyById(proxies: ProxyEntry[], proxyId: string | undefined): ProxyEntry | null {
  if (!proxyId) {
    return null;
  }
  return proxies.find((proxy) => proxy.id === proxyId) ?? null;
}

/** Hash-based fallback when every enabled proxy is already taken. */
export function pickDefaultProxyForAccount(
  proxies: ProxyEntry[],
  accountId: string,
): ProxyEntry | null {
  const enabled = enabledProxies(proxies);
  if (enabled.length === 0) {
    return null;
  }
  const index = stableHash(accountId) % enabled.length;
  return enabled[index] ?? null;
}

/** @deprecated Use resolveProxyForAccount with persisted assignments. */
export function pickProxyForAccount(proxies: ProxyEntry[], accountId: string): ProxyEntry | null {
  return pickDefaultProxyForAccount(proxies, accountId);
}

export function resolveProxyForAccount(
  proxies: ProxyEntry[],
  accountId: string,
  assignments: ProxyAssignments,
): ProxyEntry | null {
  const enabled = enabledProxies(proxies);
  const assigned = proxyById(enabled, assignments[accountId]);
  if (assigned) {
    return assigned;
  }
  return pickDefaultProxyForAccount(enabled, accountId);
}

export function ensureProxyAssignments(
  accountIds: string[],
  proxies: ProxyEntry[],
  assignments: ProxyAssignments,
): ProxyAssignments {
  const enabled = enabledProxies(proxies);
  const sortedAccountIds = [...accountIds].sort();
  const next: ProxyAssignments = {};
  const usedProxyIds = new Set<string>();

  for (const accountId of sortedAccountIds) {
    const assignedId = assignments[accountId];
    const assignedProxy = proxyById(enabled, assignedId);
    if (assignedProxy && !usedProxyIds.has(assignedProxy.id)) {
      next[accountId] = assignedProxy.id;
      usedProxyIds.add(assignedProxy.id);
    }
  }

  for (const accountId of sortedAccountIds) {
    if (next[accountId]) {
      continue;
    }

    const unused = enabled.find((proxy) => !usedProxyIds.has(proxy.id));
    const fallback = unused ?? pickDefaultProxyForAccount(enabled, accountId);
    if (fallback) {
      next[accountId] = fallback.id;
      usedProxyIds.add(fallback.id);
    }
  }

  return next;
}

export interface ReassignProxyResult {
  assignments: ProxyAssignments;
  proxy: ProxyEntry | null;
  error?: string;
}

export function reassignProxyForAccount(
  proxies: ProxyEntry[],
  accountId: string,
  assignments: ProxyAssignments,
): ReassignProxyResult {
  const enabled = enabledProxies(proxies);
  const currentProxyId = assignments[accountId];
  const usedByOthers = new Set(
    Object.entries(assignments)
      .filter(([id]) => id !== accountId)
      .map(([, proxyId]) => proxyId),
  );

  const candidates = enabled
    .filter((proxy) => proxy.id !== currentProxyId && !usedByOthers.has(proxy.id))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  if (candidates.length === 0) {
    return {
      assignments,
      proxy: null,
      error: "No unused proxies available. Add more proxies or free one from another account.",
    };
  }

  const picked = candidates[stableHash(`${accountId}:${currentProxyId ?? "none"}`) % candidates.length];
  if (!picked) {
    return { assignments, proxy: null, error: "Could not reassign proxy." };
  }

  return {
    assignments: { ...assignments, [accountId]: picked.id },
    proxy: picked,
  };
}

export function assignNextUntriedProxy(
  proxies: ProxyEntry[],
  accountId: string,
  assignments: ProxyAssignments,
  triedProxyIds: Set<string>,
): ReassignProxyResult {
  const enabled = enabledProxies(proxies);
  const usedByOthers = new Set(
    Object.entries(assignments)
      .filter(([id]) => id !== accountId)
      .map(([, proxyId]) => proxyId),
  );

  let candidates = enabled
    .filter((proxy) => !triedProxyIds.has(proxy.id) && !usedByOthers.has(proxy.id))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  if (candidates.length === 0) {
    candidates = enabled
      .filter((proxy) => !triedProxyIds.has(proxy.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  if (candidates.length === 0) {
    return {
      assignments,
      proxy: null,
      error: "No more proxies to try.",
    };
  }

  const picked = candidates[0];
  if (!picked) {
    return { assignments, proxy: null, error: "Could not pick next proxy." };
  }

  return {
    assignments: { ...assignments, [accountId]: picked.id },
    proxy: picked,
  };
}

export function resolveAccountStartUrl(site: string): string | undefined {
  const normalized = site.trim().toLowerCase();
  if (normalized === "target") {
    return "https://www.target.com/";
  }
  if (normalized === "walmart") {
    return "https://www.walmart.com/";
  }
  return undefined;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseProtocol(value: string | undefined): import("./types").ProxyProtocol {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "socks5" || normalized === "socks") {
    return "socks5";
  }
  if (normalized === "https") {
    return "https";
  }
  return "http";
}

function buildProxyEntry(
  host: string,
  port: number,
  username?: string,
  password?: string,
  protocol: import("./types").ProxyProtocol = "http",
  label?: string,
  groupId?: string,
): ProxyEntry {
  return {
    id: crypto.randomUUID(),
    groupId: groupId || "proxy-uncategorized",
    label: trimOrUndefined(label),
    host: host.trim(),
    port,
    username: trimOrUndefined(username),
    password: trimOrUndefined(password),
    protocol,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
}

export function parseProxyLine(line: string, groupId?: string): ProxyEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  try {
    if (trimmed.includes("://")) {
      const url = new URL(trimmed);
      const host = url.hostname.trim();
      const port = Number.parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10);
      if (!host || !Number.isFinite(port)) {
        return null;
      }
      const username = decodeURIComponent(url.username || "");
      return buildProxyEntry(
        host,
        port,
        username,
        decodeURIComponent(url.password || ""),
        parseProtocol(url.protocol.replace(":", "")),
        undefined,
        groupId,
      );
    }
  } catch {
    // fall through
  }

  const parts = trimmed.split(":");
  if (parts.length < 2) {
    return null;
  }

  const host = parts[0]?.trim();
  const port = Number.parseInt(parts[1]?.trim() ?? "", 10);
  if (!host || !Number.isFinite(port)) {
    return null;
  }

  const username = parts[2]?.trim();
  const password = parts.slice(3).join(":").trim();
  return buildProxyEntry(host, port, username, password, "http", undefined, groupId);
}

export function parseProxyLines(text: string, groupId?: string): ProxyEntry[] {
  const entries: ProxyEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseProxyLine(line, groupId);
    if (parsed) {
      entries.push(parsed);
    }
  }
  return entries;
}

export function formatProxyServer(proxy: ProxyEntry): string {
  const auth =
    proxy.username && proxy.password
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : proxy.username
        ? `${encodeURIComponent(proxy.username)}@`
        : "";
  return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
}

function hostPortLabel(proxy: Pick<ProxyEntry, "host" | "port">): string {
  return `${proxy.host}:${proxy.port}`;
}

function isGenericHostLabel(label: string, proxy: Pick<ProxyEntry, "host" | "port">): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized === proxy.host.toLowerCase() || normalized === hostPortLabel(proxy).toLowerCase();
}

export function formatProxyLabel(proxy: ProxyEntry): string {
  const hostPort = hostPortLabel(proxy);
  const user = proxy.username?.trim();
  const custom = proxy.label?.trim();
  if (custom && !isGenericHostLabel(custom, proxy)) {
    return user ? `${custom} · ${user}` : custom;
  }
  return user ? `${user} @ ${hostPort}` : hostPort;
}

export function maskProxyLabel(proxy: ProxyEntry): string {
  return formatProxyLabel(proxy);
}
