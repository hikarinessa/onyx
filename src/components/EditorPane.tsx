/**
 * EditorPane — one pane in the split layout.
 * Each pane owns its own EditorView instance and inline title.
 * Module-level caches (editorStateCache, scrollCache, lastSavedContent)
 * live in Editor.tsx and are shared across panes.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { useAppStore, type EditorMode } from "../stores/app";
import type { Pane } from "../stores/panes";
import { togglePreviewEffect, previewModeField } from "../extensions/livePreview";
import { reviewModeField, toggleReviewEffect } from "../extensions/criticMarkup";
import { ReviewCards } from "./ReviewCards";
import { ContextMenu, type MenuSection } from "./ContextMenu";
import { editorMenuSections } from "../lib/editorMenu";
import { extractBlockToNote } from "../lib/blockExtract";

/**
 * Drive both mode fields from the single `editorMode` value.
 *
 * Two effects used to do this independently — one on tab switch, one on mode change —
 * and only the first knew Review existed. The second read `mode === "preview"` as "is
 * preview on", which switched live preview *off* in Review mode and left review
 * decorations stranded on top of Preview. One writer, so they cannot disagree again.
 */
function syncEditorMode(view: EditorView, mode: EditorMode): void {
  const wantPreview = mode !== "source"; // Review renders on top of preview
  const wantReview = mode === "review";
  const effects = [];
  if (view.state.field(previewModeField) !== wantPreview) {
    effects.push(togglePreviewEffect.of(wantPreview));
  }
  if (view.state.field(reviewModeField) !== wantReview) {
    effects.push(toggleReviewEffect.of(wantReview));
  }
  if (effects.length) view.dispatch({ effects });
}
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
  // Cards render from editor state, so the pane only needs a signal that it changed.
  // The view is held in a ref, which render must not read; mirror it into state once it
  // exists so the card column can take it as an ordinary prop.
  useAppStore((st) => st.reviewTick);
  const [cardView, setCardView] = useState<EditorView | null>(null);

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
          const cursor = state.selection.main.head;
          state = createStateWithExtensions(state.doc.toString(), cursor);
          editorStateCache.set(activeTab.id, state);
        }
      } catch {
        const cursor = state.selection.main.head;
        state = createStateWithExtensions(state.doc.toString(), cursor);
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
    setCardView(viewRef.current);

    syncEditorMode(viewRef.current, activeTab.editorMode);

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
        setCardView(null);
      }
    };
  }, [pane.id]);

  // Sync preview and review mode on editorMode change
  useEffect(() => {
    if (viewRef.current) syncEditorMode(viewRef.current, editorMode);
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

  // ── Right-click menu ──
  const [menu, setMenu] = useState<{ x: number; y: number; sections: MenuSection[] } | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const view = viewRef.current;
    if (!view || !view.contentDOM.contains(e.target as Node)) return;
    e.preventDefault();
    // A right-click outside the current selection moves the caret there first, so the
    // menu describes the place that was clicked rather than wherever the caret was.
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const sel = view.state.selection.main;
    if (pos !== null && (pos < sel.from || pos > sel.to)) {
      view.dispatch({ selection: { anchor: pos } });
    }
    setMenu({
      x: e.clientX,
      y: e.clientY,
      sections: editorMenuSections(view, () => extractBlockToNote(view)),
    });
  }, []);

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
        <div className="editor-body">
          <div
            className={`editor-container ${modeClass}`}
            ref={containerRef}
            onContextMenu={handleContextMenu}
          />
          {menu && <ContextMenu {...menu} onClose={closeMenu} />}
          {activeTab.editorMode === "review" && <ReviewCards view={cardView} />}
        </div>
      </div>
    </div>
  );
}
