import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectActiveTabPath, selectActiveEditorMode } from "../stores/app";
import { replaceTabContent } from "./Editor";

export function StatusBar() {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTabPath = useAppStore(selectActiveTabPath);
  const activeEditorMode = useAppStore(selectActiveEditorMode);
  const cursorLine = useAppStore((s) => s.cursorLine);
  const cursorCol = useAppStore((s) => s.cursorCol);
  const wordCount = useAppStore((s) => s.wordCount);
  const charCount = useAppStore((s) => s.charCount);
  const saveConflictPath = useAppStore((s) => s.saveConflictPath);

  const toggleEditorMode = useAppStore((s) => s.toggleEditorMode);

  const hasConflict = saveConflictPath != null && saveConflictPath === activeTabPath;

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
            {activeTabPath}
          </span>
        )}
      </div>
      <div className="statusbar-right">
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
            <span
              className="statusbar-mode"
              title="Toggle preview (Cmd+/)"
              role="button"
              tabIndex={0}
              onClick={() => { if (activeTabId) toggleEditorMode(activeTabId); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (activeTabId) toggleEditorMode(activeTabId); } }}
            >
              {activeEditorMode === "preview" ? "Preview" : "Source"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
