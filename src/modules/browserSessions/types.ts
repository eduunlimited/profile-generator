export type ProxyProtocol = "http" | "https" | "socks5";

export interface ProxyGroup {
  id: string;
  name: string;
  createdAt: string;
  sortOrder?: number;
}

export interface ProxyEntry {
  id: string;
  groupId: string;
  label?: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: ProxyProtocol;
  enabled: boolean;
  createdAt: string;
}

export interface BrowserSessionLaunchRequest {
  accountId: string;
  accountLabel: string;
  startUrl?: string;
  proxyServer?: string;
  timezone?: string;
  locale?: string;
  pythonPath?: string;
}

export interface BrowserSessionLaunchResult {
  sessionId: string;
  accountId: string;
  browserExecutable: string;
  sessionDataDir: string;
  fingerprintPath: string;
  proxyLabel?: string;
  fingerprintSummary: string;
  startUrl?: string;
  cookiesPersisted: boolean;
}

export interface BundledRuntimeInfo {
  available: boolean;
  pythonPath?: string;
  launcherScriptPath?: string;
}

export interface CamoufoxCheckResult {
  ready: boolean;
  message: string;
  version?: string;
}

export interface ProxyTestResult {
  ok: boolean;
  message: string;
}
