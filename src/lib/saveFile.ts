import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";

export type SaveOutcome = "saved" | "conflict" | "deleted" | "failed";

/**
 * Write an open file's content, the one save path for note and canvas tabs.
 *
 * `write_file` refuses with a `CONFLICT:` error when the file changed on disk since it
 * was read, and with `DELETED:` when it is gone. Both arrive as a rejected promise; this
 * turns them into store state (the status bar's conflict prompt, the deleted marker) so
 * a refused save is always visible and never resurrects a deleted file.
 */
export async function saveFile(path: string, content: string): Promise<SaveOutcome> {
  const store = useAppStore.getState();
  if (store.deletedPaths.has(path)) return "deleted";
  try {
    await invoke("write_file", { path, content });
    return "saved";
  } catch (err) {
    const msg = String(err);
    if (msg.startsWith("CONFLICT:")) {
      useAppStore.getState().setSaveConflictPath(path);
      return "conflict";
    }
    if (msg.startsWith("DELETED:")) {
      useAppStore.getState().addDeletedPath(path);
      return "deleted";
    }
    console.error(`Failed to save ${path}:`, err);
    return "failed";
  }
}
