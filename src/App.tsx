import { useEffect } from "react";
import { Titlebar } from "./components/Titlebar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { Editor, foldFrontmatter } from "./components/Editor";
import { ContextPanel } from "./components/ContextPanel";
import { StatusBar } from "./components/StatusBar";
import { QuickOpen } from "./components/QuickOpen";
import { CommandPalette } from "./components/CommandPalette";
import { Settings } from "./components/Settings";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAppStore } from "./stores/app";
import { restoreSession, initSessionPersistence } from "./lib/session";
import { createOrOpenPeriodicNote } from "./lib/periodicNotes";
import { registerCommand, getAllCommands } from "./lib/commands";
import { applyTheme, getAvailableThemes, restoreTheme } from "./lib/themes";
import {
  registerKeybinding,
  parseKeyCombo,
  normaliseCombo,
  getGlobalKeyMap,
} from "./lib/keybindings";
import { createNewNote } from "./lib/fileOps";
import { navigateHistory } from "./lib/openFile";
import { listen } from "@tauri-apps/api/event";
import { enableModernWindowStyle } from "@cloudworxx/tauri-plugin-mac-rounded-corners";
import { invalidateCache } from "./lib/ipcCache";
import { loadAndApplyConfig } from "./lib/configBridge";

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
  createOrOpenPeriodicNote("daily", todayISO, { newTab: false }).catch((err) => {
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
    execute: () => {
      const { activeTabId, closeTab } = store();
      if (activeTabId) closeTab(activeTabId);
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
  registerCommand({
    id: "navigate.back",
    label: "Go Back",
    shortcut: "Cmd+[",
    category: "Navigate",
    execute: () => navigateHistory("back"),
  });
  registerCommand({
    id: "navigate.forward",
    label: "Go Forward",
    shortcut: "Cmd+]",
    category: "Navigate",
    execute: () => navigateHistory("forward"),
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
    label: "Toggle Frontmatter Fold",
    category: "Editor",
    execute: () => foldFrontmatter(),
  });

  // Editor-scope commands — dispatched by CM6 keymaps, registered here for
  // keybinding display. execute() is a no-op since CM6 handles dispatch.
  const editorNoop = () => {};
  registerCommand({ id: "editor.bold", label: "Bold", shortcut: "Cmd+B", category: "Format", execute: editorNoop });
  registerCommand({ id: "editor.italic", label: "Italic", shortcut: "Cmd+I", category: "Format", execute: editorNoop });
  registerCommand({ id: "editor.inlineCode", label: "Inline Code", shortcut: "Cmd+Shift+C", category: "Format", execute: editorNoop });
  registerCommand({ id: "editor.moveLineUp", label: "Move Line Up", shortcut: "Alt+Up", category: "Editor", execute: editorNoop });
  registerCommand({ id: "editor.moveLineDown", label: "Move Line Down", shortcut: "Alt+Down", category: "Editor", execute: editorNoop });
  registerCommand({ id: "editor.followLink", label: "Follow Link", shortcut: "Cmd+Enter", category: "Editor", execute: editorNoop });
  registerCommand({ id: "editor.find", label: "Find", shortcut: "Cmd+F", category: "Editor", execute: editorNoop });
  registerCommand({ id: "editor.findReplace", label: "Find and Replace", shortcut: "Cmd+H", category: "Editor", execute: editorNoop });
  registerCommand({ id: "editor.undo", label: "Undo", shortcut: "Cmd+Z", category: "Edit", execute: editorNoop });
  registerCommand({ id: "editor.redo", label: "Redo", shortcut: "Cmd+Shift+Z", category: "Edit", execute: editorNoop });

  registerCommand({
    id: "navigate.nextTab",
    label: "Next Tab",
    shortcut: "Ctrl+Tab",
    category: "Navigate",
    execute: () => {
      const { tabs, activeTabId, setActiveTab } = store();
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      const next = (idx + 1) % tabs.length;
      setActiveTab(tabs[next].id);
    },
  });

  registerCommand({
    id: "navigate.prevTab",
    label: "Previous Tab",
    shortcut: "Ctrl+Shift+Tab",
    category: "Navigate",
    execute: () => {
      const { tabs, activeTabId, setActiveTab } = store();
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      const prev = (idx - 1 + tabs.length) % tabs.length;
      setActiveTab(tabs[prev].id);
    },
  });

  registerCommand({
    id: "file.revealInFinder",
    label: "Reveal in Finder",
    category: "File",
    execute: async () => {
      const tab = store().tabs.find((t) => t.id === store().activeTabId);
      if (tab) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("reveal_in_finder", { path: tab.path });
      }
    },
  });

  registerCommand({
    id: "file.copyPath",
    label: "Copy File Path",
    category: "File",
    execute: () => {
      const tab = store().tabs.find((t) => t.id === store().activeTabId);
      if (tab) navigator.clipboard.writeText(tab.path).catch(() => {});
    },
  });

  registerCommand({
    id: "view.commandPalette",
    label: "Command Palette",
    shortcut: "Cmd+P",
    category: "View",
    execute: () => store().setCommandPaletteVisible(true),
  });

  registerCommand({
    id: "view.settings",
    label: "Settings",
    shortcut: "Cmd+,",
    category: "View",
    execute: () => store().setSettingsVisible(true),
  });

  // Register keybindings for every command that has a shortcut
  for (const cmd of getAllCommands()) {
    if (cmd.shortcut) {
      const scope = cmd.id.startsWith("editor.") ? "editor" : "global";
      registerKeybinding(cmd.id, normaliseCombo(cmd.shortcut), scope);
    }
  }
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export default function App() {
  // Register commands, restore theme, listen for native menu events
  useEffect(() => {
    registerCommands();
    restoreTheme();
    loadAndApplyConfig();

    let cancelled = false;

    const unlisten = listen<string>("menu:action", (event) => {
      if (cancelled) return;
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
        case "settings":
          store().setSettingsVisible(true);
          break;
        case "today_note":
          openTodayNote();
          break;
      }
    });

    // Invalidate IPC cache on file system changes
    const unlistenFsChange = listen("fs:change", () => {
      if (cancelled) return;
      invalidateCache();
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
      unlistenFsChange.then((fn) => fn());
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

  // Global keyboard shortcuts — dispatched via keybinding registry.
  // Editor-specific shortcuts (formatting, outliner, search) live in CM6 keymaps.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const combo = parseKeyCombo(e);
      if (!combo) return;

      // Read live from registry on every keypress so rebinds take effect
      // immediately without restart. ~20 bindings — negligible cost.
      const keyMap = getGlobalKeyMap();
      let commandId = keyMap.get(combo);
      if (!commandId && combo.startsWith("Ctrl+") && !combo.includes("Cmd+")) {
        commandId = keyMap.get(combo.replace("Ctrl+", "Cmd+"));
      }

      if (commandId) {
        e.preventDefault();
        const cmds = getAllCommands();
        const cmd = cmds.find((c) => c.id === commandId);
        if (cmd) cmd.execute();
      }
    };

    // Mouse back/forward buttons (buttons 3 and 4)
    const handleMouseNav = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        navigateHistory("back");
      } else if (e.button === 4) {
        e.preventDefault();
        navigateHistory("forward");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mouseup", handleMouseNav);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mouseup", handleMouseNav);
    };
  }, []);

  return (
    <div className="app">
      <Titlebar />
      <div className="main">
        <ErrorBoundary label="sidebar">
          <Sidebar />
        </ErrorBoundary>
        <div className="editor-column">
          <TabBar />
          <ErrorBoundary label="editor">
            <Editor />
          </ErrorBoundary>
        </div>
        <ErrorBoundary label="context panel">
          <ContextPanel />
        </ErrorBoundary>
      </div>
      <StatusBar />
      <QuickOpen />
      <CommandPalette />
      <Settings />
    </div>
  );
}
