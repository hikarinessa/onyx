import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";
import * as fileOps from "../lib/fileOps";
import type { DirEntry } from "../types";
import { BookmarkStrip } from "./BookmarkStrip";
import { SidebarContextMenu, type ContextMenuState } from "./SidebarContextMenu";

interface RegisteredDirectory {
  id: string;
  path: string;
  label: string;
  color: string;
  position: number;
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
  onFileClick: (path: string, name: string, metaKey: boolean) => void;
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

  const toggle = async (e: React.MouseEvent) => {
    if (!entry.is_dir) {
      onFileClick(entry.path, entry.name, e.metaKey);
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

export function Sidebar() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const fileTreeVersion = useAppStore((s) => s.fileTreeVersion);
  const collapsedDirs = useAppStore((s) => s.collapsedDirs);
  const toggleDirCollapsed = useAppStore((s) => s.toggleDirCollapsed);
  const orphanPaths = useAppStore((s) => s.orphanPaths);
  const [directories, setDirectories] = useState<RegisteredDirectory[]>([]);
  const [rootEntries, setRootEntries] = useState<Map<string, DirEntry[]>>(
    new Map()
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

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
      const dir = directories.find((d) => d.id === id);
      if (dir) {
        const store = useAppStore.getState();
        const affectedTabs = store.tabs.filter((t) =>
          t.path.startsWith(dir.path + "/") || t.path === dir.path
        );
        if (affectedTabs.length > 0) {
          const noun = affectedTabs.length === 1 ? "tab" : "tabs";
          const close = window.confirm(
            `Close ${affectedTabs.length} open ${noun} from "${dir.label}"?`
          );
          if (close) {
            for (const tab of affectedTabs) {
              store.closeTab(tab.id);
            }
          }
        }
      }
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
    let cancelled = false;
    const unlisten = listen("fs:change", () => {
      if (cancelled) return;
      clearTimeout(timeout);
      timeout = setTimeout(loadDirectories, 1000);
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      unlisten.then((fn) => fn());
    };
  }, [loadDirectories]);

  const handleFileClick = async (path: string, name: string, metaKey: boolean) => {
    if (!name.endsWith(".md")) return;

    try {
      await openFileInEditor(path, name, { replaceActive: !metaKey });
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
        directories.map((dir) => {
          const isCollapsed = collapsedDirs.includes(dir.id);
          return (
            <div key={dir.id} className="sidebar-directory">
              <div
                className="sidebar-header"
                style={{ borderLeft: `2px solid ${dir.color}` }}
                onClick={() => toggleDirCollapsed(dir.id)}
              >
                <span className="sidebar-header-chevron">
                  {isCollapsed ? "▸" : "▾"}
                </span>
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
              {!isCollapsed && (
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
              )}
            </div>
          );
        })
      )}
      {orphanPaths.length > 0 && (
        <div className="sidebar-directory">
          <div className="sidebar-header" style={{ borderLeft: "2px solid var(--text-tertiary)" }}>
            <span className="sidebar-header-chevron">▾</span>
            <span className="sidebar-header-label">Orphan Notes</span>
          </div>
          <div className="sidebar-content">
            {orphanPaths.map((p) => {
              const name = p.split("/").pop() || p;
              const isActive = p === activeTabId;
              return (
                <div
                  key={p}
                  className={`tree-item ${isActive ? "active" : ""}`}
                  style={{ "--indent": 0 } as React.CSSProperties}
                  onClick={(e) => handleFileClick(p, name, e.metaKey)}
                >
                  <span className="tree-item-icon">◇</span>
                  <span className="tree-item-label">{name}</span>
                  <button
                    className="tab-close"
                    style={{ opacity: 1, fontSize: "12px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      useAppStore.getState().removeOrphanPath(p);
                      invoke("disallow_path", { path: p }).catch(() => {});
                    }}
                    title="Remove from orphan notes"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button
        className="sidebar-add-folder-btn"
        onClick={addDirectory}
        title="Add Folder"
      >
        + Add Folder
      </button>

      </div>

      <BookmarkStrip />

      {contextMenu && (
        <SidebarContextMenu
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
