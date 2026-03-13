import { useAppStore, selectActiveTabPath, selectActiveEditorMode } from "../stores/app";

export function StatusBar() {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTabPath = useAppStore(selectActiveTabPath);
  const activeEditorMode = useAppStore(selectActiveEditorMode);
  const cursorLine = useAppStore((s) => s.cursorLine);
  const cursorCol = useAppStore((s) => s.cursorCol);
  const wordCount = useAppStore((s) => s.wordCount);
  const charCount = useAppStore((s) => s.charCount);

  const toggleEditorMode = useAppStore((s) => s.toggleEditorMode);

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
