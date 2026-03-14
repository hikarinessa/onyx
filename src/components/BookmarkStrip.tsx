import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectActiveTabPath } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";
import { Icon } from "./Icon";

interface BookmarkRecord {
  path: string;
  title: string | null;
  label: string | null;
}

interface GlobalBookmark {
  path: string;
  label: string;
}

interface DisplayBookmark {
  path: string;
  label: string;
  global: boolean;
}

export function BookmarkStrip() {
  const activeTabPath = useAppStore(selectActiveTabPath);
  const bookmarkVersion = useAppStore((s) => s.bookmarkVersion);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const [bookmarks, setBookmarks] = useState<DisplayBookmark[]>([]);

  const loadBookmarks = useCallback(async () => {
    try {
      const [dirBookmarks, globalBookmarks] = await Promise.all([
        invoke<BookmarkRecord[]>("get_bookmarks"),
        invoke<GlobalBookmark[]>("get_global_bookmarks"),
      ]);

      const display: DisplayBookmark[] = [
        ...dirBookmarks.map((b) => ({
          path: b.path,
          label: b.label || b.title || b.path.split("/").pop() || b.path,
          global: false,
        })),
        ...globalBookmarks.map((b) => ({
          path: b.path,
          label: b.label || b.path.split("/").pop() || b.path,
          global: true,
        })),
      ];
      setBookmarks(display);
    } catch (err) {
      console.error("Failed to load bookmarks:", err);
      setBookmarks([]);
    }
  }, []);

  useEffect(() => {
    if (sidebarVisible) loadBookmarks();
  }, [loadBookmarks, bookmarkVersion, sidebarVisible]);

  const handleBookmarkClick = async (bookmark: DisplayBookmark, newTab: boolean) => {
    const name = bookmark.label;
    try {
      await openFileInEditor(bookmark.path, name, { replaceActive: !newTab });
    } catch (err) {
      console.error("Failed to open bookmark:", err);
    }
  };

  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="sidebar-bookmarks">
      <div
        className="sidebar-bookmarks-header"
        onClick={() => setCollapsed((c) => !c)}
        style={{ cursor: "pointer" }}
      >
        <span className="sidebar-bookmarks-header-content">
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={14} />
          <Icon name="bookmark" size={14} />
          Bookmarks
        </span>
      </div>
      {!collapsed && (
        bookmarks.length === 0 ? (
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
            const isActive = activeTabPath === bookmark.path;
            return (
              <div
                key={bookmark.path}
                className={`tree-item bookmark-item ${isActive ? "active" : ""}`}
                style={{ "--indent": 0 } as React.CSSProperties}
                onClick={(e) => handleBookmarkClick(bookmark, e.metaKey)}
                title={bookmark.path}
              >
                <span className="tree-item-icon">
                  <Icon name={bookmark.global ? "bookmark-check" : "star"} size={14} />
                </span>
                <span className="tree-item-label">{bookmark.label}</span>
              </div>
            );
          })
        )
      )}
    </div>
  );
}
