import { create } from "zustand";

export interface Tab {
  id: string;
  path: string;
  name: string;
  modified: boolean;
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
  closeTab: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  setModified: (id: string, modified: boolean) => void;

  // Status bar
  cursorLine: number;
  cursorCol: number;
  wordCount: number;
  setCursorInfo: (line: number, col: number) => void;
  setWordCount: (count: number) => void;

  // Bookmark refresh signal — bump to trigger re-fetch in Sidebar
  bookmarkVersion: number;
  bumpBookmarkVersion: () => void;
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
    const tab: Tab = { id, path, name, modified: false };
    set({ tabs: [...tabs, tab], activeTabId: id });
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

  setActiveTab: (id) => set({ activeTabId: id }),

  setModified: (id, modified) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, modified } : t)),
    }));
  },

  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,
  setCursorInfo: (line, col) => set({ cursorLine: line, cursorCol: col }),
  setWordCount: (count) => set({ wordCount: count }),

  bookmarkVersion: 0,
  bumpBookmarkVersion: () => set((s) => ({ bookmarkVersion: s.bookmarkVersion + 1 })),
}));
