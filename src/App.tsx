import { useEffect } from "react";
import { Titlebar } from "./components/Titlebar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { Editor, foldFrontmatter } from "./components/Editor";
import { ContextPanel } from "./components/ContextPanel";
import { StatusBar } from "./components/StatusBar";
import { QuickOpen } from "./components/QuickOpen";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAppStore } from "./stores/app";
import { restoreSession, initSessionPersistence } from "./lib/session";
import { createOrOpenPeriodicNote } from "./lib/periodicNotes";
import { registerCommand } from "./lib/commands";
import { applyTheme, getAvailableThemes, restoreTheme } from "./lib/themes";
import { createNewNote } from "./lib/fileOps";
import { openFileInEditor } from "./lib/openFile";
import { listen } from "@tauri-apps/api/event";
import { enableModernWindowStyle } from "@cloudworxx/tauri-plugin-mac-rounded-corners";

// ---------------------------------------------------------------------------
// Shared action functions — called by commands, menu events, and shortcuts
// ---------------------------------------------------------------------------

function toggleQuickOpen() {
  const s = useAppStore.getState();
  s.setQuickOpenVisible(!s.quickOpenVisible);
}

function openQuickOpenForWikilink() {
  const s = useAppStore.getState();
  if (!s.activeTabId) return; // No editor to insert into
  s.setQuickOpenMode("insert-wikilink");
  s.setQuickOpenVisible(true);
}

function openTodayNote() {
  const todayISO = new Date().toISOString().split("T")[0];
  createOrOpenPeriodicNote("daily", todayISO).catch((err) => {
    const msg = String(err);
    if (msg.includes("not configured") || msg.includes("not enabled")) {
      window.alert(
        "Daily notes are not configured.\n\nCreate ~/.onyx/periodic-notes.json with your settings.\nSee ARCHITECTURE.md for the config format."
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Command registration — single source of truth for all app actions
// ---------------------------------------------------------------------------

function registerCommands() {
  const store = useAppStore.getState;

  registerCommand({
    id: "view.toggleSidebar",
    label: "Toggle Sidebar",
    shortcut: "Cmd+Opt+[",
    category: "View",
    execute: () => store().toggleSidebar(),
  });
  registerCommand({
    id: "view.toggleContextPanel",
    label: "Toggle Context Panel",
    shortcut: "Cmd+Opt+]",
    category: "View",
    execute: () => store().toggleContextPanel(),
  });
  registerCommand({
    id: "file.quickOpen",
    label: "Quick Open",
    shortcut: "Cmd+O",
    category: "File",
    execute: toggleQuickOpen,
  });
  registerCommand({
    id: "file.newNote",
    label: "New Note",
    shortcut: "Cmd+N",
    category: "File",
    execute: () => createNewNote(),
  });
  registerCommand({
    id: "file.closeTab",
    label: "Close Tab",
    shortcut: "Cmd+W",
    category: "File",
    execute: async () => {
      const s = store();
      if (!s.activeTabId) return;
      await s.closeTab(s.activeTabId);
      // If that was the last tab in a split pane, close the split
      const after = store();
      if (after.paneLayout.type === "split") {
        const { rightTabs, leftTabs } = after.paneLayout;
        if (rightTabs.length === 0 || leftTabs.length === 0) {
          after.closeSplit();
        }
      }
    },
  });
  registerCommand({
    id: "edit.insertWikilink",
    label: "Insert Wikilink",
    shortcut: "Cmd+K",
    category: "Edit",
    execute: openQuickOpenForWikilink,
  });
  registerCommand({
    id: "navigate.today",
    label: "Open Today's Note",
    shortcut: "Cmd+Shift+D",
    category: "Navigate",
    execute: openTodayNote,
  });

  for (const theme of getAvailableThemes()) {
    registerCommand({
      id: `theme.${theme.id}`,
      label: `Theme: ${theme.name}`,
      category: "Appearance",
      execute: () => applyTheme(theme.id),
    });
  }

  registerCommand({
    id: "navigate.back",
    label: "Go Back",
    shortcut: "Cmd+[",
    category: "Navigate",
    execute: async () => {
      const { activeTabId, navigateBack } = store();
      if (!activeTabId) return;
      const entry = navigateBack(activeTabId);
      if (entry) {
        await openFileInEditor(entry.path, entry.path.split("/").pop() || entry.path, { skipNav: true });
      }
    },
  });
  registerCommand({
    id: "navigate.forward",
    label: "Go Forward",
    shortcut: "Cmd+]",
    category: "Navigate",
    execute: async () => {
      const { activeTabId, navigateForward } = store();
      if (!activeTabId) return;
      const entry = navigateForward(activeTabId);
      if (entry) {
        await openFileInEditor(entry.path, entry.path.split("/").pop() || entry.path, { skipNav: true });
      }
    },
  });

  registerCommand({
    id: "view.closeSplit",
    label: "Close Split Pane",
    category: "View",
    execute: () => store().closeSplit(),
  });

  registerCommand({
    id: "editor.toggleMode",
    label: "Toggle Preview Mode",
    shortcut: "Cmd+/",
    category: "Editor",
    execute: () => {
      const { activeTabId, toggleEditorMode } = store();
      if (activeTabId) toggleEditorMode(activeTabId);
    },
  });

  registerCommand({
    id: "editor.foldFrontmatter",
    label: "Fold Frontmatter",
    category: "Editor",
    execute: () => foldFrontmatter(),
  });

  registerCommand({
    id: "view.commandPalette",
    label: "Command Palette",
    shortcut: "Cmd+P",
    category: "View",
    execute: () => store().setCommandPaletteVisible(true),
  });
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export default function App() {
  // Register commands, restore theme, listen for native menu events
  useEffect(() => {
    registerCommands();
    restoreTheme();

    const unlisten = listen<string>("menu:action", (event) => {
      const store = useAppStore.getState;
      switch (event.payload) {
        case "new_note":
          createNewNote();
          break;
        case "quick_open":
          toggleQuickOpen();
          break;
        case "close_tab": {
          const { activeTabId, closeTab } = store();
          if (activeTabId) closeTab(activeTabId);
          break;
        }
        case "toggle_sidebar":
          store().toggleSidebar();
          break;
        case "toggle_context":
          store().toggleContextPanel();
          break;
        case "command_palette":
          store().setCommandPaletteVisible(true);
          break;
        case "toggle_preview": {
          const { activeTabId, toggleEditorMode } = store();
          if (activeTabId) toggleEditorMode(activeTabId);
          break;
        }
        case "nav_back": {
          const { activeTabId: id, navigateBack } = store();
          if (id) {
            const entry = navigateBack(id);
            if (entry) openFileInEditor(entry.path, entry.path.split("/").pop() || entry.path, { skipNav: true });
          }
          break;
        }
        case "nav_forward": {
          const { activeTabId: id2, navigateForward } = store();
          if (id2) {
            const entry = navigateForward(id2);
            if (entry) openFileInEditor(entry.path, entry.path.split("/").pop() || entry.path, { skipNav: true });
          }
          break;
        }
        case "today_note":
          openTodayNote();
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Restore session + start periodic saving
  useEffect(() => {
    restoreSession().catch((err) =>
      console.error("Failed to restore session:", err)
    );
    const cleanup = initSessionPersistence();

    enableModernWindowStyle({ cornerRadius: 10, offsetX: -6, offsetY: -6 }).catch(
      (err) => console.error("Failed to enable rounded corners:", err)
    );

    return cleanup;
  }, []);

  // Global keyboard shortcuts — single source of truth for non-editor shortcuts.
  // Editor-specific shortcuts (formatting, outliner, search) live in CM6 keymaps.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const alt = e.altKey;
      const store = useAppStore.getState;

      if (meta && alt && e.key === "[") {
        e.preventDefault();
        store().toggleSidebar();
      }

      if (meta && alt && e.key === "]") {
        e.preventDefault();
        store().toggleContextPanel();
      }

      if (meta && !alt && !e.shiftKey && e.key === "w") {
        e.preventDefault();
        const { activeTabId, closeTab } = store();
        if (activeTabId) closeTab(activeTabId);
      }

      if (meta && !alt && !e.shiftKey && e.key === "o") {
        e.preventDefault();
        toggleQuickOpen();
      }

      if (meta && !alt && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        store().setCommandPaletteVisible(true);
      }

      if (meta && !alt && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        createNewNote();
      }

      if (meta && !alt && !e.shiftKey && e.key === "k") {
        e.preventDefault();
        openQuickOpenForWikilink();
      }

      if (meta && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        openTodayNote();
      }

      if (meta && !alt && !e.shiftKey && e.key === "/") {
        e.preventDefault();
        const { activeTabId, toggleEditorMode } = store();
        if (activeTabId) toggleEditorMode(activeTabId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="app">
      <Titlebar />
      <TabBar />
      <div className="main">
        <ErrorBoundary label="sidebar">
          <Sidebar />
        </ErrorBoundary>
        <ErrorBoundary label="editor">
          <Editor />
        </ErrorBoundary>
        <ErrorBoundary label="context panel">
          <ContextPanel />
        </ErrorBoundary>
      </div>
      <StatusBar />
      <QuickOpen />
      <CommandPalette />
    </div>
  );
}
