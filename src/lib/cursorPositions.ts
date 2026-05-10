import { invoke } from "@tauri-apps/api/core";

/**
 * Per-file cursor and scroll persistence across tab close + app restart.
 * Within-session tab switching is already covered by editorStateCache;
 * this layer survives close/relaunch by mirroring the data to ~/.onyx/cursor-positions.json.
 */

export interface CursorPosition {
  head: number;
  anchor: number;
  scrollTop: number;
  ts: number;
}

const MAX_ENTRIES = 500;
const FLUSH_DEBOUNCE_MS = 2000;

let positions: Map<string, CursorPosition> = new Map();
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/** Load persisted positions from disk — call once at app start. */
export async function loadCursorPositions(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await invoke<string | null>("read_cursor_positions");
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CursorPosition>;
    positions = new Map(Object.entries(parsed));
  } catch (err) {
    console.error("Failed to load cursor positions:", err);
  }
}

export function getCursorPosition(path: string): CursorPosition | null {
  return positions.get(path) ?? null;
}

export function setCursorPosition(
  path: string,
  head: number,
  anchor: number,
  scrollTop: number,
): void {
  positions.set(path, { head, anchor, scrollTop, ts: Date.now() });
  dirty = true;
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushCursorPositions();
  }, FLUSH_DEBOUNCE_MS);
}

/** Write to disk now. Trims to MAX_ENTRIES (LRU by ts) before writing. */
export async function flushCursorPositions(): Promise<void> {
  if (!dirty) return;
  dirty = false;

  if (positions.size > MAX_ENTRIES) {
    const sorted = [...positions.entries()].sort((a, b) => b[1].ts - a[1].ts);
    positions = new Map(sorted.slice(0, MAX_ENTRIES));
  }

  const obj: Record<string, CursorPosition> = {};
  for (const [path, pos] of positions) obj[path] = pos;

  try {
    await invoke("write_cursor_positions", { json: JSON.stringify(obj) });
  } catch (err) {
    console.error("Failed to flush cursor positions:", err);
  }
}
