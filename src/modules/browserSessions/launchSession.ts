import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/env";
import { getPythonPath } from "../../lib/browserStorage";
import type { Credential, ProfileSummary } from "../../lib/types";
import {
  buildAccountSessionContext,
  buildAccountSessionLabel,
} from "./accountSessions";
import { resolveTimezoneForAccount, summarizeCamoufoxSession } from "./fingerprint";
import {
  assignNextUntriedProxy,
  formatProxyLabel,
  formatProxyServer,
  MAX_PROXY_ATTEMPTS,
  resolveProxyForAccount,
  resolveAccountStartUrl,
  type ProxyAssignments,
} from "./proxyPool";
import type {
  BrowserSessionLaunchRequest,
  BrowserSessionLaunchResult,
  CamoufoxCheckResult,
  BundledRuntimeInfo,
  ProxyEntry,
  ProxyTestResult,
} from "./types";

export interface OpenBrowserSessionOptions {
  credential: Credential;
  profiles: ProfileSummary[];
  proxies: ProxyEntry[];
  proxyAssignments: ProxyAssignments;
  startUrl?: string;
  pythonPath?: string;
}

export interface OpenBrowserSessionOutcome {
  result: BrowserSessionLaunchResult;
  proxyAssignments: ProxyAssignments;
}

export function buildBrowserSessionLaunchRequest(
  options: OpenBrowserSessionOptions,
): BrowserSessionLaunchRequest {
  const { credential, proxies, profiles, proxyAssignments } = options;
  const context = buildAccountSessionContext(credential, profiles);
  const proxy = resolveProxyForAccount(proxies, credential.id, proxyAssignments);

  return {
    accountId: credential.id,
    accountLabel: buildAccountSessionLabel(credential),
    startUrl: options.startUrl ?? resolveAccountStartUrl(credential.site),
    proxyServer: proxy ? formatProxyServer(proxy) : undefined,
    timezone: resolveTimezoneForAccount(credential.id, context.timezoneHint),
    locale: "en-US",
    pythonPath: options.pythonPath,
  };
}

export async function checkCamoufoxReady(pythonPath?: string): Promise<CamoufoxCheckResult> {
  if (!isTauriRuntime()) {
    return {
      ready: false,
      message: "Camoufox checks require the desktop app. Run npm run dev:app.",
    };
  }

  return invoke<CamoufoxCheckResult>("check_camoufox", {
    pythonPath: pythonPath?.trim() || undefined,
  });
}

export async function getBundledRuntimeInfo(): Promise<BundledRuntimeInfo> {
  if (!isTauriRuntime()) {
    return { available: false };
  }

  return invoke<BundledRuntimeInfo>("bundled_runtime_info");
}

export async function testProxy(proxyServer: string): Promise<ProxyTestResult> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      message: "Proxy tests require the desktop app. Run npm run dev:app.",
    };
  }

  return invoke<ProxyTestResult>("test_proxy", { proxyServer });
}

export async function listRunningBrowserSessions(): Promise<string[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return invoke<string[]>("list_running_browser_sessions");
}

export async function openBrowserSession(
  options: OpenBrowserSessionOptions,
): Promise<OpenBrowserSessionOutcome> {
  if (!isTauriRuntime()) {
    throw new Error("Browser sessions require the desktop app. Run npm run dev:app.");
  }

  const pythonPath = options.pythonPath ?? (await getPythonPath());
  let assignments: ProxyAssignments = { ...options.proxyAssignments };
  const triedProxyIds = new Set<string>();
  let lastError = "Proxy test failed.";

  for (let attempt = 1; attempt <= MAX_PROXY_ATTEMPTS; attempt += 1) {
    const proxy = resolveProxyForAccount(options.proxies, options.credential.id, assignments);
    if (!proxy) {
      throw new Error("No enabled proxy available.");
    }

    triedProxyIds.add(proxy.id);
    const proxyServer = formatProxyServer(proxy);
    const test = await testProxy(proxyServer);
    if (test.ok) {
      const request = buildBrowserSessionLaunchRequest({
        ...options,
        pythonPath,
        proxyAssignments: assignments,
      });
      const result = await invoke<BrowserSessionLaunchResult>("launch_browser_session", { request });

      return {
        result: {
          ...result,
          proxyLabel: formatProxyLabel(proxy),
          fingerprintSummary: summarizeCamoufoxSession(result.fingerprintSummary),
          cookiesPersisted: result.cookiesPersisted,
        },
        proxyAssignments: assignments,
      };
    }

    lastError = test.message;

    if (attempt >= MAX_PROXY_ATTEMPTS) {
      break;
    }

    const next = assignNextUntriedProxy(
      options.proxies,
      options.credential.id,
      assignments,
      triedProxyIds,
    );
    if (!next.proxy) {
      throw new Error(
        `Could not find a working proxy after trying ${triedProxyIds.size} proxy(ies). ${lastError}`,
      );
    }
    assignments = next.assignments;
  }

  throw new Error(
    `Could not find a working proxy after ${MAX_PROXY_ATTEMPTS} attempts. ${lastError}`,
  );
}
