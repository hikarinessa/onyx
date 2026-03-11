import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";
import { loadFileIntoCache } from "./Editor";

interface BookmarkRecord {
  path: string;
  title: string | null;
  label: string | null;
}

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
}

interface RegisteredDirectory {
  id: string;
  path: string;
  label: string;
  color: string;
  position: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: DirEntry;
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  activeFilePath: string | null;
  onFileClick: (path: string, name: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
}

function TreeNode({ entry, depth, activeFilePath, onFileClick, onContextMenu }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const toggle = async () => {
    if (!entry.is_dir) {
      onFileClick(entry.path, entry.name);
      return;
    }

    if (!loaded) {
      try {
        const entries = await invoke<DirEntry[]>("list_directory", {
          path: entry.path,
        });
        setChildren(entries);
        setLoaded(true);
      } catch (err) {
        console.error("Failed to list directory:", err);
      }
    }
    setExpanded(!expanded);
  };

  const isActive = entry.path === activeFilePath;
  const isMarkdown = entry.extension === "md";

  return (
    <div className={entry.is_dir ? "tree-directory" : "tree-file"}>
      <div
        className={`tree-item ${isActive ? "active" : ""}`}
        style={{ "--indent": depth } as React.CSSProperties}
        onClick={toggle}
        onContextMenu={(e) => onContextMenu(e, entry)}
      >
        <span className="tree-item-icon">
          {entry.is_dir ? (expanded ? "▾" : "▸") : isMarkdown ? "◇" : "·"}
        </span>
        <span className="tree-item-label">{entry.name}</span>
      </div>
      {entry.is_dir && expanded && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContextMenu({
  menu,
  onClose,
  onNewNote,
  onNewFolder,
  onRename,
  onDelete,
  onReveal,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onNewNote: (entry: DirEntry) => void;
  onNewFolder: (entry: DirEntry) => void;
  onRename: (entry: DirEntry) => void;
  onDelete: (entry: DirEntry) => void;
  onReveal: (entry: DirEntry) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Clamp to viewport after the menu renders and we know its dimensions
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad;
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = window.innerHeight - rect.height - pad;
    }
    if (x !== position.x || y !== position.y) {
      setPosition({ x, y });
    }
  }, [menu.x, menu.y]);

  const isDir = menu.entry.is_dir;

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          onNewNote(menu.entry);
          onClose();
        }}
      >
        {isDir ? "New Note" : "New Note (sibling)"}
      </div>
      {isDir && (
        <div
          className="context-menu-item"
          onClick={() => {
            onNewFolder(menu.entry);
            onClose();
          }}
        >
          New Folder
        </div>
      )}
      <div className="context-menu-separator" />
      <div
        className="context-menu-item"
        onClick={() => {
          onRename(menu.entry);
          onClose();
        }}
      >
        Rename
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          onReveal(menu.entry);
          onClose();
        }}
      >
        Reveal in Finder
      </div>
      <div className="context-menu-separator" />
      <div
        className="context-menu-item destructive"
        onClick={() => {
          onDelete(menu.entry);
          onClose();
        }}
      >
        Delete
      </div>
    </div>
  );
}

export function Sidebar() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const openFile = useAppStore((s) => s.openFile);
  const [directories, setDirectories] = useState<RegisteredDirectory[]>([]);
  const [rootEntries, setRootEntries] = useState<Map<string, DirEntry[]>>(
    new Map()
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const bookmarkVersion = useAppStore((s) => s.bookmarkVersion);

  const loadBookmarks = useCallback(async () => {
    try {
      const results = await invoke<BookmarkRecord[]>("get_bookmarks");
      setBookmarks(results);
    } catch {
      // Command may not be registered yet during development
      setBookmarks([]);
    }
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks, bookmarkVersion]);

  const addDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const dirPath = typeof selected === "string" ? selected : selected[0];
    if (!dirPath) return;
    const label = dirPath.split("/").pop() || dirPath;
    const colors = ["#6b9eff", "#ff6b9e", "#9eff6b", "#ffc46b", "#c46bff", "#6bffc4"];
    const color = colors[directories.length % colors.length];
    try {
      await invoke("register_directory", { path: dirPath, label, color });
      loadDirectories();
    } catch (err) {
      console.error("Failed to register directory:", err);
    }
  };

  const loadDirectories = useCallback(async () => {
    try {
      const dirs = await invoke<RegisteredDirectory[]>(
        "get_registered_directories"
      );
      setDirectories(dirs);

      const entries = new Map<string, DirEntry[]>();
      for (const dir of dirs) {
        try {
          const dirEntries = await invoke<DirEntry[]>("list_directory", {
            path: dir.path,
          });
          entries.set(dir.id, dirEntries);
        } catch (err) {
          console.error(`Failed to list ${dir.path}:`, err);
          entries.set(dir.id, []);
        }
      }
      setRootEntries(entries);
    } catch (err) {
      console.error("Failed to load directories:", err);
    }
  }, []);

  useEffect(() => {
    loadDirectories();
  }, [loadDirectories]);

  // Listen for file system changes to refresh
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const unlisten = listen("fs:change", () => {
      clearTimeout(timeout);
      timeout = setTimeout(loadDirectories, 1000);
    });

    return () => {
      clearTimeout(timeout);
      unlisten.then((fn) => fn());
    };
  }, [loadDirectories]);

  const handleFileClick = async (path: string, name: string) => {
    if (!name.endsWith(".md")) return;

    try {
      await openFileInEditor(path, name);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const findAvailablePath = async (dir: string): Promise<{ path: string; name: string }> => {
    const baseName = "Untitled";
    let name = `${baseName}.md`;
    let path = `${dir}/${name}`;
    let counter = 1;

    // Check existence via read_file — if it succeeds, the file exists
    while (true) {
      try {
        await invoke("read_file", { path });
        // File exists, try next number
        counter++;
        name = `${baseName} ${counter}.md`;
        path = `${dir}/${name}`;
      } catch {
        // File doesn't exist — path is available
        break;
      }
    }

    return { path, name };
  };

  const handleNewNote = async (entry: DirEntry) => {
    const dir = entry.is_dir ? entry.path : entry.path.replace(/\/[^/]+$/, "");
    try {
      const { path, name } = await findAvailablePath(dir);
      await invoke("write_file", { path, content: "" });
      loadFileIntoCache(path, "");
      openFile(path, name);
      loadDirectories();
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  };

  const handleNewNoteInDir = async (dirPath: string) => {
    try {
      const { path, name } = await findAvailablePath(dirPath);
      await invoke("write_file", { path, content: "" });
      loadFileIntoCache(path, "");
      openFile(path, name);
      loadDirectories();
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  };

  const handleNewFolder = async (entry: DirEntry) => {
    const dir = entry.is_dir ? entry.path : entry.path.replace(/\/[^/]+$/, "");
    console.log("TODO: create_folder command", `${dir}/New Folder`);
  };

  const handleRename = async (entry: DirEntry) => {
    console.log("TODO: rename_file command", entry.path);
  };

  const handleDelete = async (entry: DirEntry) => {
    try {
      await invoke("trash_file", { path: entry.path });
      loadDirectories();
    } catch (err) {
      console.log("TODO: trash_file command not yet implemented", entry.path);
    }
  };

  const handleReveal = async (entry: DirEntry) => {
    try {
      await invoke("reveal_in_finder", { path: entry.path });
    } catch (err) {
      console.log("TODO: reveal_in_finder command not yet implemented", entry.path);
    }
  };

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
    <div className={`sidebar ${sidebarVisible ? "" : "collapsed"}`}>
      <div className="sidebar-directories">
      {directories.length === 0 ? (
        <div className="sidebar-empty">
          <p
            style={{
              padding: "16px 12px",
              color: "var(--text-tertiary)",
              fontSize: "12px",
              lineHeight: "1.5",
            }}
          >
            No directories registered.
          </p>
          <button
            className="sidebar-add-folder-btn"
            onClick={addDirectory}
            style={{
              margin: "0 12px",
              padding: "8px 12px",
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              fontSize: "12px",
              cursor: "pointer",
              width: "calc(100% - 24px)",
            }}
          >
            Add Folder
          </button>
        </div>
      ) : (
        directories.map((dir) => (
          <div key={dir.id} className="sidebar-directory">
            <div
              className="sidebar-header"
              style={{ borderLeft: `2px solid ${dir.color}` }}
            >
              <span className="sidebar-header-label">{dir.label}</span>
              <div className="sidebar-header-actions">
                <button
                  className="sidebar-header-btn"
                  title="New Note"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNewNoteInDir(dir.path);
                  }}
                >
                  +
                </button>
                <button
                  className="sidebar-header-btn"
                  title="Refresh"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadDirectories();
                  }}
                >
                  ↻
                </button>
              </div>
            </div>
            <div className="sidebar-content">
              {(rootEntries.get(dir.id) || []).map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  activeFilePath={activeTabId}
                  onFileClick={handleFileClick}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          </div>
        ))
      )}

      </div>

      {/* Bookmarks — pinned at bottom */}
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

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewNote={handleNewNote}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
          onReveal={handleReveal}
        />
      )}
    </div>
  );
}
