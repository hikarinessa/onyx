import { useEffect, useRef, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";

const SAVE_DEBOUNCE_MS = 500;

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const updateContent = useAppStore((s) => s.updateContent);
  const markSaved = useAppStore((s) => s.markSaved);
  const setCursorInfo = useAppStore((s) => s.setCursorInfo);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const saveFile = useCallback(
    async (path: string, content: string) => {
      try {
        await invoke("write_file", { path, content });
        markSaved(path);
      } catch (err) {
        console.error("Failed to save:", err);
      }
    },
    [markSaved]
  );

  // Create or update editor when active tab changes
  useEffect(() => {
    if (!containerRef.current || !activeTab) return;

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        updateContent(activeTab.id, content);

        // Debounced auto-save (only if content actually changed from last save)
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          const currentTab = useAppStore.getState().tabs.find(
            (t) => t.id === activeTab.id
          );
          if (currentTab && currentTab.modified) {
            saveFile(currentTab.path, currentTab.content);
          }
        }, SAVE_DEBOUNCE_MS);
      }

      // Update cursor info
      const pos = update.state.selection.main.head;
      const line = update.state.doc.lineAt(pos);
      const text = update.state.doc.toString();
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setCursorInfo(line.number, pos - line.from + 1, words);
    });

    const state = EditorState.create({
      doc: activeTab.content,
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

    viewRef.current = view;
    view.focus();

    return () => {
      clearTimeout(saveTimerRef.current);
    };
  }, [activeTab?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
