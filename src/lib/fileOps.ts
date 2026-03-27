import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectAllTabs, type Tab } from "../stores/app";
import { loadFileIntoCache, migrateEditorCache, clearEditorCache } from "../components/Editor";

/** Get all tabs across all panes */
function getAllTabs(): Tab[] {
  return selectAllTabs(useAppStore.getState());
}

/**
 * Centralized file operations module.
 *
 * Every file mutation (create, rename, delete) goes through here.
 * Rust commands emit fs:change events for external consumers (calendar, backlinks, etc.).
 * fileOps does synchronous UI updates (tabs, caches, tree) for responsiveness — the
 * fs:change event handler in App.tsx is idempotent and handles anything fileOps missed
 * (e.g. external changes from the watcher).
 */

/** Create a new note in a directory, open it, and return its path */
export async function createNote(dirPath: string): Promise<string> {
  const { path, name } = await findAvailablePath(dirPath);
  await invoke("write_file", { path, content: "" });
  loadFileIntoCache(path, "");
  useAppStore.getState().openFile(path, name);
  useAppStore.getState().bumpFileTreeVersion();
  return path;
}

/** Rename a file (not a folder), updating tabs and caches synchronously */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const newName = newPath.split("/").pop() || newPath;

  await invoke("rename_file", { oldPath, newPath });
  // Rust emits fs:change rename — but we update the tab synchronously for responsiveness.
  // The event handler in App.tsx will no-op if the tab was already updated.

  const store = useAppStore.getState();
  const allTabs = getAllTabs();
  const openTab = allTabs.find((t) => t.path === oldPath);
  if (openTab) {
    store.updateTabPath(openTab.id, newPath, newName);
    migrateEditorCache(oldPath, newPath);
  }

  // Clear any stale deleted marker for the old path
  store.removeDeletedPath(oldPath);
  store.bumpFileTreeVersion();
}

/** Rename a folder, updating all affected tabs and caches synchronously */
export async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  await invoke("rename_file", { oldPath, newPath });

  const store = useAppStore.getState();
  const allTabs = getAllTabs();
  const oldPrefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
  for (const tab of allTabs) {
    if (tab.path.startsWith(oldPrefix)) {
      const migratedPath = newPath + tab.path.slice(oldPath.length);
      const migratedName = migratedPath.split("/").pop() || migratedPath;
      store.updateTabPath(tab.id, migratedPath, migratedName);
      migrateEditorCache(tab.path, migratedPath);
    }
  }

  store.bumpFileTreeVersion();
}

/** Delete a file or folder (move to OS trash), cleaning up tabs and caches synchronously */
export async function deleteFile(path: string): Promise<void> {
  // Check for incoming links and warn the user
  if (path.endsWith(".md")) {
    try {
      const linkCount = await invoke<number>("count_incoming_links", { path });
      if (linkCount > 0) {
        const noun = linkCount === 1 ? "note links" : "notes link";
        const confirmed = window.confirm(
          `${linkCount} ${noun} to this file. Delete anyway?`
        );
        if (!confirmed) return;
      }
    } catch {
      // If the query fails, proceed without warning
    }
  }

  await invoke("trash_file", { path });
  // Rust emits fs:change remove — but we clean up tabs synchronously.
  // The event handler in App.tsx will no-op if tabs were already closed.

  const store = useAppStore.getState();
  const allTabs = getAllTabs();
  const prefix = path.endsWith("/") ? path : path + "/";
  const affectedTabs = allTabs.filter(
    (t) => t.path === path || t.path.startsWith(prefix)
  );

  for (const tab of affectedTabs) {
    clearEditorCache(tab.path);
  }
  if (affectedTabs.length > 0) {
    store.removeTabs(affectedTabs.map((t) => t.id));
  }

  store.bumpFileTreeVersion();
  store.bumpBookmarkVersion();
}

/** Create a folder, returning its path */
export async function createFolder(parentPath: string): Promise<string> {
  let folderPath = `${parentPath}/New Folder`;
  let counter = 1;
  while (await invoke<boolean>("path_exists", { path: folderPath })) {
    counter++;
    folderPath = `${parentPath}/New Folder ${counter}`;
  }

  await invoke("create_folder", { path: folderPath });
  useAppStore.getState().bumpFileTreeVersion();
  return folderPath;
}

/**
 * Create a new note in the active tab's directory, or the first registered directory.
 * Used by Cmd+N and the command palette.
 */
export async function createNewNote(): Promise<void> {
  const allTabs = getAllTabs();
  const activeTabId = useAppStore.getState().paneState.panes
    .find((p) => p.id === useAppStore.getState().paneState.activePaneId)?.activeTabId;
  const activeTab = allTabs.find((t) => t.id === activeTabId);
  const dir = activeTab
    ? activeTab.path.replace(/\/[^/]+$/, "")
    : undefined;

  if (!dir) {
    const dirs = await invoke<{ path: string }[]>("get_registered_directories");
    if (dirs.length > 0) {
      await createNote(dirs[0].path);
    }
    return;
  }
  await createNote(dir);
}

/** Reveal a file in the OS file manager */
export async function revealInFinder(path: string): Promise<void> {
  await invoke("reveal_in_finder", { path });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findAvailablePath(dir: string): Promise<{ path: string; name: string }> {
  const baseName = "Untitled";
  let name = `${baseName}.md`;
  let path = `${dir}/${name}`;
  let counter = 1;

  while (await invoke<boolean>("path_exists", { path })) {
    counter++;
    name = `${baseName} ${counter}.md`;
    path = `${dir}/${name}`;
  }

  return { path, name };
}
