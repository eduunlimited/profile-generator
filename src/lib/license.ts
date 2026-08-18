import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./env";

export interface LicenseStatus {
  licensed: boolean;
  status: string;
  message: string;
  licenseKey?: string;
  offline: boolean;
}

export async function licensingRequired(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  return invoke<boolean>("licensing_required");
}

export async function checkLicense(): Promise<LicenseStatus> {
  if (!isTauriRuntime()) {
    return {
      licensed: true,
      status: "browser",
      message: "Licensing is disabled in browser UI mode.",
      offline: false,
    };
  }
  return invoke<LicenseStatus>("check_license");
}

export async function activateLicense(licenseKey: string): Promise<LicenseStatus> {
  if (!isTauriRuntime()) {
    throw new Error("License activation requires the desktop app.");
  }
  return invoke<LicenseStatus>("activate_license", { licenseKey });
}

export async function clearLicense(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("clear_license");
}
