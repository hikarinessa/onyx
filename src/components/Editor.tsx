import { useEffect, useRef, useState, useCallback } from "react";
import { EditorState, EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, historyKeymap, history } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  syntaxHighlighting,
  HighlightStyle,
  codeFolding,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, setFlushSaveHook, setSnapshotEditorHook } from "../stores/app";
import { frontmatterExtension, frontmatterTabRef, clearAutoFoldForTab, toggleFrontmatterFoldCommand } from "../extensions/frontmatter";
import { wikilinkExtension, wikilinkFollowRef } from "../extensions/wikilinks";
import { tagExtension } from "../extensions/tags";
import { formattingKeymap } from "../extensions/formatting";
import { outlinerKeymap } from "../extensions/outliner";
import { tableEditorExtension } from "../extensions/tableEditor";
import { urlPasteExtension } from "../extensions/urlPaste";
import { autocompleteExtension } from "../extensions/autocomplete";
import { symbolWrapExtension } from "../extensions/symbolWrap";
import { livePreviewExtension, togglePreviewEffect, previewModeField } from "../extensions/livePreview";
import { lintingExtension, autofixContent } from "../extensions/linting";
import { lintKeymap } from "@codemirror/lint";
import { openFileInEditor } from "../lib/openFile";
import { renameFile } from "../lib/fileOps";
import { getAutoSaveMs, setRemeasureHook, isAutofixOnSave } from "../lib/configBridge";

// ---------------------------------------------------------------------------
// Module-level caches
// ---------------------------------------------------------------------------

/** Full EditorState snapshots — preserves undo history, selections, etc. */
const editorStateCache = new Map<string, EditorState>();

/** Scroll positions per tab */
const scrollCache = new Map<string, number>();

/** Last-saved content strings — used for dirty detection */
const lastSavedContent = new Map<string, string>();

/**
 * Mutable ref for active tab id — the updateListener closure reads this
 * to know which tab is currently active, avoiding stale closure captures.
 * Stored as an object so closures capture the reference, not the value.
 */
const activeTabIdBox = { current: null as string | null };

/** Module-level reference to the live EditorView for external content updates */
let _liveViewRef: EditorView | null = null;

/** Get the current live EditorView (for command palette table commands, etc.) */
export function getEditorView(): EditorView | null {
  return _liveViewRef;
}

// ---------------------------------------------------------------------------
// Shared styles and highlight
// ---------------------------------------------------------------------------

const onyxHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", color: "var(--text-primary)", fontWeight: "600" },
  { tag: tags.heading2, fontSize: "1.3em", color: "var(--text-primary)", fontWeight: "600" },
  { tag: tags.heading3, fontSize: "1.1em", color: "var(--text-primary)", fontWeight: "600" },
  { tag: tags.heading4, color: "var(--text-primary)", fontWeight: "600" },
  { tag: tags.heading5, color: "var(--text-primary)", fontWeight: "600" },
  { tag: tags.heading6, color: "var(--text-primary)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", background: "var(--bg-elevated)" },
  { tag: tags.link, color: "var(--link-color)" },
  { tag: tags.url, color: "var(--link-color)" },
  { tag: tags.quote, color: "var(--text-tertiary)", fontStyle: "italic" },
  { tag: tags.strikethrough, color: "var(--syntax-strikethrough)", textDecoration: "line-through" },
  { tag: tags.meta, color: "var(--syntax-meta)" },
  { tag: tags.comment, color: "var(--syntax-comment)" },
  { tag: tags.contentSeparator, color: "var(--syntax-hr)" },

  { tag: tags.processingInstruction, color: "var(--syntax-markup)" },
]);

const onyxTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-base)",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "var(--accent-muted) !important",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    background: "var(--bg-surface)",
    borderRight: "1px solid var(--border-subtle)",
    color: "var(--text-tertiary)",
  },
  ".cm-activeLineGutter": {
    background: "transparent",
  },
  ".cm-activeLine": {
    background: "var(--bg-hover)",
  },
});

// ---------------------------------------------------------------------------
// Extensions builder
// ---------------------------------------------------------------------------

/**
 * Module-level save timer — avoids coupling a React ref into the extensions.
 * The extensions are built once and live for the app lifetime, so a module-level
 * mutable is the right scope.
 */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function buildExtensions(): Extension[] {
  const updateListener = EditorView.updateListener.of((update) => {
    const tabId = activeTabIdBox.current;
    if (!tabId) return;

    const { setCursorInfo, setModified, setWordCount, setCharCount } = useAppStore.getState();

    // Cursor position — always update (cheap)
    const pos = update.state.selection.main.head;
    const line = update.state.doc.lineAt(pos);
    setCursorInfo(line.number, pos - line.from + 1);

    if (update.docChanged) {
      const content = update.state.doc.toString();
      const saved = lastSavedContent.get(tabId) ?? "";
      const isModified = content !== saved;
      setModified(tabId, isModified);

      // Word count + char count
      const words = content.trim() ? content.trim().split(/\s+/).length : 0;
      setWordCount(words);
      setCharCount(content.length);

      // Debounced auto-save
      clearTimeout(saveTimer);
      if (isModified) {
        const tab = useAppStore.getState().tabs.find((t) => t.id === tabId);
        if (tab) {
          saveTimer = setTimeout(async () => {
            try {
              let saveContent = content;
              if (isAutofixOnSave()) {
                const fixed = autofixContent(content);
                if (fixed !== content) {
                  saveContent = fixed;
                  // Update editor state with fixed content
                  const view = _liveViewRef;
                  if (view && activeTabIdBox.current === tabId) {
                    view.dispatch({
                      changes: { from: 0, to: view.state.doc.length, insert: fixed },
                    });
                  }
                }
              }
              await invoke("write_file", { path: tab.path, content: saveContent });
              lastSavedContent.set(tabId, saveContent);
              setModified(tabId, false);
              useAppStore.getState().bumpSaveVersion();
              // Clear conflict if save succeeds for this path
              if (useAppStore.getState().saveConflictPath === tab.path) {
                useAppStore.getState().setSaveConflictPath(null);
              }
            } catch (err) {
              const msg = String(err);
              if (msg.includes("CONFLICT:")) {
                useAppStore.getState().setSaveConflictPath(tab.path);
              }
              console.error("Failed to save:", err);
            }
          }, getAutoSaveMs());
        }
      }
    }
  });

  // Cmd+/ must be intercepted before defaultKeymap (which binds toggleComment)
  const editorModeKeymap = keymap.of([
    {
      key: "Mod-/",
      run: () => {
        const { activeTabId, toggleEditorMode } = useAppStore.getState();
        if (activeTabId) toggleEditorMode(activeTabId);
        return true;
      },
    },
  ]);

  return [
    editorModeKeymap,
    keymap.of(formattingKeymap),
    // Table keybindings — must precede outliner so Tab/Enter are
    // handled by table navigation when cursor is inside a table.
    // Order: editorMode → formatting → table → outliner → defaults
    ...tableEditorExtension(),
    keymap.of(outlinerKeymap),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
    ]),
    history(),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(onyxHighlightStyle),
    codeFolding(),
    foldGutter(),
    lineNumbers(),
    onyxTheme,
    EditorView.lineWrapping,
    updateListener,
    frontmatterExtension(),
    wikilinkExtension(),
    tagExtension(),
    urlPasteExtension,
    autocompleteExtension(),
    symbolWrapExtension(),
    livePreviewExtension(),
    keymap.of(lintKeymap),
    ...lintingExtension(),
  ];
}

// ---------------------------------------------------------------------------
// Public API — used by openFile / Sidebar
// ---------------------------------------------------------------------------

/** Shared extensions ref — initialized on first Editor mount */
let sharedExtensions: Extension[] | null = null;

/** Create an EditorState with the shared extensions */
function createStateWithExtensions(doc: string): EditorState {
  if (!sharedExtensions) {
    // Fallback: create minimal state. This shouldn't happen in practice
    // because loadFileIntoCache is called after Editor mounts.
    return EditorState.create({ doc });
  }
  return EditorState.create({ doc, extensions: sharedExtensions });
}

/** Seed content into the editor cache before opening a tab */
export function loadFileIntoCache(id: string, content: string) {
  editorStateCache.set(id, createStateWithExtensions(content));
  lastSavedContent.set(id, content);
}

/**
 * Replace the document content for a tab after an external write (e.g. frontmatter update).
 * Updates the cache, the live view if it's the active tab, and the saved-content tracker.
 */
export function replaceTabContent(tabId: string, newContent: string) {
  const cached = editorStateCache.get(tabId);
  if (cached) {
    const tr = cached.update({
      changes: { from: 0, to: cached.doc.length, insert: newContent },
    });
    editorStateCache.set(tabId, tr.state);
  }
  lastSavedContent.set(tabId, newContent);

  // If this tab is currently displayed, update the live view too
  if (activeTabIdBox.current === tabId && _liveViewRef) {
    _liveViewRef.dispatch({
      changes: { from: 0, to: _liveViewRef.state.doc.length, insert: newContent },
    });
  }

  useAppStore.getState().setModified(tabId, false);
}

/** Migrate editor caches from one path key to another (used by rename) */
export function migrateEditorCache(oldPath: string, newPath: string) {
  const state = editorStateCache.get(oldPath);
  if (state) {
    editorStateCache.set(newPath, state);
    editorStateCache.delete(oldPath);
  }
  const saved = lastSavedContent.get(oldPath);
  if (saved !== undefined) {
    lastSavedContent.set(newPath, saved);
    lastSavedContent.delete(oldPath);
  }
  const scroll = scrollCache.get(oldPath);
  if (scroll !== undefined) {
    scrollCache.set(newPath, scroll);
    scrollCache.delete(oldPath);
  }
}

/** Remove all editor caches for a path (used by delete) */
export function clearEditorCache(path: string) {
  editorStateCache.delete(path);
  lastSavedContent.delete(path);
  scrollCache.delete(path);
  clearAutoFoldForTab(path);
}

/** Toggle frontmatter fold in the active editor (for command palette) */
export function foldFrontmatter(): boolean {
  if (!_liveViewRef) return false;
  return toggleFrontmatterFoldCommand(_liveViewRef);
}

/** Insert text at the current cursor position in the live editor */
export function insertAtCursor(text: string) {
  if (!_liveViewRef) return;
  const pos = _liveViewRef.state.selection.main.head;
  _liveViewRef.dispatch({
    changes: { from: pos, to: pos, insert: text },
    selection: EditorSelection.cursor(pos + text.length),
  });
  _liveViewRef.focus();
}

/** Scroll the live editor to a character position and place the cursor there */
export function scrollToPosition(from: number) {
  if (!_liveViewRef) return;
  _liveViewRef.dispatch({
    selection: EditorSelection.cursor(from),
    scrollIntoView: true,
  });
  _liveViewRef.focus();
}

/** Apply fix-all: run autofixContent on the current document */
export function applyLintFixAll() {
  if (!_liveViewRef) return;
  const content = _liveViewRef.state.doc.toString();
  const fixed = autofixContent(content);
  if (fixed !== content) {
    _liveViewRef.dispatch({
      changes: { from: 0, to: _liveViewRef.state.doc.length, insert: fixed },
    });
  }
  _liveViewRef.focus();
}

/** Flush any pending save for a tab (called before closing) */
export async function flushSaveForTab(id: string): Promise<void> {
  const state = editorStateCache.get(id);
  if (!state) return;

  const content = state.doc.toString();
  const saved = lastSavedContent.get(id);
  if (content !== saved) {
    const tab = useAppStore.getState().tabs.find((t) => t.id === id);
    if (tab) {
      try {
        await invoke("write_file", { path: tab.path, content });
        lastSavedContent.set(id, content);
        useAppStore.getState().setModified(id, false);
      } catch (err) {
        console.error("Failed to flush save for tab:", err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** Tracks which tab the EditorView is currently showing */
  const viewTabIdRef = useRef<string | null>(null);

  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const editorMode = activeTab?.editorMode ?? "source";

  // Initialize shared extensions once
  if (!sharedExtensions) {
    sharedExtensions = buildExtensions();
  }

  // Register hooks so closeTab can snapshot + flush
  useEffect(() => {
    setSnapshotEditorHook((id: string) => {
      if (viewRef.current && viewTabIdRef.current === id) {
        editorStateCache.set(id, viewRef.current.state);
        scrollCache.set(id, viewRef.current.scrollDOM.scrollTop);
      }
    });
    setFlushSaveHook(flushSaveForTab);
    setRemeasureHook(() => {
      if (viewRef.current) viewRef.current.requestMeasure();
    });

    // Wire wikilink follow: resolve via Rust, then open the target file
    wikilinkFollowRef.current = async (link: string, newTab: boolean) => {
      const currentTab = useAppStore.getState().tabs.find(
        (t) => t.id === activeTabIdBox.current
      );
      if (!currentTab) return;
      try {
        const resolved = await invoke<string | null>("resolve_wikilink", {
          link,
          contextPath: currentTab.path,
        });
        if (resolved) {
          const name = resolved.split("/").pop() || resolved;
          await openFileInEditor(resolved, name, { replaceActive: !newTab });
        }
      } catch (err) {
        console.error("Failed to resolve wikilink:", err);
      }
    };

    return () => {
      setSnapshotEditorHook(() => {});
      setFlushSaveHook(async () => {});
      wikilinkFollowRef.current = null;
    };
  }, []);

  // Create or swap the EditorView when the active tab changes
  useEffect(() => {
    // Update the mutable ref immediately so the updateListener knows which tab is active.
    // Must happen before any editor operations in this effect.
    activeTabIdBox.current = activeTabId;

    if (!containerRef.current || !activeTab) return;

    // --- Save current tab state before switching ---
    if (viewRef.current && viewTabIdRef.current && viewTabIdRef.current !== activeTab.id) {
      editorStateCache.set(viewTabIdRef.current, viewRef.current.state);
      scrollCache.set(viewTabIdRef.current, viewRef.current.scrollDOM.scrollTop);
    }

    // --- Get or create EditorState for the new tab ---
    let state = editorStateCache.get(activeTab.id);
    if (state) {
      // Check if state was created without extensions (by loadFileIntoCache
      // before sharedExtensions were initialized). If so, rebuild with extensions.
      // We detect this by checking if the state has fewer extensions facets.
      // A simple heuristic: if the state has no keymaps configured, it's bare.
      try {
        const hasKeymap = state.facet(keymap).length > 0;
        if (!hasKeymap) {
          state = createStateWithExtensions(state.doc.toString());
          editorStateCache.set(activeTab.id, state);
        }
      } catch {
        // Facet check failed — rebuild to be safe
        state = createStateWithExtensions(state.doc.toString());
        editorStateCache.set(activeTab.id, state);
      }
    } else {
      state = createStateWithExtensions("");
      editorStateCache.set(activeTab.id, state);
    }

    // Tell the frontmatter plugin which tab is being shown so it can
    // track auto-fold state per tab instead of per document content.
    frontmatterTabRef.current = activeTab.id;

    if (viewRef.current && viewRef.current.dom.parentElement === containerRef.current) {
      // View exists in the current container — swap state (preserves the DOM element)
      viewRef.current.setState(state);
    } else {
      // No view, or view is attached to a stale container (e.g. after closing
      // all tabs removed the editor-container div from the DOM). Destroy the
      // orphaned view and create a fresh one in the current container.
      if (viewRef.current) {
        viewRef.current.destroy();
      }
      viewRef.current = new EditorView({
        state,
        parent: containerRef.current,
      });
    }

    _liveViewRef = viewRef.current;
    viewTabIdRef.current = activeTab.id;

    // Sync preview mode state
    const wantPreview = activeTab.editorMode === "preview";
    const currentPreview = viewRef.current.state.field(previewModeField);
    if (currentPreview !== wantPreview) {
      viewRef.current.dispatch({ effects: togglePreviewEffect.of(wantPreview) });
    }

    // Restore scroll position (deferred so layout is complete)
    const savedScroll = scrollCache.get(activeTab.id);
    requestAnimationFrame(() => {
      if (viewRef.current) {
        viewRef.current.scrollDOM.scrollTop = savedScroll ?? 0;
      }
    });

    viewRef.current.focus();

    // Initial word count + cursor info
    const doc = viewRef.current.state.doc;
    const content = doc.toString();
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    useAppStore.getState().setWordCount(words);
    useAppStore.getState().setCharCount(content.length);

    const pos = viewRef.current.state.selection.main.head;
    const line = doc.lineAt(pos);
    useAppStore.getState().setCursorInfo(line.number, pos - line.from + 1);

    return () => {
      clearTimeout(saveTimer);
    };
  }, [activeTab?.id, activeTab?.path]); // eslint-disable-line -- CM6 manages its own state

  // Destroy the view on unmount, saving state first
  useEffect(() => {
    return () => {
      if (viewRef.current) {
        if (viewTabIdRef.current) {
          editorStateCache.set(viewTabIdRef.current, viewRef.current.state);
          scrollCache.set(viewTabIdRef.current, viewRef.current.scrollDOM.scrollTop);
        }
        viewRef.current.destroy();
        viewRef.current = null;
        _liveViewRef = null;
      }
    };
  }, []);

  // Sync live preview mode when editorMode changes
  useEffect(() => {
    if (!viewRef.current) return;
    const isPreview = editorMode === "preview";
    const current = viewRef.current.state.field(previewModeField);
    if (current !== isPreview) {
      viewRef.current.dispatch({ effects: togglePreviewEffect.of(isPreview) });
    }
  }, [editorMode]);

  // Clean up caches when tabs close — read live store state to avoid
  // stale-closure races (e.g. when a tab is opened immediately after
  // closing the last tab, the effect from the empty-tabs render would
  // otherwise wipe the cache entry that loadFileIntoCache just added).
  useEffect(() => {
    const currentTabs = useAppStore.getState().tabs;
    const tabIds = new Set(currentTabs.map((t) => t.id));
    for (const key of editorStateCache.keys()) {
      if (!tabIds.has(key)) {
        editorStateCache.delete(key);
        scrollCache.delete(key);
        lastSavedContent.delete(key);
        clearAutoFoldForTab(key);
      }
    }
  }, [tabs]);

  // Inline title — editable, renames file on change
  const [titleValue, setTitleValue] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  // Sync title when active tab changes
  useEffect(() => {
    if (activeTab) {
      setTitleValue(activeTab.name.replace(/\.md$/, ""));
    }
  }, [activeTab?.id, activeTab?.name]); // eslint-disable-line

  const handleTitleCommit = useCallback(async () => {
    const tab = useAppStore.getState().tabs.find(
      (t) => t.id === useAppStore.getState().activeTabId
    );
    if (!tab) return;
    const trimmed = titleValue.trim().replace(/[/\0:]/g, "");
    const oldName = tab.name.replace(/\.md$/, "");
    if (!trimmed || trimmed === oldName) {
      setTitleValue(oldName);
      return;
    }
    const dir = tab.path.substring(0, tab.path.lastIndexOf("/"));
    const newPath = `${dir}/${trimmed}.md`;
    try {
      await renameFile(tab.path, newPath);
    } catch (err) {
      console.error("Failed to rename:", err);
      setTitleValue(oldName);
    }
  }, [titleValue]);

  if (!activeTab) {
    return (
      <div className="editor-area">
        <div className="editor-empty">Open a file to start editing</div>
      </div>
    );
  }

  const modeClass = activeTab.editorMode === "source" ? "source-mode" : "preview-mode";

  return (
    <div className="editor-area">
      <input
        ref={titleRef}
        className="editor-inline-title"
        value={titleValue}
        onChange={(e) => setTitleValue(e.target.value)}
        onBlur={handleTitleCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            titleRef.current?.blur();
          }
          if (e.key === "Escape") {
            const tab = useAppStore.getState().tabs.find(
              (t) => t.id === useAppStore.getState().activeTabId
            );
            setTitleValue(tab?.name.replace(/\.md$/, "") ?? "");
            titleRef.current?.blur();
          }
        }}
        spellCheck={false}
      />
      <div className={`editor-container ${modeClass}`} ref={containerRef} />
    </div>
  );
}
