import { create } from "zustand";

export type EditorMode = "source" | "preview";

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

interface AppState {
  // Sidebar
  sidebarVisible: boolean;
  toggleSidebar: () => void;

  // Context panel
  contextPanelVisible: boolean;
  toggleContextPanel: () => void;

  // Tabs
  tabs: Tab[];
  activeTabId: string | null;
  openFile: (path: string, name: string) => void;
  replaceActiveTab: (path: string, name: string) => void;
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
  reorderTabs: (fromIndex: number, toIndex: number) => void;

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

  // Bookmark refresh signal — bump to trigger re-fetch in Sidebar
  bookmarkVersion: number;
  bumpBookmarkVersion: () => void;

  // File tree refresh signal — bump after any file mutation to refresh sidebar
  fileTreeVersion: number;
  bumpFileTreeVersion: () => void;

  // Accordion state for context panel sections
  accordionState: AccordionState;
  setAccordionExpanded: (section: keyof AccordionState, expanded: boolean | null) => void;

  // Save version — bumped after each successful write_file to trigger re-fetches
  saveVersion: number;
  bumpSaveVersion: () => void;

  // Orphan notes — files not in any registered directory
  orphanPaths: string[];
  addOrphanPath: (path: string) => void;
  removeOrphanPath: (path: string) => void;

  // Save conflict — set when write_file detects external modification
  saveConflictPath: string | null;
  setSaveConflictPath: (path: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  contextPanelVisible: false,
  toggleContextPanel: () =>
    set((s) => ({ contextPanelVisible: !s.contextPanelVisible })),

  tabs: [],
  activeTabId: null,

  openFile: (path, name) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const id = path;
    const tab: Tab = { id, path, name, modified: false, editorMode: "preview", navBack: [], navForward: [] };
    set({ tabs: [...tabs, tab], activeTabId: id });
  },

  replaceActiveTab: (path, name) => {
    const { tabs, activeTabId } = get();
    if (!activeTabId) return;
    const oldTab = tabs.find((t) => t.id === activeTabId);
    const id = path;
    const newTab: Tab = {
      id, path, name, modified: false,
      editorMode: oldTab?.editorMode ?? "preview",
      navBack: oldTab?.navBack ?? [],
      navForward: oldTab?.navForward ?? [],
    };
    set({
      tabs: tabs.map((t) => (t.id === activeTabId ? newTab : t)),
      activeTabId: id,
    });
  },

  closeTab: async (id) => {
    // Snapshot live CM6 content into cache, then flush to disk
    if (snapshotEditorHook) snapshotEditorHook(id);
    if (flushSaveHook) await flushSaveHook(id);

    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    const newTabs = tabs.filter((t) => t.id !== id);

    let newActive = activeTabId;
    if (activeTabId === id) {
      if (newTabs.length === 0) {
        newActive = null;
      } else if (idx >= newTabs.length) {
        newActive = newTabs[newTabs.length - 1].id;
      } else {
        newActive = newTabs[idx].id;
      }
    }

    set({ tabs: newTabs, activeTabId: newActive });
  },

  /** Remove tabs without snapshot/flush — used when files are already gone (e.g. trash) */
  removeTabs: (ids) => {
    const idSet = new Set(ids);
    const { tabs, activeTabId } = get();
    const newTabs = tabs.filter((t) => !idSet.has(t.id));
    let newActive = activeTabId;
    if (newActive && idSet.has(newActive)) {
      if (newTabs.length === 0) {
        newActive = null;
      } else {
        const firstIdx = tabs.findIndex((t) => idSet.has(t.id));
        newActive = newTabs[Math.min(firstIdx, newTabs.length - 1)].id;
      }
    }
    set({ tabs: newTabs, activeTabId: newActive });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  setModified: (id, modified) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, modified } : t)),
    }));
  },

  updateTabPath: (id, newPath, newName) => {
    const { activeTabId } = get();
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, id: newPath, path: newPath, name: newName } : t
      ),
      activeTabId: activeTabId === id ? newPath : activeTabId,
    }));
  },

  toggleEditorMode: (id) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, editorMode: t.editorMode === "source" ? "preview" : "source" }
          : t
      ),
    }));
  },

  pushNav: (tabId, entry) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, navBack: [...t.navBack, entry].slice(-50), navForward: [] }
          : t
      ),
    }));
  },

  navigateBack: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.navBack.length === 0) return null;
    const entry = tab.navBack[tab.navBack.length - 1];
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              navBack: t.navBack.slice(0, -1),
              navForward: [...t.navForward, { path: t.path, cursor: 0 }].slice(-50),
            }
          : t
      ),
    }));
    return entry;
  },

  navigateForward: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.navForward.length === 0) return null;
    const entry = tab.navForward[tab.navForward.length - 1];
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              navForward: t.navForward.slice(0, -1),
              navBack: [...t.navBack, { path: t.path, cursor: 0 }].slice(-50),
            }
          : t
      ),
    }));
    return entry;
  },

  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,
  charCount: 0,
  setCursorInfo: (line, col) => set({ cursorLine: line, cursorCol: col }),
  setWordCount: (count) => set({ wordCount: count }),
  setCharCount: (count) => set({ charCount: count }),

  reorderTabs: (fromIndex, toIndex) => {
    const { tabs } = get();
    const newTabs = [...tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);
    set({ tabs: newTabs });
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

  accordionState: { properties: null, backlinks: null, recent: null, outline: null },
  setAccordionExpanded: (section, expanded) =>
    set((s) => ({
      accordionState: { ...s.accordionState, [section]: expanded },
    })),

  saveVersion: 0,
  bumpSaveVersion: () => set((s) => ({ saveVersion: s.saveVersion + 1 })),

  orphanPaths: [],
  addOrphanPath: (path) => set((s) => {
    if (s.orphanPaths.includes(path)) return s;
    return { orphanPaths: [...s.orphanPaths, path] };
  }),
  removeOrphanPath: (path) => set((s) => ({
    orphanPaths: s.orphanPaths.filter((p) => p !== path),
  })),

  saveConflictPath: null,
  setSaveConflictPath: (path) => set({ saveConflictPath: path }),
}));

// ── Memoized selectors ──
// Avoids running Array.find on every store update (cursor moves, word counts, etc.)
// Recomputes only when tabs or activeTabId actually change.

let _memoTabs: Tab[] = [];
let _memoActiveId: string | null = null;
let _memoActiveTab: Tab | undefined = undefined;

/** Memoized selector: returns the active Tab without scanning on every store update */
export function selectActiveTab(s: { tabs: Tab[]; activeTabId: string | null }): Tab | undefined {
  if (s.tabs === _memoTabs && s.activeTabId === _memoActiveId) {
    return _memoActiveTab;
  }
  _memoTabs = s.tabs;
  _memoActiveId = s.activeTabId;
  _memoActiveTab = s.tabs.find((t) => t.id === s.activeTabId);
  return _memoActiveTab;
}

export function selectActiveTabPath(s: { tabs: Tab[]; activeTabId: string | null }): string | undefined {
  return selectActiveTab(s)?.path;
}

export function selectActiveTabName(s: { tabs: Tab[]; activeTabId: string | null }): string | undefined {
  return selectActiveTab(s)?.name;
}

export function selectActiveEditorMode(s: { tabs: Tab[]; activeTabId: string | null }): EditorMode | undefined {
  return selectActiveTab(s)?.editorMode;
}
