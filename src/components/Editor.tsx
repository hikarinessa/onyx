import { useEffect, useRef, useCallback, useState } from "react";
import { EditorState, EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
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
import { lintingExtension, autoFixOnSave } from "../extensions/linting";
import { openFileInEditor } from "../lib/openFile";
import {
  editorStateCache,
  scrollCache,
  lastSavedContent,
  sharedExtensionsRef,
  createStateWithExtensions,
} from "./editorShared";

const SAVE_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * Mutable ref for active tab id — the updateListener closure reads this
 * to know which tab is currently active, avoiding stale closure captures.
 */
const activeTabIdBox = { current: null as string | null };

/** Module-level reference to the live EditorView for external content updates */
let _liveViewRef: EditorView | null = null;

/** Module-level save timer */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

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
              const fixed = autoFixOnSave(content);
              await invoke("write_file", { path: tab.path, content: fixed });
              lastSavedContent.set(tabId, fixed);
              // If autofix changed content, sync the editor state
              if (fixed !== content && _liveViewRef && activeTabIdBox.current === tabId) {
                _liveViewRef.dispatch({
                  changes: { from: 0, to: _liveViewRef.state.doc.length, insert: fixed },
                });
              }
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

  return [
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
    lintingExtension(),
  ];
}

// ---------------------------------------------------------------------------
// Public API — used by openFile / Sidebar
// ---------------------------------------------------------------------------

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

/** Scroll the live editor to a specific line number */
export function scrollToLine(lineNumber: number) {
  if (!_liveViewRef) return;
  const doc = _liveViewRef.state.doc;
  if (lineNumber < 1 || lineNumber > doc.lines) return;
  const line = doc.line(lineNumber);
  _liveViewRef.dispatch({
    selection: EditorSelection.cursor(line.from),
    effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 50 }),
  });
  _liveViewRef.focus();
}

/** Fold frontmatter in the live editor (for command palette) */
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
        const fixed = autoFixOnSave(content);
        await invoke("write_file", { path: tab.path, content: fixed });
        lastSavedContent.set(id, fixed);
        useAppStore.getState().setModified(id, false);
      } catch (err) {
        console.error("Failed to flush save for tab:", err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers: swap editor state into a view
// ---------------------------------------------------------------------------

function swapViewToTab(view: EditorView, tabId: string, editorMode: string) {
  let state = editorStateCache.get(tabId);
  if (state) {
    try {
      const hasKm = state.facet(keymap).length > 0;
      if (!hasKm) {
        state = createStateWithExtensions(state.doc.toString());
        editorStateCache.set(tabId, state);
      }
    } catch {
      state = createStateWithExtensions(state.doc.toString());
      editorStateCache.set(tabId, state);
    }
  } else {
    state = createStateWithExtensions("");
    editorStateCache.set(tabId, state);
  }

  frontmatterTabRef.current = tabId;
  view.setState(state);

  // Sync preview mode
  const wantPreview = editorMode === "preview";
  const currentPreview = view.state.field(previewModeField);
  if (currentPreview !== wantPreview) {
    view.dispatch({ effects: togglePreviewEffect.of(wantPreview) });
  }

  // Restore scroll
  const savedScroll = scrollCache.get(tabId);
  if (savedScroll !== undefined) {
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = savedScroll;
    });
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rightContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const rightViewRef = useRef<EditorView | null>(null);
  /** Tracks which tab the left EditorView is currently showing */
  const viewTabIdRef = useRef<string | null>(null);
  const rightViewTabIdRef = useRef<string | null>(null);

  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const editorMode = activeTab?.editorMode ?? "source";
  const paneLayout = useAppStore((s) => s.paneLayout);

  // Draggable divider state
  const [dragging, setDragging] = useState(false);

  // Initialize shared extensions once
  if (!sharedExtensionsRef.current) {
    sharedExtensionsRef.current = buildExtensions();
  }

  // Register hooks so closeTab can snapshot + flush
  useEffect(() => {
    setSnapshotEditorHook((id: string) => {
      if (viewRef.current && viewTabIdRef.current === id) {
        editorStateCache.set(id, viewRef.current.state);
        scrollCache.set(id, viewRef.current.scrollDOM.scrollTop);
      }
      if (rightViewRef.current && rightViewTabIdRef.current === id) {
        editorStateCache.set(id, rightViewRef.current.state);
        scrollCache.set(id, rightViewRef.current.scrollDOM.scrollTop);
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
    activeTabIdBox.current = activeTabId;

    if (!containerRef.current || !activeTab) return;

    // Save current tab state before switching
    if (viewRef.current && viewTabIdRef.current && viewTabIdRef.current !== activeTab.id) {
      editorStateCache.set(viewTabIdRef.current, viewRef.current.state);
      scrollCache.set(viewTabIdRef.current, viewRef.current.scrollDOM.scrollTop);
    }

    if (viewRef.current) {
      swapViewToTab(viewRef.current, activeTab.id, activeTab.editorMode);
    } else {
      let state = editorStateCache.get(activeTab.id);
      if (!state) {
        state = createStateWithExtensions("");
        editorStateCache.set(activeTab.id, state);
      }
      viewRef.current = new EditorView({
        state,
        parent: containerRef.current,
      });
      swapViewToTab(viewRef.current, activeTab.id, activeTab.editorMode);
    }

    _liveViewRef = viewRef.current;
    viewTabIdRef.current = activeTab.id;

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

  // Handle right pane in split mode
  useEffect(() => {
    if (paneLayout.type !== "split" || !paneLayout.rightActiveTabId) {
      // Clean up right pane view
      if (rightViewRef.current) {
        if (rightViewTabIdRef.current) {
          editorStateCache.set(rightViewTabIdRef.current, rightViewRef.current.state);
          scrollCache.set(rightViewTabIdRef.current, rightViewRef.current.scrollDOM.scrollTop);
        }
        rightViewRef.current.destroy();
        rightViewRef.current = null;
        rightViewTabIdRef.current = null;
      }
      return;
    }

    if (!rightContainerRef.current) return;

    const rightTabId = paneLayout.rightActiveTabId;
    const rightTab = tabs.find((t) => t.id === rightTabId);
    if (!rightTab) return;

    // Save state of previous right tab
    if (rightViewRef.current && rightViewTabIdRef.current && rightViewTabIdRef.current !== rightTabId) {
      editorStateCache.set(rightViewTabIdRef.current, rightViewRef.current.state);
      scrollCache.set(rightViewTabIdRef.current, rightViewRef.current.scrollDOM.scrollTop);
    }

    if (rightViewRef.current) {
      swapViewToTab(rightViewRef.current, rightTabId, rightTab.editorMode);
    } else {
      let state = editorStateCache.get(rightTabId);
      if (!state) {
        state = createStateWithExtensions("");
        editorStateCache.set(rightTabId, state);
      }
      rightViewRef.current = new EditorView({
        state,
        parent: rightContainerRef.current,
      });
      swapViewToTab(rightViewRef.current, rightTabId, rightTab.editorMode);
    }

    rightViewTabIdRef.current = rightTabId;

    // Update _liveViewRef based on active pane
    if (paneLayout.activePaneId === "right") {
      _liveViewRef = rightViewRef.current;
      activeTabIdBox.current = rightTabId;
    }
  }, [paneLayout.type, paneLayout.rightActiveTabId, paneLayout.activePaneId]);

  // Sync live preview mode when editorMode changes
  useEffect(() => {
    if (!viewRef.current) return;
    const isPreview = editorMode === "preview";
    const current = viewRef.current.state.field(previewModeField);
    if (current !== isPreview) {
      viewRef.current.dispatch({
        effects: togglePreviewEffect.of(isPreview),
      });
    }
  }, [editorMode]);

  // Destroy views on unmount
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
      if (rightViewRef.current) {
        if (rightViewTabIdRef.current) {
          editorStateCache.set(rightViewTabIdRef.current, rightViewRef.current.state);
          scrollCache.set(rightViewTabIdRef.current, rightViewRef.current.scrollDOM.scrollTop);
        }
        rightViewRef.current.destroy();
        rightViewRef.current = null;
      }
    };
  }, []);

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

  // Draggable divider handlers
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startRatio = paneLayout.splitRatio;

    const handleMouseMove = (ev: MouseEvent) => {
      const editorArea = (e.target as HTMLElement).closest(".editor-area");
      if (!editorArea) return;
      const rect = editorArea.getBoundingClientRect();
      const dx = ev.clientX - startX;
      const newRatio = Math.min(0.8, Math.max(0.2, startRatio + dx / rect.width));
      useAppStore.getState().setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [paneLayout.splitRatio]);

  // Handle pane activation clicks
  const handleLeftClick = useCallback(() => {
    if (paneLayout.type === "split" && paneLayout.activePaneId !== "left") {
      useAppStore.getState().setActivePaneId("left");
      if (paneLayout.leftActiveTabId) {
        useAppStore.getState().setActiveTab(paneLayout.leftActiveTabId);
        activeTabIdBox.current = paneLayout.leftActiveTabId;
        _liveViewRef = viewRef.current;
      }
    }
  }, [paneLayout]);

  const handleRightClick = useCallback(() => {
    if (paneLayout.type === "split" && paneLayout.activePaneId !== "right") {
      useAppStore.getState().setActivePaneId("right");
      if (paneLayout.rightActiveTabId) {
        useAppStore.getState().setActiveTab(paneLayout.rightActiveTabId);
        activeTabIdBox.current = paneLayout.rightActiveTabId;
        _liveViewRef = rightViewRef.current;
      }
    }
  }, [paneLayout]);

  if (!activeTab) {
    return (
      <div className="editor-area">
        <div className="editor-empty">Open a file to start editing</div>
      </div>
    );
  }

  if (paneLayout.type === "split") {
    return (
      <div className={`editor-area editor-split ${dragging ? "dragging" : ""}`}>
        <div
          className={`editor-pane ${paneLayout.activePaneId === "left" ? "active-pane" : ""}`}
          style={{ flexBasis: `${paneLayout.splitRatio * 100}%` }}
          onClick={handleLeftClick}
        >
          <div className="editor-container" ref={containerRef} />
        </div>
        <div
          className="editor-divider"
          onMouseDown={handleDividerMouseDown}
        />
        <div
          className={`editor-pane ${paneLayout.activePaneId === "right" ? "active-pane" : ""}`}
          style={{ flexBasis: `${(1 - paneLayout.splitRatio) * 100}%` }}
          onClick={handleRightClick}
        >
          <div className="editor-container" ref={rightContainerRef} />
        </div>
      </div>
    );
  }

  return (
    <div className="editor-area">
      <div className="editor-container" ref={containerRef} />
    </div>
  );
}
