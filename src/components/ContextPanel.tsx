import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";

interface BacklinkRecord {
  source_path: string;
  source_title: string | null;
  line_number: number | null;
  context: string | null;
}

export function ContextPanel() {
  const visible = useAppStore((s) => s.contextPanelVisible);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([]);
  const [backlinksExpanded, setBacklinksExpanded] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);

  useEffect(() => {
    if (!activeTab?.path) {
      setBacklinks([]);
      setBacklinksExpanded(false);
      return;
    }

    invoke<BacklinkRecord[]>("get_backlinks", { path: activeTab.path })
      .then((results) => {
        setBacklinks(results);
        setBacklinksExpanded(results.length > 0);
      })
      .catch(() => {
        setBacklinks([]);
        setBacklinksExpanded(false);
      });
  }, [activeTabId]);

  // Check bookmark state for current file
  useEffect(() => {
    if (!activeTab?.path) {
      setIsBookmarked(false);
      return;
    }

    invoke<{ path: string; title: string | null; label: string | null }[]>("get_bookmarks")
      .then((bookmarks) => {
        setIsBookmarked(bookmarks.some((b) => b.path === activeTab.path));
      })
      .catch(() => {
        setIsBookmarked(false);
      });
  }, [activeTabId]);

  const handleBacklinkClick = async (record: BacklinkRecord) => {
    const name = record.source_title
      || record.source_path.split("/").pop()
      || record.source_path;
    try {
      await openFileInEditor(record.source_path, name);
    } catch (err) {
      console.error("Failed to open backlink source:", err);
    }
  };

  const handleToggleBookmark = async () => {
    if (!activeTab?.path) return;
    try {
      const nowBookmarked = await invoke<boolean>("toggle_bookmark", {
        path: activeTab.path,
      });
      setIsBookmarked(nowBookmarked);
    } catch (err) {
      console.error("toggle_bookmark not yet available:", err);
    }
  };

  return (
    <div className={`context-panel ${visible ? "" : "collapsed"}`}>
      {/* Bookmark toggle button */}
      {activeTab && (
        <div className="context-panel-bookmark-row">
          <button
            className={`context-panel-bookmark-btn ${isBookmarked ? "active" : ""}`}
            title={isBookmarked ? "Remove bookmark" : "Bookmark this note"}
            onClick={handleToggleBookmark}
          >
            {isBookmarked ? "★" : "☆"}
          </button>
          <span className="context-panel-bookmark-label">
            {isBookmarked ? "Bookmarked" : "Bookmark"}
          </span>
        </div>
      )}

      {/* Backlinks section */}
      <div className="context-panel-section">
        <div
          className="context-panel-section-title collapsible"
          onClick={() => setBacklinksExpanded((v) => !v)}
        >
          <span className="collapse-arrow">{backlinksExpanded ? "▾" : "▸"}</span>
          Backlinks ({backlinks.length})
        </div>

        {backlinksExpanded && (
          <div className="backlinks-list">
            {backlinks.length === 0 ? (
              <div className="backlinks-empty">No backlinks</div>
            ) : (
              backlinks.map((record, i) => {
                const title =
                  record.source_title ||
                  record.source_path.split("/").pop() ||
                  record.source_path;
                return (
                  <div
                    key={`${record.source_path}-${i}`}
                    className="backlink-item"
                    onClick={() => handleBacklinkClick(record)}
                  >
                    <div className="backlink-title">{title}</div>
                    {record.context && (
                      <div className="backlink-context">{record.context}</div>
                    )}
                    {record.line_number != null && (
                      <div className="backlink-line">line {record.line_number}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Properties — placeholder */}
      <div className="context-panel-section">
        <div className="context-panel-section-title">Properties</div>
        <p style={{ color: "var(--text-tertiary)", fontSize: "12px", margin: 0 }}>
          Coming soon.
        </p>
      </div>

      {/* Outline — placeholder */}
      <div className="context-panel-section">
        <div className="context-panel-section-title">Outline</div>
        <p style={{ color: "var(--text-tertiary)", fontSize: "12px", margin: 0 }}>
          Coming soon.
        </p>
      </div>
    </div>
  );
}
