import { create } from "zustand";

export interface Tab {
  id: string;
  path: string;
  name: string;
  modified: boolean;
  content: string;
  lastSavedContent: string;
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
  openFile: (path: string, name: string, content: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;

  // Status bar
  cursorLine: number;
  cursorCol: number;
  wordCount: number;
  setCursorInfo: (line: number, col: number, wordCount: number) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  contextPanelVisible: false,
  toggleContextPanel: () =>
    set((s) => ({ contextPanelVisible: !s.contextPanelVisible })),

  tabs: [],
  activeTabId: null,

  openFile: (path, name, content) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const id = path;
    const tab: Tab = {
      id,
      path,
      name,
      modified: false,
      content,
      lastSavedContent: content,
    };
    set({ tabs: [...tabs, tab], activeTabId: id });
  },

  closeTab: (id) => {
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

  updateContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, content, modified: content !== t.lastSavedContent }
          : t
      ),
    }));
  },

  markSaved: (id) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, modified: false, lastSavedContent: t.content } : t
      ),
    }));
  },

  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,
  setCursorInfo: (line, col, wordCount) =>
    set({ cursorLine: line, cursorCol: col, wordCount }),
}));
