import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";
import { foldFrontmatterCommand, clearAutoFoldForTab } from "../extensions/frontmatter";
import { autoFixOnSave } from "../extensions/linting";
import { useAppStore } from "../stores/app";
import {
  editorStateCache,
  scrollCache,
  lastSavedContent,
  createStateWithExtensions,
} from "../components/editorShared";

/**
 * EditorBridge — decouples external consumers from Editor.tsx internals.
 *
 * Editor.tsx registers its live view(s) here. Components like QuickOpen,
 * ContextPanel, and openFile.ts call the bridge API instead of importing
 * directly from Editor.tsx.
 */

/** The currently active EditorView (left pane, or right if active) */
let _liveViewRef: EditorView | null = null;

export function setLiveViewRef(view: EditorView | null) {
  _liveViewRef = view;
}

export function getLiveViewRef(): EditorView | null {
  return _liveViewRef;
}

// ---------------------------------------------------------------------------
// Public API — used by QuickOpen, ContextPanel, openFile, App, fileOps
// ---------------------------------------------------------------------------

/** Seed content into the editor cache before opening a tab */
export function loadFileIntoCache(id: string, content: string) {
  editorStateCache.set(id, createStateWithExtensions(content));
  lastSavedContent.set(id, content);
}

/**
 * Replace the document content for a tab after an external write
 * (e.g. frontmatter update from properties panel).
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
  if (_liveViewRef) {
    const { activeTabId } = useAppStore.getState();
    if (activeTabId === tabId) {
      _liveViewRef.dispatch({
        changes: { from: 0, to: _liveViewRef.state.doc.length, insert: newContent },
      });
    }
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
