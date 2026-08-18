import { isTauriRuntime } from "./env";
import { formatError } from "./errorUtils";

/** Saves text to disk (Tauri) or triggers a browser download. Returns false when the user cancels. */
export async function saveTextFile(filename: string, content: string): Promise<boolean> {
  if (isTauriRuntime()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: filename,
      filters: [{ name: filename, extensions: [filename.split(".").pop() ?? "txt"] }],
    });
    if (!path) return false;
    try {
      await writeTextFile(path, content);
      return true;
    } catch (error) {
      throw new Error(`Could not save ${filename}: ${formatError(error, "file write denied")}`);
    }
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
