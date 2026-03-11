import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, setFlushSaveHook, setSnapshotEditorHook } from "../stores/app";

const SAVE_DEBOUNCE_MS = 500;

/**
 * Content lives in CM6, not Zustand. The store only tracks tab metadata
 * (path, name, modified). This avoids duplicating large file contents in
 * the React state tree.
 */
const editorContentCache = new Map<string, string>();
const lastSavedContent = new Map<string, string>();

/** Seed content into the editor cache before opening a tab */
export function loadFileIntoCache(id: string, content: string) {
  editorContentCache.set(id, content);
  lastSavedContent.set(id, content);
}

/** Flush any pending save for a tab (called before closing) */
export async function flushSaveForTab(id: string): Promise<void> {
  const content = editorContentCache.get(id);
  const saved = lastSavedContent.get(id);
  if (content !== undefined && content !== saved) {
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

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Register hooks once on mount so closeTab can snapshot + flush
  useEffect(() => {
    setSnapshotEditorHook((id: string) => {
      if (viewRef.current && activeTabId === id) {
        editorContentCache.set(id, viewRef.current.state.doc.toString());
      }
    });
    setFlushSaveHook(flushSaveForTab);
    return () => {
      setSnapshotEditorHook(() => {});
      setFlushSaveHook(async () => {});
    };
  }, [activeTabId]);

  useEffect(() => {
    if (!containerRef.current || !activeTab) return;

    // Save current editor content before switching
    if (viewRef.current && activeTabId) {
      const prevId = viewRef.current.dom.parentElement?.dataset.tabId;
      if (prevId && prevId !== activeTab.id) {
        editorContentCache.set(prevId, viewRef.current.state.doc.toString());
      }
    }

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    // Get content: from cache (tab switch) or from initial load
    const initialContent = editorContentCache.get(activeTab.id) ?? "";

    const { setModified, setCursorInfo, setWordCount } = useAppStore.getState();

    const updateListener = EditorView.updateListener.of((update) => {
      // Cursor position — always update (cheap)
      const pos = update.state.selection.main.head;
      const line = update.state.doc.lineAt(pos);
      setCursorInfo(line.number, pos - line.from + 1);

      if (update.docChanged) {
        const content = update.state.doc.toString();
        const saved = lastSavedContent.get(activeTab.id) ?? "";
        const isModified = content !== saved;
        setModified(activeTab.id, isModified);

        // Word count — only on doc changes
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        setWordCount(words);

        // Debounced auto-save
        clearTimeout(saveTimerRef.current);
        if (isModified) {
          saveTimerRef.current = setTimeout(async () => {
            try {
              await invoke("write_file", { path: activeTab.path, content });
              lastSavedContent.set(activeTab.id, content);
              setModified(activeTab.id, false);
            } catch (err) {
              console.error("Failed to save:", err);
            }
          }, SAVE_DEBOUNCE_MS);
        }
      }
    });

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        keymap.of([...defaultKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        oneDark,
        EditorView.lineWrapping,
        updateListener,
        EditorView.theme({
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
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    // Tag the container so we can identify which tab it belongs to
    containerRef.current.dataset.tabId = activeTab.id;
    viewRef.current = view;
    view.focus();

    // Initial word count
    const words = initialContent.trim()
      ? initialContent.trim().split(/\s+/).length
      : 0;
    setWordCount(words);

    return () => {
      clearTimeout(saveTimerRef.current);
      // Save content to cache before unmount
      if (viewRef.current) {
        editorContentCache.set(activeTab.id, viewRef.current.state.doc.toString());
      }
    };
  }, [activeTab?.id, activeTab?.path]); // eslint-disable-line -- CM6 manages its own state; re-creating on every render would destroy the editor

  // Clean up caches when tabs close
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id));
    for (const key of editorContentCache.keys()) {
      if (!tabIds.has(key)) {
        editorContentCache.delete(key);
        lastSavedContent.delete(key);
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

  return (
    <div className="editor-area">
      <div className="editor-container" ref={containerRef} />
    </div>
  );
}
