import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { isTauriRuntime } from "./env";

export async function checkForAppUpdates(options?: { silent?: boolean }): Promise<void> {
  if (!isTauriRuntime() || import.meta.env.DEV) {
    return;
  }

  try {
    const update = await check();
    if (!update?.available) {
      if (!options?.silent) {
        await ask("You are running the latest version.", {
          title: "No updates",
          kind: "info",
          okLabel: "OK",
        });
      }
      return;
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
      return;
    }

    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    if (!options?.silent) {
      const message = error instanceof Error ? error.message : "Could not check for updates.";
      await ask(message, {
        title: "Update check failed",
        kind: "error",
        okLabel: "OK",
      });
    }
  }
}
