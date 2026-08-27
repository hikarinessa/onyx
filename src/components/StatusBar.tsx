import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useAppStore, selectActiveTab, selectActiveTabPath, selectActiveEditorMode } from "../stores/app";
import { replaceTabContent } from "./Editor";

export function StatusBar() {
  const activeTabId = useAppStore((s) => selectActiveTab(s)?.id ?? null);
  const activeTabPath = useAppStore(selectActiveTabPath);
  const activeEditorMode = useAppStore(selectActiveEditorMode);
  const cursorLine = useAppStore((s) => s.cursorLine);
  const cursorCol = useAppStore((s) => s.cursorCol);
  const wordCount = useAppStore((s) => s.wordCount);
  const charCount = useAppStore((s) => s.charCount);
  const saveConflictPath = useAppStore((s) => s.saveConflictPath);
  const statusNotice = useAppStore((s) => s.statusNotice);

  // A notice is a failed action, not a state — it clears itself so it cannot go stale.
  useEffect(() => {
    if (!statusNotice) return;
    const t = window.setTimeout(() => useAppStore.getState().setStatusNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [statusNotice]);
  const lintErrors = useAppStore((s) => s.lintErrors);
  const lintWarnings = useAppStore((s) => s.lintWarnings);
  const deletedPaths = useAppStore((s) => s.deletedPaths);

  const toggleEditorMode = useAppStore((s) => s.toggleEditorMode);
  const suggestionCount = useAppStore((s) => s.suggestionCount);

  const hasConflict = saveConflictPath != null && saveConflictPath === activeTabPath;
  const isDeleted = activeTabPath != null && deletedPaths.has(activeTabPath);

  const handleReload = async () => {
    if (!saveConflictPath) return;
    try {
      const content = await invoke<string>("read_file", { path: saveConflictPath });
      replaceTabContent(saveConflictPath, content);
      useAppStore.getState().setModified(saveConflictPath, false);
      useAppStore.getState().setSaveConflictPath(null);
    } catch (err) {
      console.error("Failed to reload file:", err);
    }
  };

  const handlePathClick = () => {
    if (activeTabPath) {
      navigator.clipboard.writeText(activeTabPath).catch(() => {});
    }
  };

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>Onyx v{__APP_VERSION__}</span>
        {activeTabPath && (
          <span
            className="statusbar-path"
            title="Click to copy path"
            role="button"
            tabIndex={0}
            onClick={handlePathClick}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePathClick(); } }}
          >
            {activeTabPath.replace(/\//g, " / ")}
          </span>
        )}
      </div>
      <div className="statusbar-right">
        {isDeleted && (
          <span className="statusbar-conflict" title="This file was deleted from disk. Use Cmd+S or File > Save As to save elsewhere.">
            File deleted from disk
          </span>
        )}
        {hasConflict && (
          <span
            className="statusbar-conflict"
            title="File was modified externally. Click to reload from disk (unsaved changes will be lost)."
            role="button"
            tabIndex={0}
            onClick={handleReload}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleReload(); } }}
          >
            External change — click to reload
          </span>
        )}
        {activeTabId && (
          <>
            <span>
              Ln {cursorLine}, Col {cursorCol}
            </span>
            <span title={`${charCount} characters`}>{wordCount} words</span>
            {(lintErrors > 0 || lintWarnings > 0) && (
              <span
                className="statusbar-lint"
                title="Click to toggle lint panel"
                role="button"
                tabIndex={0}
                onClick={() => useAppStore.getState().toggleLintPanel()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); useAppStore.getState().toggleLintPanel(); } }}
              >
                {lintErrors > 0 && <span className="statusbar-lint-errors">{lintErrors}E</span>}
                {lintWarnings > 0 && <span className="statusbar-lint-warnings">{lintWarnings}W</span>}
              </span>
            )}
            {statusNotice && (
              <span className="statusbar-notice" role="status">
                {statusNotice}
              </span>
            )}
            {suggestionCount > 0 && (
              <span className="statusbar-suggestions" title="CriticMarkup suggestions awaiting a decision">
                {suggestionCount} suggestion{suggestionCount === 1 ? "" : "s"}
              </span>
            )}
            <span
              className="statusbar-mode"
              title={
                suggestionCount > 0
                  ? "Cycle Source / Preview / Review (Cmd+/)"
                  : "Toggle preview (Cmd+/)"
              }
              role="button"
              tabIndex={0}
              onClick={() => { if (activeTabId) toggleEditorMode(activeTabId, suggestionCount > 0); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (activeTabId) toggleEditorMode(activeTabId, suggestionCount > 0); } }}
            >
              {activeEditorMode === "review" ? "Review" : activeEditorMode === "preview" ? "Preview" : "Source"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
