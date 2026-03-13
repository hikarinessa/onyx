import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { loadFileIntoCache } from "../components/Editor";
import { recordRecentDoc } from "./recentDocs";

/** Check if a file path is under any registered directory */
async function isUnderRegisteredDir(filePath: string): Promise<boolean> {
  try {
    const dirs = await invoke<{ path: string }[]>("get_registered_directories");
    return dirs.some((d) => filePath.startsWith(d.path + "/") || filePath === d.path);
  } catch {
    return false;
  }
}

/**
 * Open a file in the editor.
 * - If the tab already exists, switch to it.
 * - If replaceActive is true, replace the current tab (and push nav history).
 * - Otherwise, open in a new tab.
 */
export async function openFileInEditor(
  path: string,
  name: string,
  opts?: { replaceActive?: boolean },
): Promise<void> {
  recordRecentDoc(path, name);

  const store = useAppStore.getState();

  // Already open? Just switch.
  const existing = store.tabs.find((t) => t.path === path);
  if (existing) {
    // Push nav entry before switching if replacing
    if (opts?.replaceActive && store.activeTabId) {
      store.pushNav(store.activeTabId, { path: store.activeTabId, cursor: 0 });
    }
    store.setActiveTab(existing.id);
    return;
  }

  // Check if orphan — if so, allow the path on the Rust side before reading
  const underDir = await isUnderRegisteredDir(path);
  if (!underDir) {
    await invoke("allow_path", { path });
    useAppStore.getState().addOrphanPath(path);
  }

  const content = await invoke<string>("read_file", { path });
  loadFileIntoCache(path, content);

  if (opts?.replaceActive && store.activeTabId) {
    // Push current location to nav stack before replacing
    store.pushNav(store.activeTabId, { path: store.activeTabId, cursor: 0 });
    store.replaceActiveTab(path, name);
  } else {
    store.openFile(path, name);
  }
}

/**
 * Navigate back/forward in the active tab's history.
 * Opens the target file in the current tab position.
 */
export async function navigateHistory(direction: "back" | "forward"): Promise<void> {
  const store = useAppStore.getState();
  if (!store.activeTabId) return;

  const entry = direction === "back"
    ? store.navigateBack(store.activeTabId)
    : store.navigateForward(store.activeTabId);
  if (!entry) return;

  const content = await invoke<string>("read_file", { path: entry.path });
  loadFileIntoCache(entry.path, content);

  // Replace the tab with the nav target
  const name = entry.path.split("/").pop() || entry.path;
  useAppStore.getState().replaceActiveTab(entry.path, name);
}
