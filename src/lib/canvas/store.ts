/**
 * Open canvases: one document per path, its undo history, and its save state.
 *
 * The document is the file's content as a value; every change is a whole new value
 * (`commit`), so history is a list of previous values and saving is serialise-and-write.
 * Tab ids are paths, so `modified` on the tab is keyed by the canvas path.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../stores/app";
import { saveFile } from "../saveFile";
import { getAutoSaveMs } from "../configBridge";
import { parseCanvas, serializeCanvas, type CanvasDoc } from "./model";
import type { Viewport } from "./geometry";

const HISTORY_LIMIT = 200;

interface Entry {
  doc: CanvasDoc | null;
  error: string | null;
  /** Serialised content last read from or written to disk */
  lastSaved: string;
  past: CanvasDoc[];
  future: CanvasDoc[];
  /** Changes with the same key within COALESCE_MS extend one history step (typing, nudging) */
  coalesce: { key: string; at: number } | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
}

const COALESCE_MS = 800;
const entries = new Map<string, Entry>();

function entryFor(path: string): Entry {
  let e = entries.get(path);
  if (!e) {
    e = { doc: null, error: null, lastSaved: "", past: [], future: [], coalesce: null, saveTimer: null, listeners: new Set() };
    entries.set(path, e);
  }
  return e;
}

function notify(e: Entry) {
  for (const l of e.listeners) l();
}

/** Read a canvas from disk into the store (once per open; later reads come from fs:change). */
export async function loadCanvas(path: string): Promise<void> {
  const e = entryFor(path);
  try {
    const text = await invoke<string>("read_file", { path });
    e.doc = parseCanvas(text);
    e.lastSaved = text;
    e.error = null;
  } catch (err) {
    e.doc = null;
    e.error = String(err);
  }
  notify(e);
}

export function useCanvas(path: string): { doc: CanvasDoc | null; error: string | null } {
  const e = entryFor(path);
  const doc = useSyncExternalStore(
    (l) => { e.listeners.add(l); return () => e.listeners.delete(l); },
    () => e.doc,
  );
  return { doc, error: e.error };
}

export function getCanvasDoc(path: string): CanvasDoc | null {
  return entries.get(path)?.doc ?? null;
}

/**
 * Replace the document. `history: false` changes it without an undo step (a drag in
 * progress; the step is taken when the drag starts). `coalesce` merges a run of changes
 * with the same key into one step.
 */
export function commit(path: string, next: CanvasDoc, opts: { history?: boolean; coalesce?: string } = {}): void {
  const e = entries.get(path);
  if (!e?.doc || next === e.doc) return;
  if (opts.history !== false) {
    const now = Date.now();
    const merge = opts.coalesce && e.coalesce?.key === opts.coalesce && now - e.coalesce.at < COALESCE_MS;
    if (!merge) {
      e.past.push(e.doc);
      if (e.past.length > HISTORY_LIMIT) e.past.shift();
    }
    e.coalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
    e.future = [];
  }
  e.doc = next;
  notify(e);
  scheduleSave(path, e);
}

/** Take an undo step now, for a change that will arrive as several `history: false` commits. */
export function checkpoint(path: string): void {
  const e = entries.get(path);
  if (!e?.doc) return;
  e.past.push(e.doc);
  if (e.past.length > HISTORY_LIMIT) e.past.shift();
  e.future = [];
  e.coalesce = null;
}

export function undo(path: string): void {
  const e = entries.get(path);
  if (!e?.doc || !e.past.length) return;
  e.future.push(e.doc);
  e.doc = e.past.pop()!;
  e.coalesce = null;
  notify(e);
  scheduleSave(path, e);
}

export function redo(path: string): void {
  const e = entries.get(path);
  if (!e?.doc || !e.future.length) return;
  e.past.push(e.doc);
  e.doc = e.future.pop()!;
  e.coalesce = null;
  notify(e);
  scheduleSave(path, e);
}

function scheduleSave(path: string, e: Entry) {
  const dirty = !!e.doc && serializeCanvas(e.doc) !== e.lastSaved;
  useAppStore.getState().setModified(path, dirty);
  if (e.saveTimer) clearTimeout(e.saveTimer);
  e.saveTimer = dirty ? setTimeout(() => { void flushCanvasSave(path); }, getAutoSaveMs()) : null;
}

/** Write pending changes now (tab close, app quit). */
export async function flushCanvasSave(path: string): Promise<void> {
  const e = entries.get(path);
  if (!e?.doc) return;
  if (e.saveTimer) { clearTimeout(e.saveTimer); e.saveTimer = null; }
  const text = serializeCanvas(e.doc);
  if (text === e.lastSaved) return;
  if (await saveFile(path, text) === "saved") {
    e.lastSaved = text;
    // Edits made while the write was in flight stay modified and schedule their own save
    if (e.doc && serializeCanvas(e.doc) === text) useAppStore.getState().setModified(path, false);
  }
}

/**
 * The file changed on disk. Our own writes come back here too and match `lastSaved`.
 * A board without unsaved changes takes the new content as an undoable step; one with
 * unsaved changes keeps them and raises the conflict prompt, as a note does.
 */
export function canvasChangedOnDisk(path: string, text: string): void {
  const e = entries.get(path);
  if (!e?.doc || text === e.lastSaved) return;
  if (serializeCanvas(e.doc) !== e.lastSaved) {
    useAppStore.getState().setSaveConflictPath(path);
    return;
  }
  try {
    const next = parseCanvas(text);
    e.past.push(e.doc);
    e.future = [];
    e.doc = next;
    e.lastSaved = text;
    notify(e);
  } catch {
    // A half-written file from another app: wait for its next write
  }
}

/** Reload from disk, discarding unsaved changes (the conflict prompt's "reload"). */
export async function reloadCanvas(path: string): Promise<void> {
  const e = entries.get(path);
  if (e?.saveTimer) clearTimeout(e.saveTimer);
  await loadCanvas(path);
  useAppStore.getState().setModified(path, false);
}

export function migrateCanvas(oldPath: string, newPath: string): void {
  const e = entries.get(oldPath);
  if (!e) return;
  entries.delete(oldPath);
  entries.set(newPath, e);
  const vp = viewports.get(oldPath);
  if (vp) { viewports.delete(oldPath); viewports.set(newPath, vp); }
}

/** Forget canvases no longer open in any tab. */
export function dropClosedCanvases(openPaths: Set<string>): void {
  for (const [path, e] of entries) {
    if (openPaths.has(path) || e.listeners.size) continue;
    if (e.saveTimer) continue; // still owes a write; flushed on close
    entries.delete(path);
  }
}

// ── Per-machine view state (kept in the session, never in the file) ──

const viewports = new Map<string, Viewport>();

export function getViewport(path: string): Viewport | undefined {
  return viewports.get(path);
}

export function setViewport(path: string, vp: Viewport): void {
  viewports.set(path, vp);
}

export function allViewports(): Record<string, Viewport> {
  return Object.fromEntries(viewports);
}

export function restoreViewports(saved: Record<string, Viewport> | undefined): void {
  if (!saved) return;
  for (const [path, vp] of Object.entries(saved)) {
    if (vp && [vp.x, vp.y, vp.z].every(Number.isFinite)) viewports.set(path, vp);
  }
}

// ── Focus requests (a search result asks the board to centre one item) ──

const focusRequests = new Map<string, string>();
const focusListeners = new Set<() => void>();

export function requestCanvasFocus(path: string, itemId: string): void {
  focusRequests.set(path, itemId);
  for (const l of focusListeners) l();
}

export function takeCanvasFocus(path: string): string | undefined {
  const id = focusRequests.get(path);
  focusRequests.delete(path);
  return id;
}

export function onCanvasFocusRequest(listener: () => void): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}
