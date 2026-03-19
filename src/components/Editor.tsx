import { useEffect, useRef, useCallback } from "react";
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
  unfoldEffect,
  foldedRanges,
  indentUnit,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, setFlushSaveHook, setSnapshotEditorHook, selectActivePane } from "../stores/app";
import { frontmatterExtension, clearAutoFoldForTab, toggleFrontmatterFoldCommand } from "../extensions/frontmatter";
import { headingFoldExtension } from "../extensions/headingFold";
import { wikilinkExtension, wikilinkFollowRef } from "../extensions/wikilinks";
import { tagExtension } from "../extensions/tags";
import { formattingKeymap } from "../extensions/formatting";
import { outlinerKeymap } from "../extensions/outliner";
import { tableEditorExtension } from "../extensions/tableEditor";
import { urlPasteExtension } from "../extensions/urlPaste";
import { autocompleteExtension } from "../extensions/autocomplete";
import { symbolWrapExtension } from "../extensions/symbolWrap";
import { livePreviewExtension } from "../extensions/livePreview";
import { lintingExtension, autofixContent, applyLintFix } from "../extensions/linting";
import { blocksExtension } from "../extensions/blocks";
import { spellcheckExtension } from "../extensions/spellcheck";
import { lintKeymap } from "@codemirror/lint";
import { openFileInEditor } from "../lib/openFile";
import { getAutoSaveMs, setRemeasureHook, isAutofixOnSave, getShowLineNumbers, getTabSize } from "../lib/configBridge";
import { EditorPane } from "./EditorPane";
import { TabBar } from "./TabBar";

// ---------------------------------------------------------------------------
// Module-level caches (shared across all panes)
// ---------------------------------------------------------------------------

/** Full EditorState snapshots — preserves undo history, selections, etc. */
export const editorStateCache = new Map<string, EditorState>();

/** Scroll positions per tab */
export const scrollCache = new Map<string, number>();

/** Last-saved content strings — used for dirty detection */
export const lastSavedContent = new Map<string, string>();

/**
 * Mutable ref for active tab id — the updateListener closure reads this.
 * With split panes, this tracks the active pane's active tab.
 */
const activeTabIdBox = { current: null as string | null };

/** Registry of pane views — paneId → EditorView */
const paneViews = new Map<string, EditorView>();

export function registerPaneView(paneId: string, view: EditorView) {
  paneViews.set(paneId, view);
  // Update _liveViewRef to the active pane's view
  const activePaneId = useAppStore.getState().paneState.activePaneId;
  if (paneId === activePaneId) {
    activeTabIdBox.current = selectActivePane(useAppStore.getState()).activeTabId;
  }
}

export function unregisterPaneView(paneId: string) {
  paneViews.delete(paneId);
}

/** Get the active pane's EditorView */
export function getEditorView(): EditorView | null {
  const activePaneId = useAppStore.getState().paneState.activePaneId;
  return paneViews.get(activePaneId) || null;
}

/** Get all registered pane views */
export function getAllPaneViews(): Map<string, EditorView> {
  return paneViews;
}

// ---------------------------------------------------------------------------
// Shared styles and highlight
// ---------------------------------------------------------------------------

export const onyxHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "var(--heading-1-size, 1.6em)", color: "var(--heading-1-color, var(--text-primary))", fontWeight: "600" },
  { tag: tags.heading2, fontSize: "var(--heading-2-size, 1.3em)", color: "var(--heading-2-color, var(--text-primary))", fontWeight: "600" },
  { tag: tags.heading3, fontSize: "var(--heading-3-size, 1.1em)", color: "var(--heading-3-color, var(--text-primary))", fontWeight: "600" },
  { tag: tags.heading4, color: "var(--heading-4-color, var(--text-primary))", fontWeight: "600" },
  { tag: tags.heading5, color: "var(--heading-5-color, var(--text-primary))", fontWeight: "600" },
  { tag: tags.heading6, color: "var(--heading-6-color, var(--text-primary))", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", background: "var(--bg-elevated)" },
  { tag: tags.link, color: "var(--link-color)", textDecoration: "var(--link-underline, underline)" },
  { tag: tags.url, color: "var(--link-color)", textDecoration: "var(--link-underline, underline)" },
  { tag: tags.quote, color: "var(--text-tertiary)", fontStyle: "italic" },
  { tag: tags.strikethrough, color: "var(--syntax-strikethrough)", textDecoration: "line-through" },
  { tag: tags.meta, color: "var(--syntax-meta)" },
  { tag: tags.comment, color: "var(--syntax-comment)" },
  { tag: tags.contentSeparator, color: "var(--syntax-hr)" },
  { tag: tags.processingInstruction, color: "var(--syntax-markup)" },
]);

export const onyxTheme = EditorView.theme({
  "&": { backgroundColor: "var(--bg-base)" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "var(--accent-muted) !important",
  },
  ".cm-line": { padding: "0 2px" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    background: "var(--bg-surface)",
    borderRight: "1px solid var(--border-subtle)",
    color: "var(--text-tertiary)",
  },
  ".cm-activeLineGutter": { background: "transparent" },
  ".cm-activeLine": { background: "var(--bg-hover)" },
});

// ---------------------------------------------------------------------------
// Extensions builder
// ---------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Find which tab ID a view belongs to by checking the pane registry */
function tabIdForView(view: EditorView): string | null {
  for (const [paneId, paneView] of paneViews) {
    if (paneView === view) {
      const pane = useAppStore.getState().paneState.panes.find((p) => p.id === paneId);
      return pane?.activeTabId ?? null;
    }
  }
  return activeTabIdBox.current; // fallback for single-pane
}

function buildExtensions(): Extension[] {
  const updateListener = EditorView.updateListener.of((update) => {
    const tabId = tabIdForView(update.view);
    if (!tabId) return;

    const { setCursorInfo, setModified, setWordCount, setCharCount } = useAppStore.getState();
    const isActiveView = tabId === selectActivePane(useAppStore.getState()).activeTabId;

    // Cursor position — only for active pane (status bar)
    if (isActiveView) {
      const pos = update.state.selection.main.head;
      const line = update.state.doc.lineAt(pos);
      setCursorInfo(line.number, pos - line.from + 1);
    }

    if (update.docChanged) {
      const content = update.state.doc.toString();
      const saved = lastSavedContent.get(tabId) ?? "";
      const isModified = content !== saved;
      setModified(tabId, isModified);

      // Word count + char count (active pane only)
      if (isActiveView) {
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        setWordCount(words);
        setCharCount(content.length);
      }

      // Debounced auto-save
      clearTimeout(saveTimer);
      if (isModified) {
        // Find tab across all panes (compat getter may not resolve correctly)
        let tab: { path: string } | undefined;
        for (const p of useAppStore.getState().paneState.panes) {
          tab = p.tabs.find((t) => t.id === tabId);
          if (tab) break;
        }
        if (tab) {
          saveTimer = setTimeout(async () => {
            try {
              let saveContent = content;
              if (isAutofixOnSave()) {
                const fixed = autofixContent(content);
                if (fixed !== content) {
                  saveContent = fixed;
                  const view = getEditorView();
                  if (view && view.state.doc.toString() === content) {
                    view.dispatch({
                      changes: { from: 0, to: view.state.doc.length, insert: fixed },
                    });
                  }
                }
              }
              // Auto-save guard: skip if file was deleted
              if (useAppStore.getState().deletedPaths.has(tab.path)) {
                return;
              }
              const result = await invoke<string>("write_file", {
                path: tab.path,
                content: saveContent,
              });
              if (typeof result === "string" && result.startsWith("CONFLICT:")) {
                useAppStore.getState().setSaveConflictPath(tab.path);
              } else {
                lastSavedContent.set(tabId, saveContent);
                useAppStore.getState().setModified(tabId, false);
                useAppStore.getState().bumpSaveVersion();
              }
            } catch (err) {
              const msg = String(err);
              if (msg.startsWith("DELETED:")) {
                // File was deleted externally — don't resurrect it
                useAppStore.getState().addDeletedPath(tab.path);
              } else {
                console.error("Auto-save failed:", err);
              }
            }
          }, getAutoSaveMs());
        }
      }
    }
  });

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
    ...tableEditorExtension(),
    keymap.of(outlinerKeymap),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      // Filter out Cmd+Alt+[ and Cmd+Alt+] from foldKeymap — those are
      // used for sidebar/context panel toggle at the app level.
      ...foldKeymap.filter((b) => b.key !== "Mod-Alt-[" && b.key !== "Mod-Alt-]"),
      ...searchKeymap,
    ]),
    history(),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(onyxHighlightStyle),
    codeFolding({
      placeholderDOM(view) {
        const btn = document.createElement("span");
        btn.className = "cm-icon-btn";
        btn.title = "Unfold";
        btn.setAttribute("aria-label", "Unfold");
        btn.setAttribute("role", "button");
        btn.style.verticalAlign = "middle";
        btn.style.margin = "0 2px";
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3 3-3-3"/><path d="m15 5-3-3-3 3"/></svg>`;
        btn.onclick = () => {
          const pos = view.posAtDOM(btn);
          // Find the folded range that contains this position
          const iter = foldedRanges(view.state).iter();
          while (iter.value) {
            if (iter.from <= pos && iter.to >= pos) {
              view.dispatch({ effects: unfoldEffect.of({ from: iter.from, to: iter.to }) });
              return;
            }
            iter.next();
          }
          // Fallback: try unfold at pos (CM6 matches overlapping folds)
          view.dispatch({ effects: unfoldEffect.of({ from: pos, to: pos }) });
        };
        return btn;
      },
    }),
    foldGutter(),
    ...(getShowLineNumbers() ? [lineNumbers()] : []),
    indentUnit.of(" ".repeat(getTabSize())),
    onyxTheme,
    EditorView.lineWrapping,
    updateListener,
    frontmatterExtension(),
    headingFoldExtension(),
    wikilinkExtension(),
    tagExtension(),
    urlPasteExtension,
    autocompleteExtension(),
    symbolWrapExtension(),
    livePreviewExtension(),
    ...blocksExtension(),
    keymap.of(lintKeymap),
    ...lintingExtension(),
    ...spellcheckExtension(),
  ];
}

// ---------------------------------------------------------------------------
// Public API — shared across panes
// ---------------------------------------------------------------------------

/** Shared extensions ref — initialized on first Editor mount */
let sharedExtensions: Extension[] | null = null;
export const sharedExtensionsRef = { get: () => sharedExtensions };

/** Create an EditorState with the shared extensions */
export function createStateWithExtensions(doc: string): EditorState {
  if (!sharedExtensions) {
    return EditorState.create({ doc });
  }
  return EditorState.create({ doc, extensions: sharedExtensions });
}

/** Seed content into the editor cache before opening a tab */
export function loadFileIntoCache(id: string, content: string) {
  editorStateCache.set(id, createStateWithExtensions(content));
  lastSavedContent.set(id, content);
}

/** Replace doc content for a tab after an external write */
export function replaceTabContent(tabId: string, newContent: string) {
  const cached = editorStateCache.get(tabId);
  if (cached) {
    const tr = cached.update({
      changes: { from: 0, to: cached.doc.length, insert: newContent },
    });
    editorStateCache.set(tabId, tr.state);
  }
  lastSavedContent.set(tabId, newContent);

  // Update any pane currently showing this tab
  for (const [, view] of paneViews) {
    if (view.state.doc.toString() !== newContent) {
      // Check if this view is showing the target tab
      // (we can't directly check tabId, but if content matches the old cached content, update it)
    }
  }
  // Direct approach: find pane showing this tab and dispatch
  const state = useAppStore.getState();
  for (const pane of state.paneState.panes) {
    if (pane.activeTabId === tabId) {
      const view = paneViews.get(pane.id);
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newContent },
        });
      }
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

/** Remove all editor caches for a path */
export function clearEditorCache(path: string) {
  editorStateCache.delete(path);
  lastSavedContent.delete(path);
  scrollCache.delete(path);
  clearAutoFoldForTab(path);
}

/**
 * Cancel any pending auto-save.
 * Note: there's a single global save timer (for the most recent edit across all panes).
 * This cancels it regardless of which file triggered the save.
 */
export function cancelPendingSave() {
  clearTimeout(saveTimer);
}

/** Toggle frontmatter fold in the active editor */
export function foldFrontmatter(): boolean {
  const view = getEditorView();
  if (!view) return false;
  return toggleFrontmatterFoldCommand(view);
}

/** Insert text at the cursor in the active editor */
export function insertAtCursor(text: string) {
  const view = getEditorView();
  if (!view) return;
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, to: pos, insert: text },
    selection: EditorSelection.cursor(pos + text.length),
  });
  view.focus();
}

/** Scroll the active editor to a character position */
export function scrollToPosition(from: number) {
  const view = getEditorView();
  if (!view) return;
  view.dispatch({
    selection: EditorSelection.cursor(from),
    scrollIntoView: true,
  });
  view.focus();
}

/** Apply fix-all: run autofixContent on the current document */
export function applyLintFixAll() {
  const view = getEditorView();
  if (!view) return;
  const content = view.state.doc.toString();
  const fixed = autofixContent(content);
  if (fixed !== content) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: fixed },
    });
  }
  view.focus();
}

/** Apply fix for a single lint issue by ID */
export function applyLintFixSingle(issueId: string) {
  const view = getEditorView();
  if (!view) return;
  applyLintFix(issueId, view);
  view.focus();
}

/** Flush any pending save for a tab */
export async function flushSaveForTab(id: string): Promise<void> {
  const state = editorStateCache.get(id);
  if (!state) return;
  clearTimeout(saveTimer);

  const content = state.doc.toString();
  const saved = lastSavedContent.get(id) ?? "";
  if (content !== saved) {
    // Find the path for this tab (search all panes)
    const store = useAppStore.getState();
    let tabPath: string | null = null;
    for (const pane of store.paneState.panes) {
      const tab = pane.tabs.find((t) => t.id === id);
      if (tab) { tabPath = tab.path; break; }
    }
    if (tabPath) {
      try {
        await invoke("write_file", { path: tabPath, content });
        lastSavedContent.set(id, content);
        useAppStore.getState().setModified(id, false);
      } catch (err) {
        console.error("Failed to flush save for tab:", err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Editor Layout Component
// ---------------------------------------------------------------------------

export function Editor() {
  const panes = useAppStore((s) => s.paneState.panes);
  const splitRatios = useAppStore((s) => s.paneState.splitRatios);

  // Initialize shared extensions once
  if (!sharedExtensions) {
    sharedExtensions = buildExtensions();
  }

  // Register hooks
  useEffect(() => {
    setSnapshotEditorHook((id: string) => {
      // Find which pane has this tab and snapshot from its view
      const state = useAppStore.getState();
      for (const pane of state.paneState.panes) {
        if (pane.activeTabId === id) {
          const view = paneViews.get(pane.id);
          if (view) {
            editorStateCache.set(id, view.state);
            scrollCache.set(id, view.scrollDOM.scrollTop);
          }
          break;
        }
      }
    });
    setFlushSaveHook(flushSaveForTab);
    setRemeasureHook(() => {
      for (const [, view] of paneViews) {
        view.requestMeasure();
      }
    });

    wikilinkFollowRef.current = async (link: string, newTab: boolean, otherPane: boolean) => {
      const state = useAppStore.getState();
      const { paneState } = state;
      const pane = paneState.panes.find((p) => p.id === paneState.activePaneId);
      const currentTab = pane?.tabs.find((t) => t.id === pane.activeTabId);
      if (!currentTab) return;
      try {
        const resolved = await invoke<string | null>("resolve_wikilink", {
          link,
          contextPath: currentTab.path,
        });
        if (resolved) {
          const name = resolved.split("/").pop() || resolved;
          if (otherPane && paneState.panes.length > 1) {
            // Open in the next pane
            const currentIdx = paneState.panes.findIndex((p) => p.id === paneState.activePaneId);
            const targetIdx = (currentIdx + 1) % paneState.panes.length;
            const targetPaneId = paneState.panes[targetIdx].id;
            useAppStore.getState().setActivePane(targetPaneId);
            await openFileInEditor(resolved, name, { replaceActive: true });
          } else {
            await openFileInEditor(resolved, name, { replaceActive: !newTab });
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

  // Clean up caches when tabs close
  useEffect(() => {
    const allTabIds = new Set<string>();
    for (const p of panes) {
      for (const t of p.tabs) allTabIds.add(t.id);
    }
    for (const key of editorStateCache.keys()) {
      if (!allTabIds.has(key)) {
        editorStateCache.delete(key);
        scrollCache.delete(key);
        lastSavedContent.delete(key);
        clearAutoFoldForTab(key);
      }
    }
  }, [panes]);

  // Update activeTabIdBox when active pane changes
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const pane = selectActivePane(s);
      activeTabIdBox.current = pane.activeTabId;
    });
    return unsub;
  }, []);

  const isSplit = panes.length > 1;

  return (
    <>
      {panes.map((pane, i) => {
        // Calculate flex style from split ratios
        let flex: string;
        if (!isSplit) {
          flex = "1 1 0";
        } else {
          const start = i === 0 ? 0 : splitRatios[i - 1];
          const end = i < splitRatios.length ? splitRatios[i] : 1;
          const fraction = end - start;
          flex = `${fraction} ${fraction} 0`;
        }

        return (
          <div key={pane.id} style={{ display: "contents" }}>
            {i > 0 && <PaneDivider index={i - 1} />}
            <div className="pane-column" style={{ flex, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <TabBar paneId={pane.id} />
              <EditorPane pane={pane} />
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pane Divider
// ---------------------------------------------------------------------------

function PaneDivider({ index }: { index: number }) {
  const divRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const ratios = [...useAppStore.getState().paneState.splitRatios];
    const startRatio = ratios[index];
    const container = divRef.current?.parentElement?.parentElement;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;

    // Prevent CM6 from capturing mouse events during drag
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "9999", cursor: "col-resize",
    });
    document.body.appendChild(overlay);

    let rafId: number | null = null;

    const handleMove = (ev: MouseEvent) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const dx = ev.clientX - startX;
        const deltaRatio = dx / containerWidth;
        const newRatio = Math.max(0.15, Math.min(0.85, startRatio + deltaRatio));
        const newRatios = [...ratios];
        newRatios[index] = newRatio;
        useAppStore.getState().setSplitRatios(newRatios);
        // Tell CM6 to remeasure
        for (const [, view] of paneViews) {
          view.requestMeasure();
        }
      });
    };

    const handleUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      overlay.remove();
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [index]);

  return (
    <div
      ref={divRef}
      className="pane-divider"
      onMouseDown={handleMouseDown}
    />
  );
}
