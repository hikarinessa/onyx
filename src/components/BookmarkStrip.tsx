import { useState, useEffect, useCallback, useContext } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectActiveTabPath } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";
import { Icon } from "./Icon";
import { TreeIcon } from "./TreeIcon";
import { TreeStylesContext } from "../lib/treeStyles";

interface Bookmark {
  path: string;
  label: string;
  position: number;
}

export function BookmarkStrip() {
  const activeTabPath = useAppStore(selectActiveTabPath);
  const bookmarkVersion = useAppStore((s) => s.bookmarkVersion);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const treeStyles = useContext(TreeStylesContext);

  const loadBookmarks = useCallback(async () => {
    try {
      const bm = await invoke<Bookmark[]>("get_bookmarks");
      setBookmarks(bm);
    } catch (err) {
      console.error("Failed to load bookmarks:", err);
      setBookmarks([]);
    }
  }, []);

  useEffect(() => {
    if (sidebarVisible) loadBookmarks();
  }, [loadBookmarks, bookmarkVersion, sidebarVisible]);

  const handleBookmarkClick = async (bookmark: Bookmark, newTab: boolean) => {
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
            // A bookmarked note shows its own icon and colour from the tree, if it has them
            const style = treeStyles[bookmark.path];
            return (
              <div
                key={bookmark.path}
                className={`tree-item bookmark-item ${isActive ? "active" : ""}`}
                style={{ "--indent": 0 } as React.CSSProperties}
                onClick={(e) => handleBookmarkClick(bookmark, e.metaKey)}
                title={bookmark.path}
              >
                <span className="tree-item-chevron" />
                <span className="tree-item-icon">
                  <TreeIcon name={style?.icon} fallback="bookmark-simple" color={style?.color} size={15} />
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
