import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { loadFileIntoCache } from "../components/Editor";

/**
 * Centralized file operations module.
 *
 * Every file mutation (create, rename, delete) goes through here.
 * Rust commands emit fs:change events; UI consumers react via event listeners.
 * fileOps only handles the IPC call + any pre-mutation work (e.g. confirmation dialogs).
 */

/** Create a new note in a directory, open it, and return its path */
export async function createNote(dirPath: string): Promise<string> {
  const { path, name } = await findAvailablePath(dirPath);
  await invoke("write_file", { path, content: "" });
  // Pre-load cache so the editor has content immediately when the tab opens.
  // write_file doesn't emit fs:change for internal writes (self-write suppressed),
  // so we handle the tab open here — this is a create-and-open flow, not a mutation.
  loadFileIntoCache(path, "");
  useAppStore.getState().openFile(path, name);
  useAppStore.getState().bumpFileTreeVersion();
  return path;
}

/** Rename a file (not a folder). Rust emits fs:change rename; UI reacts via event listeners. */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  await invoke("rename_file", { oldPath, newPath });
  // fs:change { kind: "rename", path: newPath, old_path: oldPath } emitted by Rust
}

/** Rename a folder. Rust emits fs:change rename; UI reacts via event listeners. */
export async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  await invoke("rename_file", { oldPath, newPath });
  // fs:change { kind: "rename", path: newPath, old_path: oldPath } emitted by Rust
}

/** Delete a file or folder (move to OS trash). Rust emits fs:change remove. */
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
  // fs:change { kind: "remove", path } emitted by Rust
  // Tab cleanup, tree refresh, bookmark invalidation all handled by event listeners
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
