import { useAppStore } from "../stores/app";

export function StatusBar() {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const cursorLine = useAppStore((s) => s.cursorLine);
  const cursorCol = useAppStore((s) => s.cursorCol);
  const wordCount = useAppStore((s) => s.wordCount);
  const charCount = useAppStore((s) => s.charCount);

  const toggleEditorMode = useAppStore((s) => s.toggleEditorMode);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handlePathClick = () => {
    if (activeTab?.path) {
      navigator.clipboard.writeText(activeTab.path).catch(() => {});
    }
  };

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>Onyx v{__APP_VERSION__}</span>
        {activeTab && (
          <span
            className="statusbar-path"
            title="Click to copy path"
            onClick={handlePathClick}
          >
            {activeTab.path}
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
              onClick={() => { if (activeTabId) toggleEditorMode(activeTabId); }}
            >
              {activeTab?.editorMode === "preview" ? "Preview" : "Source"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
