import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectAllTabs, type Tab } from "../stores/app";
import { EMPTY_CANVAS } from "./canvas/model";
import { loadCanvas, migrateCanvas } from "./canvas/store";
import { loadFileIntoCache, migrateEditorCache, clearEditorCache, snapshotEditor, flushSaveForTab } from "../components/Editor";
import { openFileInEditor } from "./openFile";

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
  let content = "";
  let cursorOffset: number | null = null;
  try {
    const resolved = await invoke<{ content: string; cursor_offset: number | null }>(
      "resolve_new_file_content",
      { path },
    );
    content = resolved.content;
    cursorOffset = resolved.cursor_offset;
  } catch (e) {
    console.warn("Folder-rule resolution failed; creating empty file:", e);
  }
  await invoke("create_file", { path, content });
  loadFileIntoCache(path, content, cursorOffset);
  useAppStore.getState().openFile(path, name);
  useAppStore.getState().bumpFileTreeVersion();
  return path;
}

/** Create an empty canvas in a directory, open it, and return its path */
export async function createCanvas(dirPath: string): Promise<string> {
  const { path, name } = await findAvailablePath(dirPath, "canvas");
  await invoke("create_file", { path, content: EMPTY_CANVAS });
  await loadCanvas(path);
  useAppStore.getState().openFile(path, name);
  useAppStore.getState().bumpFileTreeVersion();
  return path;
}

/** Create a canvas beside the active tab's file, or in the first registered directory. */
export async function createNewCanvas(): Promise<void> {
  const activeTabId = useAppStore.getState().paneState.panes
    .find((p) => p.id === useAppStore.getState().paneState.activePaneId)?.activeTabId;
  const activeTab = getAllTabs().find((t) => t.id === activeTabId);
  try {
    let dir = activeTab?.path.replace(/\/[^/]+$/, "");
    if (!dir) dir = (await invoke<{ path: string }[]>("get_registered_directories"))[0]?.path;
    if (dir) await createCanvas(dir);
  } catch (err) {
    reportFailure("Could not create canvas", err);
  }
}

/**
 * Create a note with the given content at the first available path derived
 * from `baseName` in `dirPath`. Does not open the note in a tab.
 * Used by block-extract. Returns the created path.
 */
export async function createNoteWithContent(
  dirPath: string,
  baseName: string,
  content: string,
): Promise<string> {
  let path = `${dirPath}/${baseName}.md`;
  let counter = 1;
  while (await invoke<boolean>("path_exists", { path })) {
    path = `${dirPath}/${baseName} ${counter}.md`;
    counter++;
  }
  await invoke("create_file", { path, content });
  await invoke("reindex_file", { path });
  useAppStore.getState().bumpFileTreeVersion();
  return path;
}

/**
 * Duplicate a note as a sibling named `<stem> copy.md` (then `<stem> copy 2.md`, …),
 * open the copy in a new tab, and return its path. Pending edits in an open tab
 * are flushed first so the copy matches what is on screen.
 */
export async function duplicateNote(path: string): Promise<string> {
  const openTab = getAllTabs().find((t) => t.path === path);
  if (openTab) {
    snapshotEditor(openTab.id);
    await flushSaveForTab(openTab.id);
  }

  const dir = path.replace(/\/[^/]+$/, "");
  const stem = (path.split("/").pop() || path).replace(/\.md$/, "");
  let name = `${stem} copy.md`;
  let dest = `${dir}/${name}`;
  let counter = 1;
  while (await invoke<boolean>("path_exists", { path: dest })) {
    counter++;
    name = `${stem} copy ${counter}.md`;
    dest = `${dir}/${name}`;
  }

  await invoke("copy_file", { source: path, dest });
  useAppStore.getState().bumpFileTreeVersion();
  await openFileInEditor(dest, name, { replaceActive: false });
  return dest;
}

/** Rename a file (not a folder), updating tabs and caches synchronously */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const newName = newPath.split("/").pop() || newPath;

  // Snapshot and save before the rename, not after: Rust emits the fs:change rename
  // before the command returns, so App.tsx's handler can re-key the cache while this
  // await is still pending. A snapshot taken afterwards finds the tab already moved and
  // the handler has carried the stale cached state (empty, for a new note) to the new
  // path. The flush keeps unsaved edits, since the handler also cancels pending saves.
  const before = getAllTabs().find((t) => t.path === oldPath);
  if (before) {
    snapshotEditor(before.id);
    await flushSaveForTab(before.id);
  }

  await invoke("rename_file", { oldPath, newPath });
  // Rust emits fs:change rename — but we update the tab synchronously for responsiveness.
  // Whichever of this and the event handler in App.tsx runs second is a no-op.

  const store = useAppStore.getState();
  const openTab = getAllTabs().find((t) => t.path === oldPath);
  if (openTab) {
    store.updateTabPath(openTab.id, newPath, newName);
    migrateEditorCache(oldPath, newPath);
    migrateCanvas(oldPath, newPath);
  }

  // Clear any stale deleted marker for the old path
  store.removeDeletedPath(oldPath);
  store.bumpFileTreeVersion();
}

/** Rename a folder, updating all affected tabs and caches synchronously */
export async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  const oldPrefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
  // Snapshot and save before the rename, for the reason given in renameFile.
  for (const tab of getAllTabs()) {
    if (tab.path.startsWith(oldPrefix)) {
      snapshotEditor(tab.id);
      await flushSaveForTab(tab.id);
    }
  }

  await invoke("rename_file", { oldPath, newPath });

  const store = useAppStore.getState();
  for (const tab of getAllTabs()) {
    if (tab.path.startsWith(oldPrefix)) {
      const migratedPath = newPath + tab.path.slice(oldPath.length);
      const migratedName = migratedPath.split("/").pop() || migratedPath;
      store.updateTabPath(tab.id, migratedPath, migratedName);
      migrateEditorCache(tab.path, migratedPath);
      migrateCanvas(tab.path, migratedPath);
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
 * Used by Cmd+N, the File menu and the command palette. A failure is shown as a
 * status notice rather than thrown, since none of those callers has a UI of its own.
 */
export async function createNewNote(): Promise<void> {
  const allTabs = getAllTabs();
  const activeTabId = useAppStore.getState().paneState.panes
    .find((p) => p.id === useAppStore.getState().paneState.activePaneId)?.activeTabId;
  const activeTab = allTabs.find((t) => t.id === activeTabId);
  const dir = activeTab
    ? activeTab.path.replace(/\/[^/]+$/, "")
    : undefined;

  try {
    if (!dir) {
      const dirs = await invoke<{ path: string }[]>("get_registered_directories");
      if (dirs.length > 0) {
        await createNote(dirs[0].path);
      }
      return;
    }
    await createNote(dir);
  } catch (err) {
    reportFailure("Could not create note", err);
  }
}

/** Log a failed file operation and show it in the status bar */
export function reportFailure(action: string, err: unknown): void {
  console.error(`${action}:`, err);
  useAppStore.getState().setStatusNotice(`${action}: ${String(err)}`);
}

/** Reveal a file in the OS file manager */
export async function revealInFinder(path: string): Promise<void> {
  await invoke("reveal_in_finder", { path });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findAvailablePath(dir: string, ext = "md"): Promise<{ path: string; name: string }> {
  const baseName = "Untitled";
  let name = `${baseName}.${ext}`;
  let path = `${dir}/${name}`;
  let counter = 1;

  while (await invoke<boolean>("path_exists", { path })) {
    counter++;
    name = `${baseName} ${counter}.${ext}`;
    path = `${dir}/${name}`;
  }

  return { path, name };
}
