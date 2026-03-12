import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";

interface BookmarkRecord {
  path: string;
  title: string | null;
  label: string | null;
}

export function BookmarkStrip() {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const bookmarkVersion = useAppStore((s) => s.bookmarkVersion);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);

  const loadBookmarks = useCallback(async () => {
    try {
      const results = await invoke<BookmarkRecord[]>("get_bookmarks");
      setBookmarks(results);
    } catch (err) {
      console.error("Failed to load bookmarks:", err);
      setBookmarks([]);
    }
  }, []);

  useEffect(() => {
    if (sidebarVisible) loadBookmarks();
  }, [loadBookmarks, bookmarkVersion, sidebarVisible]);

  const handleBookmarkClick = async (bookmark: BookmarkRecord) => {
    const name =
      bookmark.title || bookmark.path.split("/").pop() || bookmark.path;
    try {
      await openFileInEditor(bookmark.path, name);
    } catch (err) {
      console.error("Failed to open bookmark:", err);
    }
  };

  return (
    <div className="sidebar-bookmarks">
      <div className="sidebar-bookmarks-header">
        <span>☆ Bookmarks</span>
      </div>
      {bookmarks.length === 0 ? (
        <div
          style={{
            padding: "8px 12px",
            color: "var(--text-tertiary)",
            fontSize: "12px",
          }}
        >
          No bookmarks yet
        </div>
      ) : (
        bookmarks.map((bookmark) => {
          const label =
            bookmark.label ||
            bookmark.title ||
            bookmark.path.split("/").pop() ||
            bookmark.path;
          const activeTab = tabs.find((t) => t.id === activeTabId);
          const isActive = activeTab?.path === bookmark.path;
          return (
            <div
              key={bookmark.path}
              className={`tree-item bookmark-item ${isActive ? "active" : ""}`}
              style={{ "--indent": 0 } as React.CSSProperties}
              onClick={() => handleBookmarkClick(bookmark)}
            >
              <span className="tree-item-icon">★</span>
              <span className="tree-item-label">{label}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
