/**
 * Content of the notes shown on note cards, read once per note and refreshed when the
 * file changes on disk, so every card showing a note updates together.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { extractSection } from "../sections";

export interface NoteContent {
  status: "loading" | "ready" | "missing";
  /** Absolute path of the note, once resolved */
  path: string | null;
  /** The note, or the section the card's subpath names */
  text: string;
  error?: string;
}

interface Entry { value: NoteContent; listeners: Set<() => void>; file: string; subpath: string | null; context: string }

const entries = new Map<string, Entry>();
let listening = false;

function listenForChanges() {
  if (listening) return;
  listening = true;
  listen<{ path: string; old_path?: string }[]>("fs:change", (event) => {
    const changed = new Set(event.payload.flatMap((c) => [c.path, c.old_path].filter(Boolean) as string[]));
    for (const e of entries.values()) {
      if (e.value.path && changed.has(e.value.path)) void fetchEntry(e);
      else if (e.value.status === "missing") void fetchEntry(e);
    }
  });
}

async function fetchEntry(e: Entry): Promise<void> {
  // File-node paths are relative to the canvas's root (as Obsidian writes them); the
  // link resolver takes the same folder/name form without the extension.
  const link = e.file.replace(/\.md$/i, "");
  let value: NoteContent;
  try {
    const path = await invoke<string | null>("resolve_wikilink", { link, contextPath: e.context });
    if (!path) {
      value = { status: "missing", path: null, text: "", error: "Note not found" };
    } else {
      const whole = await invoke<string>("read_file", { path });
      const text = e.subpath ? extractSection(whole, e.subpath) : whole;
      value = text === null
        ? { status: "missing", path, text: "", error: `Section not found: ${e.subpath}` }
        : { status: "ready", path, text };
    }
  } catch (err) {
    value = { status: "missing", path: null, text: "", error: String(err) };
  }
  const prev = e.value;
  if (prev.status === value.status && prev.path === value.path && prev.text === value.text) return;
  e.value = value;
  for (const l of e.listeners) l();
}

const LOADING: NoteContent = { status: "loading", path: null, text: "" };

/** The note a card shows. `file` is the node's path, `context` the canvas's path. */
export function useNoteContent(file: string, subpath: string | null, context: string): NoteContent {
  const key = `${context}\u0000${file}\u0000${subpath ?? ""}`;
  let e = entries.get(key);
  if (!e) {
    e = { value: LOADING, listeners: new Set(), file, subpath: subpath?.replace(/^#/, "") || null, context };
    entries.set(key, e);
    listenForChanges();
    void fetchEntry(e);
  }
  const entry = e;
  return useSyncExternalStore(
    (l) => {
      entry.listeners.add(l);
      return () => {
        entry.listeners.delete(l);
        if (!entry.listeners.size) setTimeout(() => { if (!entry.listeners.size) entries.delete(key); }, 30_000);
      };
    },
    () => entry.value,
  );
}
