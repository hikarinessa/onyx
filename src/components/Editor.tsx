import { useEffect, useRef } from "react";
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
import { frontmatterExtension, frontmatterTabRef, clearAutoFoldForTab, foldFrontmatterCommand } from "../extensions/frontmatter";
import { wikilinkExtension, wikilinkFollowRef } from "../extensions/wikilinks";
import { tagExtension } from "../extensions/tags";
import { formattingKeymap } from "../extensions/formatting";
import { outlinerKeymap } from "../extensions/outliner";
import { urlPasteExtension } from "../extensions/urlPaste";
import { autocompleteExtension } from "../extensions/autocomplete";
import { symbolWrapExtension } from "../extensions/symbolWrap";
import { livePreviewExtension, togglePreviewEffect, previewModeField } from "../extensions/livePreview";
import { openFileInEditor } from "../lib/openFile";

const SAVE_DEBOUNCE_MS = 500;

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
              await invoke("write_file", { path: tab.path, content });
              lastSavedContent.set(tabId, content);
              setModified(tabId, false);
              useAppStore.getState().bumpSaveVersion();
            } catch (err) {
              console.error("Failed to save:", err);
            }
          }, SAVE_DEBOUNCE_MS);
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
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
      ...formattingKeymap,
      ...outlinerKeymap,
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

/** Fold frontmatter in the active editor (for command palette) */
export function foldFrontmatter(): boolean {
  if (!_liveViewRef) return false;
  return foldFrontmatterCommand(_liveViewRef);
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

    // Wire wikilink follow: resolve via Rust, then open the target file
    wikilinkFollowRef.current = async (link: string) => {
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
          await openFileInEditor(resolved, name);
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

    if (viewRef.current) {
      // View exists — swap state (preserves the DOM element)
      viewRef.current.setState(state);
    } else {
      // First tab ever — create the EditorView
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
    if (savedScroll !== undefined) {
      requestAnimationFrame(() => {
        if (viewRef.current) {
          viewRef.current.scrollDOM.scrollTop = savedScroll;
        }
      });
    }

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

  // Clean up caches when tabs close
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id));
    for (const key of editorStateCache.keys()) {
      if (!tabIds.has(key)) {
        editorStateCache.delete(key);
        scrollCache.delete(key);
        lastSavedContent.delete(key);
        clearAutoFoldForTab(key);
      }
    }
  }, [tabs]);

  if (!activeTab) {
    return (
      <div className="editor-area">
        <div className="editor-empty">Open a file to start editing</div>
      </div>
    );
  }

  const modeClass = editorMode === "source" ? "source-mode" : "preview-mode";

  return (
    <div className="editor-area">
      <div className={`editor-container ${modeClass}`} ref={containerRef} />
    </div>
  );
}
