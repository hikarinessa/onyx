import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Titlebar } from "./components/Titlebar";
import { Sidebar } from "./components/Sidebar";
import { Editor, foldFrontmatter } from "./components/Editor";
import { LintPanel } from "./components/LintPanel";
import { ContextPanel } from "./components/ContextPanel";
import { StatusBar } from "./components/StatusBar";
import { QuickOpen } from "./components/QuickOpen";
import { CommandPalette } from "./components/CommandPalette";
import { Settings } from "./components/Settings";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAppStore, selectActiveTab, selectActivePane, selectAllTabs } from "./stores/app";
import { restoreSession, initSessionPersistence } from "./lib/session";
import { createOrOpenPeriodicNote } from "./lib/periodicNotes";
import { registerCommand, getAllCommands } from "./lib/commands";
import { makeTableCommands } from "./extensions/tableEditor";
import { copyBlock, deleteBlock, getCurrentBlock } from "./extensions/blocks";
import { getEditorView, getAllPaneViews } from "./components/Editor";
import { applyTheme, getAvailableThemes, restoreTheme } from "./lib/themes";
import {
  registerKeybinding,
  parseKeyCombo,
  normaliseCombo,
  getGlobalKeyMap,
} from "./lib/keybindings";
import { createNewNote } from "./lib/fileOps";
import { navigateHistory, openFileInEditor } from "./lib/openFile";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { enableModernWindowStyle } from "@cloudworxx/tauri-plugin-mac-rounded-corners";
import { invalidateCache } from "./lib/ipcCache";
import { loadAndApplyConfig } from "./lib/configBridge";
import { clearEditorCache, migrateEditorCache, cancelPendingSave, lastSavedContent, replaceTabContent } from "./components/Editor";
import { updateRecentDocPath, markRecentDocDeleted } from "./lib/recentDocs";

interface FsChangeEvent {
  kind: "create" | "modify" | "remove" | "rename";
  path: string;
  old_path?: string;
  is_dir: boolean;
}

// ---------------------------------------------------------------------------
// Shared action functions — called by commands, menu events, and shortcuts
// ---------------------------------------------------------------------------

function toggleQuickOpen() {
  const s = useAppStore.getState();
  s.setQuickOpenVisible(!s.quickOpenVisible);
}

function openQuickOpenForWikilink() {
  const s = useAppStore.getState();
  if (!selectActiveTab(s)) return; // No editor to insert into
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
      const s = store();
      const tab = selectActiveTab(s);
      if (tab) s.closeTab(tab.id);
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
      const s = store();
      const tab = selectActiveTab(s);
      if (tab) s.toggleEditorMode(tab.id);
    },
  });

  registerCommand({
    id: "editor.foldFrontmatter",
    label: "Toggle Frontmatter Fold",
    category: "Editor",
    execute: () => { foldFrontmatter(); },
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
      const s = store();
      const pane = selectActivePane(s);
      if (pane.tabs.length <= 1) return;
      const idx = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
      const next = (idx + 1) % pane.tabs.length;
      s.setActiveTab(pane.tabs[next].id);
    },
  });

  registerCommand({
    id: "navigate.prevTab",
    label: "Previous Tab",
    shortcut: "Ctrl+Shift+Tab",
    category: "Navigate",
    execute: () => {
      const s = store();
      const pane = selectActivePane(s);
      if (pane.tabs.length <= 1) return;
      const idx = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
      const prev = (idx - 1 + pane.tabs.length) % pane.tabs.length;
      s.setActiveTab(pane.tabs[prev].id);
    },
  });

  registerCommand({
    id: "file.revealInFinder",
    label: "Reveal in Finder",
    category: "File",
    execute: async () => {
      const tab = selectActiveTab(store());
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
      const tab = selectActiveTab(store());
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

  registerCommand({
    id: "view.searchFiles",
    label: "Search in Files",
    shortcut: "Cmd+Shift+F",
    category: "View",
    execute: () => {
      const s = store();
      if (!s.sidebarVisible) s.toggleSidebar();
      s.setSidebarTab("search");
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(".search-panel-input")?.focus();
      }, 50);
    },
  });

  registerCommand({
    id: "view.splitPane",
    label: "Split Editor",
    shortcut: "Cmd+\\",
    category: "View",
    execute: () => store().splitPane(),
  });

  registerCommand({
    id: "view.closePane",
    label: "Close Pane",
    category: "View",
    execute: () => {
      const s = store();
      if (s.paneState.panes.length > 1) {
        s.closePane(s.paneState.activePaneId);
      }
    },
  });

  // Pane focus shortcuts
  for (let i = 0; i < 3; i++) {
    registerCommand({
      id: `view.focusPane${i + 1}`,
      label: `Focus Pane ${i + 1}`,
      shortcut: `Cmd+${i + 1}`,
      category: "View",
      execute: () => {
        const panes = store().paneState.panes;
        if (i < panes.length) store().setActivePane(panes[i].id);
      },
    });
  }

  registerCommand({
    id: "view.moveTabToNextPane",
    label: "Move Tab to Next Pane",
    shortcut: "Cmd+Shift+|",
    category: "View",
    execute: () => {
      const s = store();
      const { paneState } = s;
      if (paneState.panes.length < 2) return;
      const activePane = paneState.panes.find((p) => p.id === paneState.activePaneId);
      if (!activePane?.activeTabId) return;
      const currentIdx = paneState.panes.indexOf(activePane);
      const targetIdx = (currentIdx + 1) % paneState.panes.length;
      s.moveTabToPane(activePane.activeTabId, paneState.panes[targetIdx].id);
    },
  });

  registerCommand({
    id: "view.toggleScrollLock",
    label: "Toggle Scroll Lock",
    category: "View",
    execute: () => {
      const s = store();
      const { paneState } = s;
      if (paneState.scrollLockAnchors) {
        // Unlock
        s.setScrollLockAnchors(null);
      } else {
        // Lock — capture current scroll positions as anchors
        const anchors = new Map<string, number>();
        const views = getAllPaneViews();
        for (const [paneId, view] of views) {
          anchors.set(paneId, view.scrollDOM.scrollTop);
        }
        s.setScrollLockAnchors(anchors);
      }
    },
  });

  // ── Table commands (Phase 9c) ──
  const tbl = makeTableCommands(getEditorView);
  registerCommand({ id: "table.insert", label: "Table: Insert", category: "Table", execute: tbl.insertTable });
  registerCommand({ id: "table.insertColumnRight", label: "Table: Insert Column Right", category: "Table", execute: tbl.insertColumnRight });
  registerCommand({ id: "table.deleteColumn", label: "Table: Delete Column", category: "Table", execute: tbl.deleteColumn });
  registerCommand({ id: "table.insertRowBelow", label: "Table: Insert Row Below", category: "Table", execute: tbl.insertRowBelow });
  registerCommand({ id: "table.deleteRow", label: "Table: Delete Row", category: "Table", execute: tbl.deleteRow });
  registerCommand({ id: "table.moveColumnRight", label: "Table: Move Column Right", category: "Table", execute: tbl.moveColumnRight });
  registerCommand({ id: "table.moveColumnLeft", label: "Table: Move Column Left", category: "Table", execute: tbl.moveColumnLeft });
  registerCommand({ id: "table.moveRowDown", label: "Table: Move Row Down", category: "Table", execute: tbl.moveRowDown });
  registerCommand({ id: "table.moveRowUp", label: "Table: Move Row Up", category: "Table", execute: tbl.moveRowUp });
  registerCommand({ id: "table.alignLeft", label: "Table: Align Left", category: "Table", execute: tbl.alignLeft });
  registerCommand({ id: "table.alignCenter", label: "Table: Align Center", category: "Table", execute: tbl.alignCenter });
  registerCommand({ id: "table.alignRight", label: "Table: Align Right", category: "Table", execute: tbl.alignRight });
  registerCommand({ id: "table.sortAsc", label: "Table: Sort Ascending", category: "Table", execute: tbl.sortAsc });
  registerCommand({ id: "table.sortDesc", label: "Table: Sort Descending", category: "Table", execute: tbl.sortDesc });
  registerCommand({ id: "table.transpose", label: "Table: Transpose", category: "Table", execute: tbl.transpose });
  registerCommand({ id: "table.format", label: "Table: Format", category: "Table", execute: tbl.format });

  // ── Block commands ──
  registerCommand({
    id: "block.copy",
    label: "Block: Copy",
    category: "Block",
    execute: () => { const v = getEditorView(); if (v) copyBlock(v); },
  });
  registerCommand({
    id: "block.delete",
    label: "Block: Delete",
    category: "Block",
    execute: () => { const v = getEditorView(); if (v) deleteBlock(v); },
  });
  registerCommand({
    id: "block.extract",
    label: "Block: Extract to New Note",
    category: "Block",
    execute: async () => {
      const v = getEditorView();
      if (!v) return;
      const block = getCurrentBlock(v);
      if (!block) return;
      const tab = selectActiveTab(store());
      if (!tab) return;
      const dir = tab.path.substring(0, tab.path.lastIndexOf("/"));
      const firstLine = block.text.split("\n")[0].replace(/^#+\s*/, "").trim();
      const baseName = (firstLine.substring(0, 40) || "Extracted Note").replace(/[/:\0]/g, "");
      let notePath = `${dir}/${baseName}.md`;
      let counter = 1;
      while (await invoke<boolean>("path_exists", { path: notePath })) {
        notePath = `${dir}/${baseName} ${counter}.md`;
        counter++;
      }
      // Create the new note (invoke is fine for new files — same as fileOps.createNote)
      await invoke("write_file", { path: notePath, content: block.text + "\n" });
      // Replace the block with a wikilink to the new note
      const linkName = notePath.split("/").pop()!.replace(".md", "");
      v.dispatch({
        changes: { from: block.from, to: block.to, insert: `[[${linkName}]]` },
      });
      await invoke("reindex_file", { path: notePath });
      store().bumpFileTreeVersion();
    },
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
  const [dragOver, setDragOver] = useState(false);

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
          const s = store();
          const tab = selectActiveTab(s);
          if (tab) s.closeTab(tab.id);
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

    // Buffer remove events to handle the macOS rename race:
    // On macOS, a rename produces Remove(old) + Create(new) from the watcher,
    // racing with the command's Rename event. We buffer removes for 300ms —
    // if a rename event arrives that matches, we cancel the remove processing.
    const pendingRemoves = new Map<string, ReturnType<typeof setTimeout>>();

    // Central fs:change handler — cross-cutting concerns (tabs, cache, auto-save guard)
    const unlistenFsChange = listen<FsChangeEvent>("fs:change", (event) => {
      if (cancelled) return;
      invalidateCache();

      const { kind, path, old_path, is_dir } = event.payload;
      const store = useAppStore.getState();

      if (kind === "remove") {
        cancelPendingSave();
        store.addDeletedPath(path);

        // Buffer the remove — a rename event may follow within 300ms
        const timer = setTimeout(() => {
          pendingRemoves.delete(path);
          // Process the remove: close/mark tabs, refresh tree
          const s = useAppStore.getState();
          const prefix = path.endsWith("/") ? path : path + "/";
          const affected = selectAllTabs(s).filter(
            (t) => t.path === path || t.path.startsWith(prefix)
          );
          if (affected.length > 0) {
            const toClose = affected.filter((t) => !t.modified);
            const toMark = affected.filter((t) => t.modified);
            for (const tab of toClose) {
              clearEditorCache(tab.path);
            }
            if (toClose.length > 0) {
              s.removeTabs(toClose.map((t) => t.id));
            }
            for (const tab of toMark) {
              s.addDeletedPath(tab.path);
            }
          }
          s.bumpFileTreeVersion();
          s.bumpBookmarkVersion();
          markRecentDocDeleted(path);
        }, 300);
        pendingRemoves.set(path, timer);

      } else if (kind === "rename" && old_path) {
        cancelPendingSave();

        // Cancel any buffered remove for the old path (it was a rename, not a delete)
        const pendingTimer = pendingRemoves.get(old_path);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingRemoves.delete(old_path);
        }

        // Clear deleted markers
        store.removeDeletedPath(old_path);
        store.removeDeletedPath(path);

        const newName = path.split("/").pop() || path;

        // Migrate tabs — idempotent (no-op if fileOps already updated them)
        if (is_dir) {
          const oldPrefix = old_path.endsWith("/") ? old_path : old_path + "/";
          for (const tab of selectAllTabs(store)) {
            if (tab.path.startsWith(oldPrefix)) {
              const migratedPath = path + tab.path.slice(old_path.length);
              const migratedName = migratedPath.split("/").pop() || migratedPath;
              store.updateTabPath(tab.id, migratedPath, migratedName);
              migrateEditorCache(tab.path, migratedPath);
            }
          }
        } else {
          const openTab = selectAllTabs(store).find((t) => t.path === old_path);
          if (openTab) {
            store.updateTabPath(openTab.id, path, newName);
            migrateEditorCache(old_path, path);
          }
        }

        store.bumpFileTreeVersion();
        updateRecentDocPath(old_path, path, newName);
      } else if (kind === "create") {
        store.bumpFileTreeVersion();
      }

      // Auto-reload open tabs on external changes.
      // Covers "modify" (normal edits) and "create" (atomic rename-over, e.g. git checkout).
      if (kind === "modify" || kind === "create") {
        if (kind === "modify") store.bumpFileTreeVersion();

        const changedTab = selectAllTabs(store).find((t) => t.path === path);
        if (changedTab) {
          if (!changedTab.modified) {
            invoke<string>("read_file", { path }).then((newContent) => {
              const cached = lastSavedContent.get(changedTab.id);
              if (cached !== undefined && cached !== newContent) {
                replaceTabContent(changedTab.id, newContent);
                lastSavedContent.set(changedTab.id, newContent);
              }
            }).catch(() => {});
          } else {
            store.setSaveConflictPath(path);
          }
        }
      }
    });

    // Tauri 2 native drag-drop (HTML5 File.path doesn't exist in Tauri 2)
    const unlistenDragDrop = getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) return;
      const { type } = event.payload;
      if (type === "enter" || type === "over") {
        setDragOver(true);
      } else if (type === "leave") {
        setDragOver(false);
      } else if (type === "drop") {
        setDragOver(false);
        for (const filePath of event.payload.paths) {
          if (filePath.endsWith(".md")) {
            const name = filePath.split("/").pop() || filePath;
            openFileInEditor(filePath, name).catch(console.error);
          }
        }
      }
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
      unlistenFsChange.then((fn) => fn());
      unlistenDragDrop.then((fn) => fn());
      for (const timer of pendingRemoves.values()) clearTimeout(timer);
      pendingRemoves.clear();
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
          <ErrorBoundary label="editor">
            <Editor />
          </ErrorBoundary>
          <LintPanel />
        </div>
        <ErrorBoundary label="context panel">
          <ContextPanel />
        </ErrorBoundary>
      </div>
      <StatusBar />
      <QuickOpen />
      <CommandPalette />
      <Settings />
      {dragOver && <div className="drop-overlay">Drop to open</div>}
    </div>
  );
}
