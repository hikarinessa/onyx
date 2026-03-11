import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { loadFileIntoCache } from "../components/Editor";

/**
 * Open a file in the editor. If the tab already exists, switch to it.
 * Otherwise, read the file content, cache it, and open a new tab.
 */
export async function openFileInEditor(path: string, name: string): Promise<void> {
  // Already open? Just switch.
  const existing = useAppStore.getState().tabs.find((t) => t.path === path);
  if (existing) {
    useAppStore.getState().openFile(path, name);
    return;
  }

  const content = await invoke<string>("read_file", { path });
  loadFileIntoCache(path, content);
  useAppStore.getState().openFile(path, name);
}
