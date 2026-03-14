/**
 * Pane state model for split panes.
 *
 * Array-based: supports 1–3 panes. Each pane has its own tab list,
 * active tab, and nav stacks. EditorState caches remain shared
 * (keyed by tab path) in Editor.tsx module-level maps.
 *
 * This file defines types only. State lives in app.ts.
 */

import type { Tab, EditorMode, NavEntry } from "./app";

export interface Pane {
  id: string;       // "pane-0", "pane-1", "pane-2"
  tabs: Tab[];
  activeTabId: string | null;
}

export interface PaneState {
  panes: Pane[];
  activePaneId: string;
  splitRatios: number[];  // [0.5] for 2 panes, [0.33, 0.66] for 3, [] for 1
  scrollLockAnchors: Map<string, number> | null;  // paneId → scrollTop at lock time, null = unlocked
}

export const MAX_PANES = 3;

export function createPane(id: string): Pane {
  return { id, tabs: [], activeTabId: null };
}

/** Default single-pane state */
export function defaultPaneState(): PaneState {
  return {
    panes: [createPane("pane-0")],
    activePaneId: "pane-0",
    splitRatios: [],
    scrollLockAnchors: null,
  };
}
