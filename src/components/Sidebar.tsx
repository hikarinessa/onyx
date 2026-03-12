import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";
import * as fileOps from "../lib/fileOps";

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

function RenameInput({
  initialName,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // Select the name without the extension
      const dot = initialName.lastIndexOf(".");
      inputRef.current.setSelectionRange(0, dot > 0 ? dot : initialName.length);
    }
  }, [initialName]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialName) {
      onSubmit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      className="tree-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        e.stopPropagation();
      }}
      onBlur={submit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  activeFilePath: string | null;
  renamingPath: string | null;
  fileTreeVersion: number;
  onFileClick: (path: string, name: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
  onRenameSubmit: (entry: DirEntry, newName: string) => void;
  onRenameCancel: () => void;
}

function TreeNode({ entry, depth, activeFilePath, renamingPath, fileTreeVersion, onFileClick, onContextMenu, onRenameSubmit, onRenameCancel }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Re-fetch children when fileTreeVersion bumps (file was created/renamed/deleted)
  useEffect(() => {
    if (expanded && loaded && entry.is_dir) {
      invoke<DirEntry[]>("list_directory", { path: entry.path })
        .then(setChildren)
        .catch(() => { setChildren([]); setLoaded(false); });
    }
  }, [fileTreeVersion]); // eslint-disable-line -- only re-fetch on version bump

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
  const isRenaming = renamingPath === entry.path;

  return (
    <div className={entry.is_dir ? "tree-directory" : "tree-file"}>
      <div
        className={`tree-item ${isActive ? "active" : ""}`}
        style={{ "--indent": depth } as React.CSSProperties}
        onClick={isRenaming ? undefined : toggle}
        onContextMenu={(e) => onContextMenu(e, entry)}
      >
        <span className="tree-item-icon">
          {entry.is_dir ? (expanded ? "▾" : "▸") : isMarkdown ? "◇" : "·"}
        </span>
        {isRenaming ? (
          <RenameInput
            initialName={entry.name}
            onSubmit={(newName) => onRenameSubmit(entry, newName)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="tree-item-label">{entry.name}</span>
        )}
      </div>
      {entry.is_dir && expanded && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              renamingPath={renamingPath}
              fileTreeVersion={fileTreeVersion}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
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
  const fileTreeVersion = useAppStore((s) => s.fileTreeVersion);
  const [directories, setDirectories] = useState<RegisteredDirectory[]>([]);
  const [rootEntries, setRootEntries] = useState<Map<string, DirEntry[]>>(
    new Map()
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
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
    if (sidebarVisible) loadBookmarks();
  }, [loadBookmarks, bookmarkVersion, sidebarVisible]);

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

  const removeDirectory = async (id: string) => {
    try {
      await invoke("unregister_directory", { id });
      loadDirectories();
    } catch (err) {
      console.error("Failed to unregister directory:", err);
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

  // Refresh root entries when fileTreeVersion bumps (file mutation happened)
  useEffect(() => {
    if (fileTreeVersion > 0) loadDirectories();
  }, [fileTreeVersion]); // eslint-disable-line -- intentionally only react to version bumps

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

  const handleNewNote = async (entry: DirEntry) => {
    const dir = entry.is_dir ? entry.path : entry.path.replace(/\/[^/]+$/, "");
    try {
      const newPath = await fileOps.createNote(dir);
      setRenamingPath(newPath);
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  };

  const handleNewNoteInDir = async (dirPath: string) => {
    try {
      const newPath = await fileOps.createNote(dirPath);
      setRenamingPath(newPath);
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  };

  const handleNewFolder = async (entry: DirEntry) => {
    const dir = entry.is_dir ? entry.path : entry.path.replace(/\/[^/]+$/, "");
    try {
      const folderPath = await fileOps.createFolder(dir);
      setRenamingPath(folderPath);
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  };

  const handleRename = (entry: DirEntry) => {
    setRenamingPath(entry.path);
  };

  const handleRenameSubmit = async (entry: DirEntry, newName: string) => {
    const dir = entry.path.replace(/\/[^/]+$/, "");
    const newPath = `${dir}/${newName}`;
    try {
      if (entry.is_dir) {
        await fileOps.renameFolder(entry.path, newPath);
      } else {
        await fileOps.renameFile(entry.path, newPath);
      }
    } catch (err) {
      console.error("Failed to rename:", err);
    }
    setRenamingPath(null);
  };

  const handleRenameCancel = () => {
    setRenamingPath(null);
  };

  const handleDelete = async (entry: DirEntry) => {
    try {
      await fileOps.deleteFile(entry.path);
    } catch (err) {
      console.error("Failed to trash file:", err);
    }
  };

  const handleReveal = async (entry: DirEntry) => {
    try {
      await fileOps.revealInFinder(entry.path);
    } catch (err) {
      console.error("Failed to reveal in Finder:", err);
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
                <button
                  className="sidebar-header-btn"
                  title="Remove Directory"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDirectory(dir.id);
                  }}
                >
                  ×
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
                  renamingPath={renamingPath}
                  fileTreeVersion={fileTreeVersion}
                  onFileClick={handleFileClick}
                  onContextMenu={handleContextMenu}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={handleRenameCancel}
                />
              ))}
            </div>
          </div>
        ))
      )}
      <button
        className="sidebar-add-folder-btn"
        onClick={addDirectory}
        title="Add Folder"
      >
        + Add Folder
      </button>

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
