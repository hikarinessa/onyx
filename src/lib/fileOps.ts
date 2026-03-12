import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { loadFileIntoCache, migrateEditorCache, clearEditorCache } from "../components/Editor";

/**
 * Centralized file operations module.
 *
 * Every file mutation (create, rename, delete) goes through here.
 * Each function owns the full sequence: disk → DB → tabs → editor caches → tree refresh.
 * Components should call these functions, never invoke Rust commands directly for mutations.
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

/** Rename a file (not a folder), updating all caches */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const newName = newPath.split("/").pop() || newPath;

  await invoke("rename_file", { oldPath, newPath });

  // Update tab if this file is open
  const { tabs, updateTabPath } = useAppStore.getState();
  const openTab = tabs.find((t) => t.path === oldPath);
  if (openTab) {
    updateTabPath(openTab.id, newPath, newName);
    migrateEditorCache(oldPath, newPath);
  }

  useAppStore.getState().bumpFileTreeVersion();
}

/** Rename a folder, updating all affected tabs and caches */
export async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  await invoke("rename_file", { oldPath, newPath });

  // Migrate all tabs whose path starts with the old folder path
  const { tabs, updateTabPath } = useAppStore.getState();
  const oldPrefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
  for (const tab of tabs) {
    if (tab.path.startsWith(oldPrefix)) {
      const migratedPath = newPath + tab.path.slice(oldPath.length);
      const migratedName = migratedPath.split("/").pop() || migratedPath;
      updateTabPath(tab.id, migratedPath, migratedName);
      migrateEditorCache(tab.path, migratedPath);
    }
  }

  useAppStore.getState().bumpFileTreeVersion();
}

/** Delete a file or folder (move to OS trash), cleaning up all caches */
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

  // Find all affected tabs (exact match for files, prefix match for folders)
  const { tabs } = useAppStore.getState();
  const prefix = path.endsWith("/") ? path : path + "/";
  const affectedTabs = tabs.filter(
    (t) => t.path === path || t.path.startsWith(prefix)
  );

  for (const tab of affectedTabs) {
    clearEditorCache(tab.path);
  }

  if (affectedTabs.length > 0) {
    useAppStore.getState().removeTabs(affectedTabs.map((t) => t.id));
  }

  useAppStore.getState().bumpFileTreeVersion();
  useAppStore.getState().bumpBookmarkVersion();
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
  const { tabs, activeTabId } = useAppStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
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
