import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectActiveTab } from "../stores/app";
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

  const s = useAppStore.getState();
  const { paneState } = s;

  // Check if already open in any pane — focus it
  for (const pane of paneState.panes) {
    const existing = pane.tabs.find((t) => t.path === path);
    if (existing) {
      const activePane = paneState.panes.find((p) => p.id === paneState.activePaneId);
      if (opts?.replaceActive && activePane?.activeTabId) {
        s.pushNav(activePane.activeTabId, { path: activePane.activeTabId, cursor: 0 });
      }
      s.setActiveTab(existing.id);
      return;
    }
  }

  // Check if orphan
  const underDir = await isUnderRegisteredDir(path);
  if (!underDir) {
    await invoke("allow_path", { path });
    useAppStore.getState().addOrphanPath(path);
  }

  const content = await invoke<string>("read_file", { path });
  loadFileIntoCache(path, content);

  // Read fresh state after await
  const fresh = useAppStore.getState();
  const freshPane = fresh.paneState.panes.find((p) => p.id === fresh.paneState.activePaneId);
  const activeTabId = freshPane?.activeTabId;

  if (opts?.replaceActive && activeTabId) {
    fresh.pushNav(activeTabId, { path: activeTabId, cursor: 0 });
    fresh.replaceActiveTab(path, name);
  } else {
    fresh.openFile(path, name);
  }
}

/**
 * Navigate back/forward in the active tab's history.
 * Opens the target file in the current tab position.
 */
export async function navigateHistory(direction: "back" | "forward"): Promise<void> {
  const store = useAppStore.getState();
  const tab = selectActiveTab(store);
  if (!tab) return;

  const entry = direction === "back"
    ? store.navigateBack(tab.id)
    : store.navigateForward(tab.id);
  if (!entry) return;

  const content = await invoke<string>("read_file", { path: entry.path });
  loadFileIntoCache(entry.path, content);

  // Replace the tab with the nav target
  const name = entry.path.split("/").pop() || entry.path;
  useAppStore.getState().replaceActiveTab(entry.path, name);
}
