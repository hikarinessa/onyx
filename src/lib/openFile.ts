import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { loadFileIntoCache } from "./editorBridge";
import { editorStateCache } from "../components/editorShared";
import { recordRecentDoc } from "./recentDocs";

/**
 * Open a file in the editor. If the tab already exists, switch to it.
 * Otherwise, read the file content, cache it, and open a new tab.
 * Pushes current location to navigation back stack unless skipNav is true.
 */
export async function openFileInEditor(
  path: string,
  name: string,
  opts?: { skipNav?: boolean },
): Promise<void> {
  recordRecentDoc(path, name);

  // Push current tab to nav back stack before navigating
  if (!opts?.skipNav) {
    const { activeTabId, pushNav } = useAppStore.getState();
    if (activeTabId && activeTabId !== path) {
      // Capture actual cursor position from cached editor state
      const cachedState = editorStateCache.get(activeTabId);
      const cursor = cachedState ? cachedState.selection.main.head : 0;
      pushNav(activeTabId, { path: activeTabId, cursor });
    }
  }

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
