import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { openFileInEditor } from "./openFile";
import { loadFileIntoCache } from "./editorBridge";

interface CreatePeriodicNoteResult {
  path: string;
  created: boolean;
  cursor_offset: number | null;
}

export async function createOrOpenPeriodicNote(
  periodType: "daily" | "weekly" | "monthly",
  date: string,
): Promise<void> {
  const result = await invoke<CreatePeriodicNoteResult>(
    "create_periodic_note",
    { periodType, date },
  );

  const name = result.path.split("/").pop() || result.path;

  if (result.created) {
    const content = await invoke<string>("read_file", { path: result.path });
    loadFileIntoCache(result.path, content);
    useAppStore.getState().openFile(result.path, name);
    useAppStore.getState().bumpFileTreeVersion();
  } else {
    await openFileInEditor(result.path, name);
  }
}
