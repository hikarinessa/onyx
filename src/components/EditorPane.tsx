/**
 * EditorPane — one pane in the split layout.
 * Each pane owns its own EditorView instance and inline title.
 * Module-level caches (editorStateCache, scrollCache, lastSavedContent)
 * live in Editor.tsx and are shared across panes.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { useAppStore } from "../stores/app";
import type { Pane } from "../stores/panes";
import { togglePreviewEffect, previewModeField } from "../extensions/livePreview";
import { frontmatterTabRef } from "../extensions/frontmatter";
import { renameFile } from "../lib/fileOps";
import {
  editorStateCache,
  scrollCache,
  createStateWithExtensions,
  registerPaneView,
  unregisterPaneView,
  getAllPaneViews,
} from "./Editor";

export function EditorPane({ pane }: { pane: Pane }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const viewTabIdRef = useRef<string | null>(null);

  const activePaneId = useAppStore((s) => s.paneState.activePaneId);
  const isActive = pane.id === activePaneId;
  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);
  const editorMode = activeTab?.editorMode ?? "source";

  // Set this pane as active on pointer down
  const handlePointerDown = useCallback(() => {
    if (!isActive) {
      useAppStore.getState().setActivePane(pane.id);
    }
  }, [isActive, pane.id]);

  // Create or swap EditorView when active tab changes
  useEffect(() => {
    if (!containerRef.current || !activeTab) return;

    // Save current tab state before switching
    if (viewRef.current && viewTabIdRef.current && viewTabIdRef.current !== activeTab.id) {
      editorStateCache.set(viewTabIdRef.current, viewRef.current.state);
      scrollCache.set(viewTabIdRef.current, viewRef.current.scrollDOM.scrollTop);
    }

    // Get or create EditorState
    let state = editorStateCache.get(activeTab.id);
    if (state) {
      try {
        const hasKeymap = state.facet(keymap).length > 0;
        if (!hasKeymap) {
          state = createStateWithExtensions(state.doc.toString());
          editorStateCache.set(activeTab.id, state);
        }
      } catch {
        state = createStateWithExtensions(state.doc.toString());
        editorStateCache.set(activeTab.id, state);
      }
    } else {
      state = createStateWithExtensions("");
      editorStateCache.set(activeTab.id, state);
    }

    frontmatterTabRef.current = activeTab.id;

    if (viewRef.current && viewRef.current.dom.parentElement === containerRef.current) {
      viewRef.current.setState(state);
    } else {
      if (viewRef.current) viewRef.current.destroy();
      viewRef.current = new EditorView({
        state,
        parent: containerRef.current,
      });
    }

    // Register this pane's view for external access
    registerPaneView(pane.id, viewRef.current);
    viewTabIdRef.current = activeTab.id;

    // Sync preview mode
    const wantPreview = activeTab.editorMode === "preview";
    const currentPreview = viewRef.current.state.field(previewModeField);
    if (currentPreview !== wantPreview) {
      viewRef.current.dispatch({ effects: togglePreviewEffect.of(wantPreview) });
    }

    // Restore scroll
    const savedScroll = scrollCache.get(activeTab.id);
    requestAnimationFrame(() => {
      if (viewRef.current) {
        viewRef.current.scrollDOM.scrollTop = savedScroll ?? 0;
      }
    });

    if (isActive) viewRef.current.focus();

    // Update status bar if this is the active pane
    if (isActive) {
      const doc = viewRef.current.state.doc;
      const content = doc.toString();
      const words = content.trim() ? content.trim().split(/\s+/).length : 0;
      useAppStore.getState().setWordCount(words);
      useAppStore.getState().setCharCount(content.length);
      const pos = viewRef.current.state.selection.main.head;
      const line = doc.lineAt(pos);
      useAppStore.getState().setCursorInfo(line.number, pos - line.from + 1);
    }

    return () => {
      // Don't clear save timer here — it's per-tab, managed in updateListener
    };
  }, [activeTab?.id, activeTab?.path, pane.id]); // eslint-disable-line

  // Destroy view on unmount
  useEffect(() => {
    return () => {
      if (viewRef.current) {
        if (viewTabIdRef.current) {
          editorStateCache.set(viewTabIdRef.current, viewRef.current.state);
          scrollCache.set(viewTabIdRef.current, viewRef.current.scrollDOM.scrollTop);
        }
        unregisterPaneView(pane.id);
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [pane.id]);

  // Sync preview mode on editorMode change
  useEffect(() => {
    if (!viewRef.current) return;
    const isPreview = editorMode === "preview";
    const current = viewRef.current.state.field(previewModeField);
    if (current !== isPreview) {
      viewRef.current.dispatch({ effects: togglePreviewEffect.of(isPreview) });
    }
  }, [editorMode]);

  // Focus this pane's editor when it becomes active
  useEffect(() => {
    if (isActive && viewRef.current) {
      registerPaneView(pane.id, viewRef.current);
      viewRef.current.focus();
    }
  }, [isActive, pane.id]);

  // Scroll sync — when scroll lock is active, synchronize scroll with other panes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    let isSyncing = false;

    const handleScroll = () => {
      if (isSyncing) return;
      const anchors = useAppStore.getState().paneState.scrollLockAnchors;
      if (!anchors) return;

      const myAnchor = anchors.get(pane.id);
      if (myAnchor === undefined) return;

      const delta = view.scrollDOM.scrollTop - myAnchor;

      isSyncing = true;
      for (const [otherId, otherView] of getAllPaneViews()) {
        if (otherId === pane.id) continue;
        const otherAnchor = anchors.get(otherId);
        if (otherAnchor === undefined) continue;
        otherView.scrollDOM.scrollTop = otherAnchor + delta;
      }
      isSyncing = false;
    };

    view.scrollDOM.addEventListener("scroll", handleScroll);
    return () => view.scrollDOM.removeEventListener("scroll", handleScroll);
  }, [pane.id, activeTab?.id]);

  // ── Inline title ──
  const [titleValue, setTitleValue] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab) {
      setTitleValue(activeTab.name.replace(/\.md$/, ""));
    }
  }, [activeTab?.id, activeTab?.name]); // eslint-disable-line

  const handleTitleCommit = useCallback(async () => {
    if (!activeTab) return;
    const trimmed = titleValue.trim().replace(/[/\0:]/g, "");
    const oldName = activeTab.name.replace(/\.md$/, "");
    if (!trimmed || trimmed === oldName) {
      setTitleValue(oldName);
      return;
    }
    const dir = activeTab.path.substring(0, activeTab.path.lastIndexOf("/"));
    const newPath = `${dir}/${trimmed}.md`;
    try {
      await renameFile(activeTab.path, newPath);
    } catch (err) {
      console.error("Failed to rename:", err);
      setTitleValue(oldName);
    }
  }, [titleValue, activeTab]);

  if (!activeTab) {
    return (
      <div className="editor-pane" onPointerDown={handlePointerDown}>
        <div className="editor-area">
          <div className="editor-empty">Open a file to start editing</div>
        </div>
      </div>
    );
  }

  const modeClass = activeTab.editorMode === "source" ? "source-mode" : "preview-mode";

  return (
    <div
      className={`editor-pane ${isActive ? "editor-pane-active" : ""}`}
      onPointerDown={handlePointerDown}
    >
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
              setTitleValue(activeTab.name.replace(/\.md$/, ""));
              titleRef.current?.blur();
            }
          }}
          spellCheck={false}
        />
        <div className={`editor-container ${modeClass}`} ref={containerRef} />
      </div>
    </div>
  );
}
