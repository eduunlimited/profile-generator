import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { isTauriRuntime } from "./env";

export function isAppUpdateCheckAvailable(): boolean {
  return isTauriRuntime() && !import.meta.env.DEV;
}

export type AppUpdateCheckResult = {
  available: boolean;
};

function updaterErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown };
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }
  return "Could not check for updates.";
}

/** Empty update feed, 404, or no latest.json — not a broken install. */
function isUnreachableUpdateFeed(message: string): boolean {
  return /could not fetch a valid release json|invalid release json|404|not found|failed to fetch|error sending request|timed out|dns|no such host/i.test(
    message,
  );
}

async function showUpToDate(): Promise<void> {
  await ask("You are running the latest version.", {
    title: "No updates",
    kind: "info",
    okLabel: "OK",
  });
}

export async function checkForAppUpdates(options?: { silent?: boolean }): Promise<AppUpdateCheckResult> {
  if (!isAppUpdateCheckAvailable()) {
    if (!options?.silent) {
      throw new Error("Update checks run in the installed desktop app, not in this browser or dev window.");
    }
    return { available: false };
  }

  try {
    const update = await check();
    if (!update?.available) {
      if (!options?.silent) {
        await showUpToDate();
      }
      return { available: false };
    }

    const yes = await ask(
      `Version ${update.version} is available.\n\n${update.body ?? "Install the update and restart?"}`,
      {
        title: "Update available",
        kind: "info",
        okLabel: "Update now",
        cancelLabel: "Later",
      },
    );

    if (!yes) {
      return { available: true };
    }

    await update.downloadAndInstall();
    await relaunch();
    return { available: true };
  } catch (error) {
    const raw = updaterErrorMessage(error);
    if (isUnreachableUpdateFeed(raw)) {
      if (!options?.silent) {
        await showUpToDate();
      }
      return { available: false };
    }
    if (!options?.silent) {
      await ask(raw, {
        title: "Update check failed",
        kind: "error",
        okLabel: "OK",
      });
      throw new Error(raw);
    }
    return { available: false };
  }
}
