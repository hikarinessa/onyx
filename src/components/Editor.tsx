import { useEffect, useRef, useCallback, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
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
import { TabBar } from "./TabBar";
import { setLiveViewRef, getLiveViewRef, flushSaveForTab, registerViewForTab, unregisterViewForTab } from "../lib/editorBridge";
import { frontmatterExtension, frontmatterTabRef, clearAutoFoldForTab } from "../extensions/frontmatter";
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
 * Mutable ref for active tab id — used by external API functions
 * (scrollToLine, insertAtCursor, etc.) to know the current tab.
 */
const activeTabIdBox = { current: null as string | null };

/** Maps each EditorView to the tab ID it's currently displaying */
const viewTabIdMap = new WeakMap<EditorView, string>();

/** Per-tab save timers — prevents cross-pane cancellation in split mode */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Per-tab word count timers */
const wordCountTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

function buildExtensions(): Extension[] {
  const updateListener = EditorView.updateListener.of((update) => {
    const tabId = viewTabIdMap.get(update.view);
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

      // Debounced word count + char count (avoid allocating on every keystroke)
      clearTimeout(wordCountTimers.get(tabId));
      wordCountTimers.set(tabId, setTimeout(() => {
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        setWordCount(words);
        setCharCount(content.length);
        wordCountTimers.delete(tabId);
      }, 300));

      // Debounced auto-save (per-tab timer prevents cross-pane cancellation)
      clearTimeout(saveTimers.get(tabId));
      if (isModified) {
        const tab = useAppStore.getState().tabs.find((t) => t.id === tabId);
        if (tab) {
          // Capture the view ref now — don't rely on getLiveViewRef() after await
          const sourceView = update.view;
          saveTimers.set(tabId, setTimeout(async () => {
            saveTimers.delete(tabId);
            try {
              const fixed = autoFixOnSave(content);
              await invoke("write_file", { path: tab.path, content: fixed });
              lastSavedContent.set(tabId, fixed);
              // If autofix changed content, sync back to the originating view
              if (fixed !== content && viewTabIdMap.get(sourceView) === tabId) {
                sourceView.dispatch({
                  changes: { from: 0, to: sourceView.state.doc.length, insert: fixed },
                });
              }
              setModified(tabId, false);
              useAppStore.getState().bumpSaveVersion();
            } catch (err) {
              console.error("Failed to save:", err);
            }
          }, SAVE_DEBOUNCE_MS));
        }
      }
    }
  });

  // Cmd+/ must be intercepted before defaultKeymap (which binds toggleComment)
  // Use viewTabIdMap to toggle the correct pane's tab, not the global activeTabId
  const editorModeKeymap = keymap.of([
    {
      key: "Mod-/",
      run: (view) => {
        const tabId = viewTabIdMap.get(view);
        if (tabId) useAppStore.getState().toggleEditorMode(tabId);
        return true;
      },
    },
  ]);

  return [
    editorModeKeymap, // must come before defaultKeymap
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
    lintingExtension(),
  ];
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
  viewTabIdMap.set(view, tabId);
  registerViewForTab(tabId, view);
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

  const tabs = useAppStore((s) => s.tabs);
  const paneLayout = useAppStore((s) => s.paneLayout);
  const globalActiveTabId = useAppStore((s) => s.activeTabId);

  // Derive per-pane tab IDs. In single mode, left pane shows activeTabId.
  const leftActiveTabId = paneLayout.type === "split"
    ? paneLayout.leftActiveTabId
    : globalActiveTabId;
  const rightActiveTabId = paneLayout.type === "split"
    ? paneLayout.rightActiveTabId
    : null;

  const leftTab = tabs.find((t) => t.id === leftActiveTabId);
  const rightTab = tabs.find((t) => t.id === rightActiveTabId);

  const leftEditorMode = leftTab?.editorMode ?? "source";
  const rightEditorMode = rightTab?.editorMode ?? "source";

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
    // Normal click → follow in current tab
    // Cmd+click → newTab
    // Cmd+Opt+click → split
    wikilinkFollowRef.current = async (link: string, opts?: { newTab?: boolean; split?: boolean }) => {
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
          if (opts?.split) {
            // Load content into cache first, then split
            const content = await invoke<string>("read_file", { path: resolved });
            const { loadFileIntoCache } = await import("../lib/editorBridge");
            loadFileIntoCache(resolved, content);
            useAppStore.getState().splitPane(resolved, name);
          } else if (opts?.newTab) {
            // Open in a new tab (don't replace current)
            await openFileInEditor(resolved, name);
          } else {
            // Follow in current tab (replace current tab content)
            await openFileInEditor(resolved, name);
          }
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

  // Create or swap the left EditorView when left tab changes
  useEffect(() => {
    if (!containerRef.current || !leftTab) return;

    // Update activeTabIdBox for the active pane
    if (paneLayout.type === "single" || paneLayout.activePaneId === "left") {
      activeTabIdBox.current = leftTab.id;
    }

    // Save current tab state before switching
    if (viewRef.current && viewTabIdRef.current && viewTabIdRef.current !== leftTab.id) {
      editorStateCache.set(viewTabIdRef.current, viewRef.current.state);
      scrollCache.set(viewTabIdRef.current, viewRef.current.scrollDOM.scrollTop);
    }

    if (viewRef.current) {
      swapViewToTab(viewRef.current, leftTab.id, leftTab.editorMode);
    } else {
      let state = editorStateCache.get(leftTab.id);
      if (!state) {
        state = createStateWithExtensions("");
        editorStateCache.set(leftTab.id, state);
      }
      viewRef.current = new EditorView({
        state,
        parent: containerRef.current,
      });
      swapViewToTab(viewRef.current, leftTab.id, leftTab.editorMode);
    }

    if (paneLayout.type === "single" || paneLayout.activePaneId === "left") {
      setLiveViewRef(viewRef.current);
    }
    viewTabIdRef.current = leftTab.id;

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
      // Don't clear per-tab timers here — they need to fire even after tab switch
    };
  }, [leftActiveTabId, leftTab?.path]); // eslint-disable-line -- CM6 manages its own state

  // Handle right pane in split mode
  useEffect(() => {
    if (paneLayout.type !== "split" || !paneLayout.rightActiveTabId) {
      // Clean up right pane view
      if (rightViewRef.current) {
        if (rightViewTabIdRef.current) {
          editorStateCache.set(rightViewTabIdRef.current, rightViewRef.current.state);
          scrollCache.set(rightViewTabIdRef.current, rightViewRef.current.scrollDOM.scrollTop);
          unregisterViewForTab(rightViewTabIdRef.current);
        }
        rightViewRef.current.destroy();
        rightViewRef.current = null;
        rightViewTabIdRef.current = null;
      }
      return;
    }

    if (!rightContainerRef.current) return;

    const rightTabId = paneLayout.rightActiveTabId;
    const rTab = tabs.find((t) => t.id === rightTabId);
    if (!rTab) return;

    // Save state of previous right tab
    if (rightViewRef.current && rightViewTabIdRef.current && rightViewTabIdRef.current !== rightTabId) {
      editorStateCache.set(rightViewTabIdRef.current, rightViewRef.current.state);
      scrollCache.set(rightViewTabIdRef.current, rightViewRef.current.scrollDOM.scrollTop);
    }

    if (rightViewRef.current) {
      swapViewToTab(rightViewRef.current, rightTabId, rTab.editorMode);
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
      swapViewToTab(rightViewRef.current, rightTabId, rTab.editorMode);
    }

    rightViewTabIdRef.current = rightTabId;

    // Update _liveViewRef based on active pane
    if (paneLayout.activePaneId === "right") {
      setLiveViewRef(rightViewRef.current);
      activeTabIdBox.current = rightTabId;
    }
  }, [paneLayout.type, paneLayout.rightActiveTabId, paneLayout.activePaneId]);

  // Sync live preview mode when editorMode changes for left pane
  useEffect(() => {
    if (!viewRef.current) return;
    const isPreview = leftEditorMode === "preview";
    const current = viewRef.current.state.field(previewModeField);
    if (current !== isPreview) {
      viewRef.current.dispatch({
        effects: togglePreviewEffect.of(isPreview),
      });
    }
  }, [leftEditorMode]);

  // Sync live preview mode when editorMode changes for right pane
  useEffect(() => {
    if (!rightViewRef.current || paneLayout.type !== "split") return;
    const isPreview = rightEditorMode === "preview";
    const current = rightViewRef.current.state.field(previewModeField);
    if (current !== isPreview) {
      rightViewRef.current.dispatch({
        effects: togglePreviewEffect.of(isPreview),
      });
    }
  }, [rightEditorMode, paneLayout.type]);

  // Destroy views on unmount
  useEffect(() => {
    return () => {
      // Cancel all pending save/word-count timers
      for (const t of saveTimers.values()) clearTimeout(t);
      saveTimers.clear();
      for (const t of wordCountTimers.values()) clearTimeout(t);
      wordCountTimers.clear();

      if (viewRef.current) {
        if (viewTabIdRef.current) {
          editorStateCache.set(viewTabIdRef.current, viewRef.current.state);
          scrollCache.set(viewTabIdRef.current, viewRef.current.scrollDOM.scrollTop);
          unregisterViewForTab(viewTabIdRef.current);
        }
        viewRef.current.destroy();
        viewRef.current = null;
        setLiveViewRef(null);
      }
      if (rightViewRef.current) {
        if (rightViewTabIdRef.current) {
          editorStateCache.set(rightViewTabIdRef.current, rightViewRef.current.state);
          scrollCache.set(rightViewTabIdRef.current, rightViewRef.current.scrollDOM.scrollTop);
          unregisterViewForTab(rightViewTabIdRef.current);
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

  // Draggable divider handlers — use ref to avoid recreating listeners on ratio change
  const splitRatioRef = useRef(paneLayout.splitRatio);
  splitRatioRef.current = paneLayout.splitRatio;

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startRatio = splitRatioRef.current;

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
  }, []);

  const handleDividerKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 0.02;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const newRatio = Math.max(0.2, splitRatioRef.current - step);
      useAppStore.getState().setSplitRatio(newRatio);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const newRatio = Math.min(0.8, splitRatioRef.current + step);
      useAppStore.getState().setSplitRatio(newRatio);
    }
  }, []);

  // Handle pane activation clicks
  const handleLeftClick = useCallback(() => {
    if (paneLayout.type === "split" && paneLayout.activePaneId !== "left") {
      useAppStore.getState().setActivePaneId("left");
      if (paneLayout.leftActiveTabId) {
        useAppStore.getState().setActiveTab(paneLayout.leftActiveTabId);
        activeTabIdBox.current = paneLayout.leftActiveTabId;
        setLiveViewRef(viewRef.current);
      }
    }
  }, [paneLayout]);

  const handleRightClick = useCallback(() => {
    if (paneLayout.type === "split" && paneLayout.activePaneId !== "right") {
      useAppStore.getState().setActivePaneId("right");
      if (paneLayout.rightActiveTabId) {
        useAppStore.getState().setActiveTab(paneLayout.rightActiveTabId);
        activeTabIdBox.current = paneLayout.rightActiveTabId;
        setLiveViewRef(rightViewRef.current);
      }
    }
  }, [paneLayout]);

  // Per-pane tab bar handlers
  const handleLeftTabActivate = useCallback((tabId: string) => {
    const store = useAppStore.getState();
    const layout = { ...store.paneLayout, leftActiveTabId: tabId };
    // Also set global activeTabId if left pane is active
    if (store.paneLayout.activePaneId === "left") {
      store.setActiveTab(tabId);
    }
    useAppStore.setState({ paneLayout: layout });
  }, []);

  const handleRightTabActivate = useCallback((tabId: string) => {
    const store = useAppStore.getState();
    const layout = { ...store.paneLayout, rightActiveTabId: tabId };
    if (store.paneLayout.activePaneId === "right") {
      store.setActiveTab(tabId);
    }
    useAppStore.setState({ paneLayout: layout });
  }, []);

  const handleLeftTabClose = useCallback((tabId: string) => {
    // Snapshot + flush first
    const { snapshotAndFlush } = getSnapshotFlush();
    snapshotAndFlush(tabId).then(() => {
      useAppStore.getState().closeTabInPane(tabId, "left");
    });
  }, []);

  const handleRightTabClose = useCallback((tabId: string) => {
    const { snapshotAndFlush } = getSnapshotFlush();
    snapshotAndFlush(tabId).then(() => {
      useAppStore.getState().closeTabInPane(tabId, "right");
    });
  }, []);

  // Helper to get snapshot+flush logic without circular deps
  function getSnapshotFlush() {
    return {
      snapshotAndFlush: async (id: string) => {
        if (viewRef.current && viewTabIdRef.current === id) {
          editorStateCache.set(id, viewRef.current.state);
          scrollCache.set(id, viewRef.current.scrollDOM.scrollTop);
        }
        if (rightViewRef.current && rightViewTabIdRef.current === id) {
          editorStateCache.set(id, rightViewRef.current.state);
          scrollCache.set(id, rightViewRef.current.scrollDOM.scrollTop);
        }
        await flushSaveForTab(id);
      },
    };
  }

  // Determine editor mode CSS class for each pane
  const leftModeClass = leftEditorMode === "source" ? "source-mode" : "preview-mode";
  const rightModeClass = rightEditorMode === "source" ? "source-mode" : "preview-mode";

  if (!leftTab && paneLayout.type !== "split") {
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
          <TabBar
            paneId="left"
            tabIds={paneLayout.leftTabs}
            activeTabId={paneLayout.leftActiveTabId}
            onActivate={handleLeftTabActivate}
            onClose={handleLeftTabClose}
          />
          <div className={`editor-container ${leftModeClass}`} ref={containerRef} />
        </div>
        <div
          className="editor-divider"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(paneLayout.splitRatio * 100)}
          tabIndex={0}
          onMouseDown={handleDividerMouseDown}
          onKeyDown={handleDividerKeyDown}
        />
        <div
          className={`editor-pane ${paneLayout.activePaneId === "right" ? "active-pane" : ""}`}
          style={{ flexBasis: `${(1 - paneLayout.splitRatio) * 100}%` }}
          onClick={handleRightClick}
        >
          <TabBar
            paneId="right"
            tabIds={paneLayout.rightTabs}
            activeTabId={paneLayout.rightActiveTabId}
            onActivate={handleRightTabActivate}
            onClose={handleRightTabClose}
          />
          <div className={`editor-container ${rightModeClass}`} ref={rightContainerRef} />
        </div>
      </div>
    );
  }

  return (
    <div className="editor-area">
      <div className={`editor-container ${leftModeClass}`} ref={containerRef} />
    </div>
  );
}
