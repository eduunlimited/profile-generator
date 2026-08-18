import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Credential, ProfileSummary } from "../../lib/types";
import { isTauriRuntime } from "../../lib/env";
import { getPythonPath, savePythonPath } from "../../lib/browserStorage";
import { initLocalDataStore } from "../../lib/localDataStore";
import { checkCamoufoxReady, getBundledRuntimeInfo, listRunningBrowserSessions, openBrowserSession } from "./launchSession";
import {
  ensureProxyAssignments,
  reassignProxyForAccount,
  resolveProxyForAccount,
  type ProxyAssignments,
} from "./proxyPool";
import { parseProxyLines } from "./proxyPool";
import { nextProxyGroupSortOrder, sortProxyGroups } from "./proxyGroupUtils";
import {
  deleteProxyGroup,
  listProxies,
  listProxyAssignments,
  listProxyGroups,
  replaceProxyAssignments,
  replaceProxyPool,
  saveProxyGroup,
} from "./storage";
import type { BrowserSessionLaunchResult, BundledRuntimeInfo, CamoufoxCheckResult, ProxyEntry, ProxyGroup } from "./types";

export function useBrowserSessions() {
  const [proxies, setProxies] = useState<ProxyEntry[]>([]);
  const [proxyGroups, setProxyGroups] = useState<ProxyGroup[]>([]);
  const [proxyAssignments, setProxyAssignments] = useState<ProxyAssignments>({});
  const [pythonPath, setPythonPath] = useState("");
  const [camoufoxStatus, setCamoufoxStatus] = useState<CamoufoxCheckResult | null>(null);
  const [bundledRuntime, setBundledRuntime] = useState<BundledRuntimeInfo | null>(null);
  const [runningAccountIds, setRunningAccountIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refreshRunningSessions = useCallback(async () => {
    if (!isTauriRuntime()) {
      setRunningAccountIds(new Set());
      return;
    }
    const ids = await listRunningBrowserSessions();
    setRunningAccountIds(new Set(ids));
  }, []);

  useEffect(() => {
    void refreshRunningSessions();

    if (!isTauriRuntime()) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshRunningSessions();
    }, 2500);

    let unlisten: (() => void) | undefined;
    void listen<string>("browser-session-ended", (event) => {
      setRunningAccountIds((current) => {
        const next = new Set(current);
        next.delete(event.payload);
        return next;
      });
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      window.clearInterval(interval);
      unlisten?.();
    };
  }, [refreshRunningSessions]);

  const refreshProxies = useCallback(async () => {
    setLoading(true);
    try {
      await initLocalDataStore();
      const [nextProxies, nextGroups, nextAssignments, storedPythonPath] = await Promise.all([
        listProxies(),
        listProxyGroups(),
        listProxyAssignments(),
        getPythonPath(),
      ]);
      setProxies(nextProxies);
      setProxyGroups(nextGroups);
      setProxyAssignments(nextAssignments);
      setPythonPath(storedPythonPath ?? "");
      if (isTauriRuntime()) {
        const runtime = await getBundledRuntimeInfo();
        setBundledRuntime(runtime);
        if (runtime.available) {
          const result = await checkCamoufoxReady(storedPythonPath ?? undefined);
          setCamoufoxStatus(result);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProxies();
  }, [refreshProxies]);

  const replaceProxies = useCallback(async (nextProxies: ProxyEntry[]) => {
    await replaceProxyPool(nextProxies);
    setProxies(nextProxies);
  }, []);

  const createProxyGroup = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error("Group name is required.");
      }
      const group: ProxyGroup = {
        id: crypto.randomUUID(),
        name: trimmed,
        createdAt: new Date().toISOString(),
        sortOrder: nextProxyGroupSortOrder(proxyGroups),
      };
      await saveProxyGroup(group);
      setProxyGroups(sortProxyGroups([...proxyGroups, group]));
      return group;
    },
    [proxyGroups],
  );

  const removeProxyGroup = useCallback(
    async (groupId: string) => {
      await deleteProxyGroup(groupId);
      const [nextProxies, nextGroups] = await Promise.all([listProxies(), listProxyGroups()]);
      setProxies(nextProxies);
      setProxyGroups(nextGroups);
    },
    [],
  );

  const importProxiesToGroup = useCallback(
    async (text: string, groupId: string) => {
      const parsed = parseProxyLines(text, groupId);
      if (parsed.length === 0) {
        throw new Error("Paste at least one valid proxy line.");
      }
      const nextProxies = [...proxies, ...parsed];
      await replaceProxyPool(nextProxies);
      setProxies(nextProxies);
      return parsed.length;
    },
    [proxies],
  );

  const toggleProxy = useCallback(
    async (proxyId: string) => {
      await replaceProxies(
        proxies.map((proxy) =>
          proxy.id === proxyId ? { ...proxy, enabled: !proxy.enabled } : proxy,
        ),
      );
    },
    [proxies, replaceProxies],
  );

  const removeProxy = useCallback(
    async (proxyId: string) => {
      await replaceProxies(proxies.filter((proxy) => proxy.id !== proxyId));
    },
    [proxies, replaceProxies],
  );

  const persistAssignments = useCallback(async (nextAssignments: ProxyAssignments) => {
    await replaceProxyAssignments(nextAssignments);
    setProxyAssignments(nextAssignments);
  }, []);

  const syncAssignments = useCallback(
    async (accountIds: string[]) => {
      const nextAssignments = ensureProxyAssignments(accountIds, proxies, proxyAssignments);
      const changed =
        Object.keys(nextAssignments).length !== Object.keys(proxyAssignments).length ||
        Object.entries(nextAssignments).some(([accountId, proxyId]) => proxyAssignments[accountId] !== proxyId);

      if (changed) {
        await persistAssignments(nextAssignments);
      }
      return nextAssignments;
    },
    [persistAssignments, proxies, proxyAssignments],
  );

  const getAssignedProxy = useCallback(
    (accountId: string) => resolveProxyForAccount(proxies, accountId, proxyAssignments),
    [proxies, proxyAssignments],
  );

  const refreshProxyForAccount = useCallback(
    async (accountId: string) => {
      const result = reassignProxyForAccount(proxies, accountId, proxyAssignments);
      if (result.error || !result.proxy) {
        throw new Error(result.error ?? "Could not reassign proxy.");
      }
      await persistAssignments(result.assignments);
      return result.proxy;
    },
    [persistAssignments, proxies, proxyAssignments],
  );

  const updatePythonPath = useCallback(async (nextPath: string) => {
    setPythonPath(nextPath);
    await savePythonPath(nextPath);
    setCamoufoxStatus(null);
  }, []);

  const setPythonPathDraft = useCallback((nextPath: string) => {
    setPythonPath(nextPath);
  }, []);

  const persistPythonPath = useCallback(async () => {
    await savePythonPath(pythonPath);
  }, [pythonPath]);

  const testCamoufox = useCallback(async () => {
    await persistPythonPath();
    const result = await checkCamoufoxReady(pythonPath);
    setCamoufoxStatus(result);
    return result;
  }, [persistPythonPath, pythonPath]);

  const openSessionForAccount = useCallback(
    async (
      credential: Credential,
      profiles: ProfileSummary[],
    ): Promise<BrowserSessionLaunchResult> => {
      await persistPythonPath();
      const { result, proxyAssignments: nextAssignments } = await openBrowserSession({
        credential,
        profiles,
        proxies,
        proxyAssignments,
        pythonPath: pythonPath.trim() || undefined,
      });

      const assignmentsChanged =
        Object.keys(nextAssignments).length !== Object.keys(proxyAssignments).length ||
        Object.entries(nextAssignments).some(
          ([accountId, proxyId]) => proxyAssignments[accountId] !== proxyId,
        );

      if (assignmentsChanged) {
        await persistAssignments(nextAssignments);
      }

      setRunningAccountIds((current) => new Set(current).add(credential.id));
      void refreshRunningSessions();

      return result;
    },
    [proxies, proxyAssignments, pythonPath, persistPythonPath, persistAssignments, refreshRunningSessions],
  );

  const isAccountSessionRunning = useCallback(
    (accountId: string) => runningAccountIds.has(accountId),
    [runningAccountIds],
  );

  return {
    proxies,
    proxyGroups,
    proxyAssignments,
    pythonPath,
    camoufoxStatus,
    bundledRuntime,
    runningAccountIds,
    loading,
    refreshProxies,
    replaceProxies,
    createProxyGroup,
    removeProxyGroup,
    importProxiesToGroup,
    toggleProxy,
    removeProxy,
    syncAssignments,
    getAssignedProxy,
    refreshProxyForAccount,
    updatePythonPath,
    setPythonPathDraft,
    testCamoufox,
    openSessionForAccount,
    isAccountSessionRunning,
    enabledProxyCount: proxies.filter((proxy) => proxy.enabled).length,
  };
}
