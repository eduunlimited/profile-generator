import {
  deleteProxy,
  deleteProxyGroup,
  importProxies,
  listProxies,
  listProxyAssignments,
  listProxyGroups,
  saveProxies,
  saveProxyAssignments,
  saveProxyGroup,
} from "../../lib/api";
import type { ProxyEntry } from "./types";
import type { ProxyAssignments } from "./proxyPool";

export {
  listProxies,
  saveProxies,
  importProxies,
  deleteProxy,
  listProxyAssignments,
  saveProxyAssignments,
  listProxyGroups,
  saveProxyGroup,
  deleteProxyGroup,
};

export async function replaceProxyPool(proxies: ProxyEntry[]): Promise<void> {
  await saveProxies(proxies);
}

export async function replaceProxyAssignments(assignments: ProxyAssignments): Promise<void> {
  await saveProxyAssignments(assignments);
}
