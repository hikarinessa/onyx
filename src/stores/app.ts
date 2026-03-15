import { create } from "zustand";
import { type Pane, type PaneState, MAX_PANES, createPane, defaultPaneState } from "./panes";

export type EditorMode = "source" | "preview";

export interface LintIssue {
  id: string;
  from: number;
  to: number;
  line: number;
  col: number;
  message: string;
  severity: "error" | "warning";
  fixable: boolean;
}

export interface NavEntry {
  path: string;
  cursor: number;
}

export interface Tab {
  id: string;
  path: string;
  name: string;
  modified: boolean;
  editorMode: EditorMode;
  navBack: NavEntry[];
  navForward: NavEntry[];
}

/** null = use smart default, non-null = user override */
export interface AccordionState {
  properties: boolean | null;
  backlinks: boolean | null;
  recent: boolean | null;
  outline: boolean | null;
}

// Injected by Editor.tsx to avoid circular imports
let flushSaveHook: ((id: string) => Promise<void>) | null = null;
export function setFlushSaveHook(fn: (id: string) => Promise<void>) {
  flushSaveHook = fn;
}

// Injected by Editor.tsx — snapshots live CM6 content into the cache
let snapshotEditorHook: ((id: string) => void) | null = null;
export function setSnapshotEditorHook(fn: (id: string) => void) {
  snapshotEditorHook = fn;
}

// ── Helper: find pane containing a tab ──

function findPaneWithTab(panes: Pane[], tabId: string): Pane | undefined {
  return panes.find((p) => p.tabs.some((t) => t.id === tabId));
}

function updatePane(panes: Pane[], paneId: string, updater: (p: Pane) => Pane): Pane[] {
  return panes.map((p) => (p.id === paneId ? updater(p) : p));
}

function activePane(state: { paneState: PaneState }): Pane {
  return state.paneState.panes.find((p) => p.id === state.paneState.activePaneId)
    || state.paneState.panes[0];
}

interface AppState {
  // Sidebar
  sidebarVisible: boolean;
  toggleSidebar: () => void;

  // Context panel
  contextPanelVisible: boolean;
  toggleContextPanel: () => void;

  // ── Pane state ──
  paneState: PaneState;

  // Pane operations
  splitPane: () => void;
  closePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  setSplitRatios: (ratios: number[]) => void;
  lockScroll: () => void;
  unlockScroll: () => void;
  setScrollLockAnchors: (anchors: Map<string, number> | null) => void;

  // ── Compat getters (derived from active pane) ──
  // These allow existing components to keep reading tabs/activeTabId
  // without being pane-aware. They operate on the active pane.
  get tabs(): Tab[];
  get activeTabId(): string | null;

  // Tab operations (operate on specified pane, or active pane by default)
  moveTabToPane: (tabId: string, targetPaneId: string) => void;
  openFile: (path: string, name: string, opts?: { paneId?: string }) => void;
  replaceActiveTab: (path: string, name: string, opts?: { paneId?: string }) => void;
  closeTab: (id: string) => Promise<void>;
  removeTabs: (ids: string[]) => void;
  setActiveTab: (id: string) => void;
  setModified: (id: string, modified: boolean) => void;
  updateTabPath: (id: string, newPath: string, newName: string) => void;
  toggleEditorMode: (id: string) => void;
  pushNav: (tabId: string, entry: NavEntry) => void;
  navigateBack: (tabId: string) => NavEntry | null;
  navigateForward: (tabId: string) => NavEntry | null;

  // Status bar
  cursorLine: number;
  cursorCol: number;
  wordCount: number;
  charCount: number;
  setCursorInfo: (line: number, col: number) => void;
  setWordCount: (count: number) => void;
  setCharCount: (count: number) => void;

  // Tab reorder
  reorderTabs: (fromIndex: number, toIndex: number, paneId?: string) => void;

  // Collapsed root directories (by dir ID) + expanded subdirectories (by path)
  collapsedDirs: string[];
  toggleDirCollapsed: (dirId: string) => void;
  expandedSubdirs: string[];
  toggleSubdirExpanded: (path: string) => void;

  // Quick open
  quickOpenVisible: boolean;
  quickOpenMode: "open" | "insert-wikilink";
  setQuickOpenVisible: (v: boolean) => void;
  setQuickOpenMode: (mode: "open" | "insert-wikilink") => void;

  // Command palette
  commandPaletteVisible: boolean;
  setCommandPaletteVisible: (v: boolean) => void;

  // Settings
  settingsVisible: boolean;
  setSettingsVisible: (v: boolean) => void;

  // Bookmark refresh signal
  bookmarkVersion: number;
  bumpBookmarkVersion: () => void;

  // File tree refresh signal
  fileTreeVersion: number;
  bumpFileTreeVersion: () => void;

  // Accordion state for context panel sections
  accordionState: AccordionState;
  setAccordionExpanded: (section: keyof AccordionState, expanded: boolean | null) => void;

  // Save version
  saveVersion: number;
  bumpSaveVersion: () => void;

  // Orphan notes
  orphanPaths: string[];
  orphanIcon: string;
  addOrphanPath: (path: string) => void;
  removeOrphanPath: (path: string) => void;
  setOrphanIcon: (icon: string) => void;

  // Save conflict
  saveConflictPath: string | null;
  setSaveConflictPath: (path: string | null) => void;

  // Paths deleted externally — auto-save guard checks this before writing
  deletedPaths: Set<string>;
  addDeletedPath: (path: string) => void;
  removeDeletedPath: (path: string) => void;

  // Sidebar tabs
  sidebarTab: "files" | "search";
  setSidebarTab: (tab: "files" | "search") => void;

  // Lint
  lintErrors: number;
  lintWarnings: number;
  lintDiagnostics: LintIssue[];
  lintPanelVisible: boolean;
  setLintCounts: (errors: number, warnings: number) => void;
  setLintDiagnostics: (diagnostics: LintIssue[]) => void;
  toggleLintPanel: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  contextPanelVisible: false,
  toggleContextPanel: () =>
    set((s) => ({ contextPanelVisible: !s.contextPanelVisible })),

  // ── Pane state ──
  paneState: defaultPaneState(),

  splitPane: () => {
    const { paneState } = get();
    if (paneState.panes.length >= MAX_PANES) return;
    const newId = `pane-${paneState.panes.length}`;
    const newPane = createPane(newId);
    const count = paneState.panes.length + 1;
    // Distribute evenly: for N panes, N-1 ratios at 1/N, 2/N, ...
    const ratios: number[] = [];
    for (let i = 1; i < count; i++) ratios.push(i / count);
    set({
      paneState: {
        ...paneState,
        panes: [...paneState.panes, newPane],
        splitRatios: ratios,
      },
    });
  },

  closePane: (paneId) => {
    const { paneState } = get();
    if (paneState.panes.length <= 1) return;
    const closing = paneState.panes.find((p) => p.id === paneId);
    const remaining = paneState.panes.filter((p) => p.id !== paneId);
    // Move orphan tabs from closing pane to the first remaining pane
    if (closing && closing.tabs.length > 0) {
      remaining[0] = {
        ...remaining[0],
        tabs: [...remaining[0].tabs, ...closing.tabs],
      };
    }
    const count = remaining.length;
    const ratios: number[] = [];
    for (let i = 1; i < count; i++) ratios.push(i / count);
    const newActivePaneId = remaining.some((p) => p.id === paneState.activePaneId)
      ? paneState.activePaneId
      : remaining[0].id;
    set({
      paneState: {
        ...paneState,
        panes: remaining,
        activePaneId: newActivePaneId,
        splitRatios: ratios,
        scrollLockAnchors: null,
      },
    });
  },

  setActivePane: (paneId) => {
    set((s) => ({
      paneState: { ...s.paneState, activePaneId: paneId },
    }));
  },

  setSplitRatios: (ratios) => {
    set((s) => ({
      paneState: { ...s.paneState, splitRatios: ratios },
    }));
  },

  lockScroll: () => {
    // Anchors are set externally by the EditorPane components which know scrollTop
    // This just signals the intent; actual anchors set via setScrollLockAnchors
  },

  unlockScroll: () => {
    set((s) => ({
      paneState: { ...s.paneState, scrollLockAnchors: null },
    }));
  },

  setScrollLockAnchors: (anchors) => {
    set((s) => ({
      paneState: { ...s.paneState, scrollLockAnchors: anchors },
    }));
  },

  // ── Compat getters ──
  get tabs() {
    return activePane(get()).tabs;
  },
  get activeTabId() {
    return activePane(get()).activeTabId;
  },

  // ── Tab operations ──

  moveTabToPane: (tabId, targetPaneId) => {
    const { paneState } = get();
    const sourcePane = findPaneWithTab(paneState.panes, tabId);
    if (!sourcePane || sourcePane.id === targetPaneId) return;
    const targetPane = paneState.panes.find((p) => p.id === targetPaneId);
    if (!targetPane) return;

    const tab = sourcePane.tabs.find((t) => t.id === tabId)!;
    const sourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
    const sourceActive = sourcePane.activeTabId === tabId
      ? (sourceTabs.length > 0 ? sourceTabs[Math.max(0, sourceTabs.length - 1)].id : null)
      : sourcePane.activeTabId;

    let newPanes = paneState.panes.map((p) => {
      if (p.id === sourcePane.id) return { ...p, tabs: sourceTabs, activeTabId: sourceActive };
      if (p.id === targetPaneId) return { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id };
      return p;
    });

    // Collapse empty source pane if multiple panes remain
    if (sourceTabs.length === 0 && newPanes.length > 1) {
      newPanes = newPanes.filter((p) => p.id !== sourcePane.id);
    }
    const count = newPanes.length;
    const ratios: number[] = [];
    for (let i = 1; i < count; i++) ratios.push(i / count);

    set({
      paneState: {
        ...paneState,
        panes: newPanes,
        activePaneId: targetPaneId,
        splitRatios: newPanes.length !== paneState.panes.length ? ratios : paneState.splitRatios,
      },
    });
  },

  openFile: (path, name, opts) => {
    const { paneState } = get();
    const paneId = opts?.paneId || paneState.activePaneId;

    // Check if already open in any pane — focus it
    for (const p of paneState.panes) {
      const existing = p.tabs.find((t) => t.path === path);
      if (existing) {
        set({
          paneState: {
            ...paneState,
            activePaneId: p.id,
            panes: updatePane(paneState.panes, p.id, (pane) => ({
              ...pane,
              activeTabId: existing.id,
            })),
          },
        });
        return;
      }
    }

    const id = path;
    const tab: Tab = { id, path, name, modified: false, editorMode: "preview", navBack: [], navForward: [] };
    set({
      paneState: {
        ...paneState,
        activePaneId: paneId,
        panes: updatePane(paneState.panes, paneId, (pane) => ({
          ...pane,
          tabs: [...pane.tabs, tab],
          activeTabId: id,
        })),
      },
    });
  },

  replaceActiveTab: (path, name, opts) => {
    const { paneState } = get();
    const paneId = opts?.paneId || paneState.activePaneId;
    const pane = paneState.panes.find((p) => p.id === paneId);
    if (!pane || !pane.activeTabId) return;

    const oldTab = pane.tabs.find((t) => t.id === pane.activeTabId);
    const id = path;
    const newTab: Tab = {
      id, path, name, modified: false,
      editorMode: oldTab?.editorMode ?? "preview",
      navBack: oldTab?.navBack ?? [],
      navForward: oldTab?.navForward ?? [],
    };
    set({
      paneState: {
        ...paneState,
        panes: updatePane(paneState.panes, paneId, (p) => ({
          ...p,
          tabs: p.tabs.map((t) => (t.id === p.activeTabId ? newTab : t)),
          activeTabId: id,
        })),
      },
    });
  },

  closeTab: async (id) => {
    if (snapshotEditorHook) snapshotEditorHook(id);
    if (flushSaveHook) await flushSaveHook(id);

    const { paneState } = get();
    const pane = findPaneWithTab(paneState.panes, id);
    if (!pane) return;

    const idx = pane.tabs.findIndex((t) => t.id === id);
    const newTabs = pane.tabs.filter((t) => t.id !== id);

    let newActive = pane.activeTabId;
    if (pane.activeTabId === id) {
      if (newTabs.length === 0) {
        newActive = null;
      } else if (idx >= newTabs.length) {
        newActive = newTabs[newTabs.length - 1].id;
      } else {
        newActive = newTabs[idx].id;
      }
    }

    let newPanes = updatePane(paneState.panes, pane.id, (p) => ({
      ...p,
      tabs: newTabs,
      activeTabId: newActive,
    }));

    // If pane is now empty and there are other panes, close it
    if (newTabs.length === 0 && newPanes.length > 1) {
      newPanes = newPanes.filter((p) => p.id !== pane.id);
      const count = newPanes.length;
      const ratios: number[] = [];
      for (let i = 1; i < count; i++) ratios.push(i / count);
      set({
        paneState: {
          ...paneState,
          panes: newPanes,
          activePaneId: newPanes.some((p) => p.id === paneState.activePaneId)
            ? paneState.activePaneId : newPanes[0].id,
          splitRatios: ratios,
          scrollLockAnchors: null,
        },
      });
    } else {
      set({
        paneState: { ...paneState, panes: newPanes },
      });
    }
  },

  removeTabs: (ids) => {
    const idSet = new Set(ids);
    const { paneState } = get();
    let newPanes = paneState.panes.map((pane) => {
      const newTabs = pane.tabs.filter((t) => !idSet.has(t.id));
      let newActive = pane.activeTabId;
      if (newActive && idSet.has(newActive)) {
        if (newTabs.length === 0) {
          newActive = null;
        } else {
          const firstIdx = pane.tabs.findIndex((t) => idSet.has(t.id));
          newActive = newTabs[Math.min(firstIdx, newTabs.length - 1)].id;
        }
      }
      return { ...pane, tabs: newTabs, activeTabId: newActive };
    });

    // Collapse empty panes (keep at least one)
    if (newPanes.length > 1) {
      const nonEmpty = newPanes.filter((p) => p.tabs.length > 0);
      if (nonEmpty.length > 0) newPanes = nonEmpty;
      else newPanes = [newPanes[0]];
    }
    const count = newPanes.length;
    const ratios: number[] = [];
    for (let i = 1; i < count; i++) ratios.push(i / count);
    set({
      paneState: {
        ...paneState,
        panes: newPanes,
        activePaneId: newPanes.some((p) => p.id === paneState.activePaneId)
          ? paneState.activePaneId : newPanes[0].id,
        splitRatios: ratios,
      },
    });
  },

  setActiveTab: (id) => {
    const { paneState } = get();
    const pane = findPaneWithTab(paneState.panes, id);
    if (!pane) return;
    set({
      paneState: {
        ...paneState,
        activePaneId: pane.id,
        panes: updatePane(paneState.panes, pane.id, (p) => ({
          ...p,
          activeTabId: id,
        })),
      },
    });
  },

  setModified: (id, modified) => {
    const { paneState } = get();
    set({
      paneState: {
        ...paneState,
        panes: paneState.panes.map((pane) => ({
          ...pane,
          tabs: pane.tabs.map((t) => (t.id === id ? { ...t, modified } : t)),
        })),
      },
    });
  },

  updateTabPath: (id, newPath, newName) => {
    const { paneState } = get();
    set({
      paneState: {
        ...paneState,
        panes: paneState.panes.map((pane) => ({
          ...pane,
          tabs: pane.tabs.map((t) =>
            t.id === id ? { ...t, id: newPath, path: newPath, name: newName } : t
          ),
          activeTabId: pane.activeTabId === id ? newPath : pane.activeTabId,
        })),
      },
    });
  },

  toggleEditorMode: (id) => {
    const { paneState } = get();
    set({
      paneState: {
        ...paneState,
        panes: paneState.panes.map((pane) => ({
          ...pane,
          tabs: pane.tabs.map((t) =>
            t.id === id
              ? { ...t, editorMode: t.editorMode === "source" ? "preview" : "source" }
              : t
          ),
        })),
      },
    });
  },

  pushNav: (tabId, entry) => {
    const { paneState } = get();
    set({
      paneState: {
        ...paneState,
        panes: paneState.panes.map((pane) => ({
          ...pane,
          tabs: pane.tabs.map((t) =>
            t.id === tabId
              ? { ...t, navBack: [...t.navBack, entry].slice(-50), navForward: [] }
              : t
          ),
        })),
      },
    });
  },

  navigateBack: (tabId) => {
    const { paneState } = get();
    const pane = findPaneWithTab(paneState.panes, tabId);
    if (!pane) return null;
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab || tab.navBack.length === 0) return null;
    const entry = tab.navBack[tab.navBack.length - 1];
    set({
      paneState: {
        ...paneState,
        panes: paneState.panes.map((p) => ({
          ...p,
          tabs: p.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  navBack: t.navBack.slice(0, -1),
                  navForward: [...t.navForward, { path: t.path, cursor: 0 }].slice(-50),
                }
              : t
          ),
        })),
      },
    });
    return entry;
  },

  navigateForward: (tabId) => {
    const { paneState } = get();
    const pane = findPaneWithTab(paneState.panes, tabId);
    if (!pane) return null;
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab || tab.navForward.length === 0) return null;
    const entry = tab.navForward[tab.navForward.length - 1];
    set({
      paneState: {
        ...paneState,
        panes: paneState.panes.map((p) => ({
          ...p,
          tabs: p.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  navForward: t.navForward.slice(0, -1),
                  navBack: [...t.navBack, { path: t.path, cursor: 0 }].slice(-50),
                }
              : t
          ),
        })),
      },
    });
    return entry;
  },

  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,
  charCount: 0,
  setCursorInfo: (line, col) => set({ cursorLine: line, cursorCol: col }),
  setWordCount: (count) => set({ wordCount: count }),
  setCharCount: (count) => set({ charCount: count }),

  reorderTabs: (fromIndex, toIndex, paneId) => {
    const { paneState } = get();
    const targetPaneId = paneId || paneState.activePaneId;
    set({
      paneState: {
        ...paneState,
        panes: updatePane(paneState.panes, targetPaneId, (pane) => {
          const newTabs = [...pane.tabs];
          const [moved] = newTabs.splice(fromIndex, 1);
          newTabs.splice(toIndex, 0, moved);
          return { ...pane, tabs: newTabs };
        }),
      },
    });
  },

  collapsedDirs: [],
  toggleDirCollapsed: (dirId) => set((s) => {
    const idx = s.collapsedDirs.indexOf(dirId);
    if (idx >= 0) {
      return { collapsedDirs: s.collapsedDirs.filter((d) => d !== dirId) };
    }
    return { collapsedDirs: [...s.collapsedDirs, dirId] };
  }),
  expandedSubdirs: [],
  toggleSubdirExpanded: (path) => set((s) => {
    const idx = s.expandedSubdirs.indexOf(path);
    if (idx >= 0) {
      return { expandedSubdirs: s.expandedSubdirs.filter((d) => d !== path) };
    }
    return { expandedSubdirs: [...s.expandedSubdirs, path] };
  }),

  quickOpenVisible: false,
  quickOpenMode: "open",
  setQuickOpenVisible: (v) => set({ quickOpenVisible: v }),
  setQuickOpenMode: (mode) => set({ quickOpenMode: mode }),

  commandPaletteVisible: false,
  setCommandPaletteVisible: (v) => set({ commandPaletteVisible: v }),

  settingsVisible: false,
  setSettingsVisible: (v) => set({ settingsVisible: v }),

  bookmarkVersion: 0,
  bumpBookmarkVersion: () => set((s) => ({ bookmarkVersion: s.bookmarkVersion + 1 })),

  fileTreeVersion: 0,
  bumpFileTreeVersion: () => set((s) => ({ fileTreeVersion: s.fileTreeVersion + 1 })),

  accordionState: { properties: true, backlinks: false, recent: null, outline: null },
  setAccordionExpanded: (section, expanded) =>
    set((s) => ({
      accordionState: { ...s.accordionState, [section]: expanded },
    })),

  saveVersion: 0,
  bumpSaveVersion: () => set((s) => ({ saveVersion: s.saveVersion + 1 })),

  orphanPaths: [],
  orphanIcon: "file-x",
  addOrphanPath: (path) => set((s) => {
    if (s.orphanPaths.includes(path)) return s;
    return { orphanPaths: [...s.orphanPaths, path] };
  }),
  removeOrphanPath: (path) => set((s) => ({
    orphanPaths: s.orphanPaths.filter((p) => p !== path),
  })),
  setOrphanIcon: (icon) => set({ orphanIcon: icon }),

  saveConflictPath: null,
  setSaveConflictPath: (path) => set({ saveConflictPath: path }),

  deletedPaths: new Set<string>(),
  addDeletedPath: (path) => set((s) => {
    const next = new Set(s.deletedPaths);
    next.add(path);
    return { deletedPaths: next };
  }),
  removeDeletedPath: (path) => set((s) => {
    const next = new Set(s.deletedPaths);
    next.delete(path);
    return { deletedPaths: next };
  }),

  sidebarTab: "files",
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  lintErrors: 0,
  lintWarnings: 0,
  lintDiagnostics: [],
  lintPanelVisible: false,
  setLintCounts: (errors, warnings) => set({ lintErrors: errors, lintWarnings: warnings }),
  setLintDiagnostics: (diagnostics) => set({ lintDiagnostics: diagnostics }),
  toggleLintPanel: () => set((s) => ({ lintPanelVisible: !s.lintPanelVisible })),
}));

// ── Memoized selectors ──

/** Get all tabs across all panes (for cache cleanup, session save, etc.) */
export function selectAllTabs(s: { paneState: PaneState }): Tab[] {
  const all: Tab[] = [];
  for (const pane of s.paneState.panes) {
    all.push(...pane.tabs);
  }
  return all;
}

/** Get the active pane */
export function selectActivePane(s: { paneState: PaneState }): Pane {
  return s.paneState.panes.find((p) => p.id === s.paneState.activePaneId)
    || s.paneState.panes[0];
}

/** Get the active tab in the active pane */
export function selectActiveTab(s: { paneState: PaneState }): Tab | undefined {
  const pane = selectActivePane(s);
  return pane.tabs.find((t) => t.id === pane.activeTabId);
}

export function selectActiveTabPath(s: { paneState: PaneState }): string | undefined {
  return selectActiveTab(s)?.path;
}

export function selectActiveTabName(s: { paneState: PaneState }): string | undefined {
  return selectActiveTab(s)?.name;
}

export function selectActiveEditorMode(s: { paneState: PaneState }): EditorMode | undefined {
  return selectActiveTab(s)?.editorMode;
}
