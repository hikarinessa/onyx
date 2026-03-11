import { useAppStore } from "../stores/app";

export function StatusBar() {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const cursorLine = useAppStore((s) => s.cursorLine);
  const cursorCol = useAppStore((s) => s.cursorCol);
  const wordCount = useAppStore((s) => s.wordCount);

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>Onyx v0.1.0</span>
      </div>
      <div className="statusbar-right">
        {activeTabId && (
          <>
            <span>
              Ln {cursorLine}, Col {cursorCol}
            </span>
            <span>{wordCount} words</span>
            <span>Markdown</span>
          </>
        )}
      </div>
    </div>
  );
}
