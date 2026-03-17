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

// Pointer-based drag state (HTML5 drag-drop doesn't work in Tauri — native handler intercepts drops)
let dragState: {
  sourcePath: string;
  sourceEl: HTMLElement;
  startY: number;
  active: boolean;
} | null = null;
let currentDropTarget: string | null = null;

function RootDirContextMenu({ x, y, onClose, onNewNote, onNewFolder, onReveal, onUnregister }: {
  x: number; y: number;
  onClose: () => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onReveal: () => void;
  onUnregister: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" style={{ left: x, top: y, position: "fixed", zIndex: 1000 }}>
      <div className="context-menu-item" onClick={onNewNote}>New Note</div>
      <div className="context-menu-item" onClick={onNewFolder}>New Folder</div>
      <div className="context-menu-separator" />
      <div className="context-menu-item" onClick={onReveal}>Reveal in Finder</div>
      <div className="context-menu-separator" />
      <div className="context-menu-item destructive" onClick={onUnregister}>Unregister Directory</div>
    </div>
  );
}
import { SearchPanel } from "./SearchPanel";
import { Icon } from "./Icon";
import { IconPicker } from "./IconPicker";

interface RegisteredDirectory {
  id: string;
  path: string;
  label: string;
  color: string;
  position: number;
  icon: string;
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
  const expandedSubdirs = useAppStore((s) => s.expandedSubdirs);
  const toggleSubdirExpanded = useAppStore((s) => s.toggleSubdirExpanded);
  const expanded = entry.is_dir && expandedSubdirs.includes(entry.path);
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

  // Load children when first expanded (from persisted state or user click)
  useEffect(() => {
    if (expanded && !loaded && entry.is_dir) {
      invoke<DirEntry[]>("list_directory", { path: entry.path })
        .then((entries) => { setChildren(entries); setLoaded(true); })
        .catch(() => {});
    }
  }, [expanded, loaded, entry.is_dir, entry.path]);

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
    toggleSubdirExpanded(entry.path);
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
        onPointerDown={(e) => {
          // Only initiate drag for files (not dirs), left button, not renaming
          if (entry.is_dir || isRenaming || e.button !== 0) return;
          const el = e.currentTarget;
          dragState = { sourcePath: entry.path, sourceEl: el, startY: e.clientY, active: false };
        }}
        data-tree-path={entry.path}
        data-tree-dir={entry.is_dir ? "true" : undefined}
      >
        <span className="tree-item-chevron">
          {entry.is_dir
            ? <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} />
            : null}
        </span>
        <span className="tree-item-icon">
          {entry.is_dir
            ? <Icon name="folder" size={14} />
            : <Icon name={isMarkdown ? "file-text" : "file"} size={14} />}
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
  const [rootDirMenu, setRootDirMenu] = useState<{ x: number; y: number; dirPath: string; dirId: string } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [iconPickerDirId, setIconPickerDirId] = useState<string | null>(null);
  const [orphansCollapsed, setOrphansCollapsed] = useState(false);
  const iconPickerDirIdRef = useRef(iconPickerDirId);
  iconPickerDirIdRef.current = iconPickerDirId;

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

  // Pointer-based drag-and-drop for moving files into folders
  useEffect(() => {
    const DRAG_THRESHOLD = 5;

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragState) return;

      // Activate drag after threshold
      if (!dragState.active) {
        if (Math.abs(e.clientY - dragState.startY) < DRAG_THRESHOLD) return;
        dragState.active = true;
        dragState.sourceEl.style.opacity = "0.4";
        document.body.classList.add("dragging");
      }

      // Hit-test: find the folder element under the pointer
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const folderEl = els.find(
        (el) => el instanceof HTMLElement && el.dataset.treeDir === "true"
      ) as HTMLElement | undefined;

      const newTarget = folderEl?.dataset.treePath ?? null;

      // Don't allow dropping into the file's own parent
      if (newTarget && dragState.sourcePath.startsWith(newTarget + "/")) {
        if (currentDropTarget) {
          document.querySelector(`[data-tree-path="${CSS.escape(currentDropTarget)}"]`)?.classList.remove("drop-target");
          currentDropTarget = null;
        }
        return;
      }

      if (newTarget !== currentDropTarget) {
        // Remove old highlight
        if (currentDropTarget) {
          document.querySelector(`[data-tree-path="${CSS.escape(currentDropTarget)}"]`)?.classList.remove("drop-target");
        }
        // Add new highlight
        if (newTarget) {
          folderEl?.classList.add("drop-target");
        }
        currentDropTarget = newTarget;
      }
    };

    const handlePointerUp = () => {
      if (!dragState) return;
      const wasActive = dragState.active;
      const sourcePath = dragState.sourcePath;

      // Reset visual state
      dragState.sourceEl.style.opacity = "";
      document.body.classList.remove("dragging");
      if (currentDropTarget) {
        document.querySelector(`[data-tree-path="${CSS.escape(currentDropTarget)}"]`)?.classList.remove("drop-target");
      }

      // Perform the move
      if (wasActive && currentDropTarget) {
        const targetDir = currentDropTarget;
        const fileName = sourcePath.split("/").pop();
        if (fileName) {
          const newPath = `${targetDir}/${fileName}`;
          fileOps.renameFile(sourcePath, newPath).catch((err) =>
            console.error("Failed to move file:", err)
          );
        }
      }

      dragState = null;
      currentDropTarget = null;
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

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

  const sidebarTab = useAppStore((s) => s.sidebarTab);
  const setSidebarTab = useAppStore((s) => s.setSidebarTab);

  return (
    <div className={`sidebar ${sidebarVisible ? "" : "collapsed"}`}>
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${sidebarTab === "files" ? "active" : ""}`}
          onClick={() => setSidebarTab("files")}
        >
          <Icon name="folder" size={13} />
          <span>Files</span>
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === "search" ? "active" : ""}`}
          onClick={() => setSidebarTab("search")}
        >
          <Icon name="search" size={13} />
          <span>Search</span>
        </button>
      </div>

      {sidebarTab === "search" ? (
        <SearchPanel />
      ) : (
      <>
      <button
        className="sidebar-add-folder-btn"
        onClick={addDirectory}
        title="Add Folder"
      >
        <Icon name="folder-plus" size={14} /> Add Folder
      </button>
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRootDirMenu({ x: e.clientX, y: e.clientY, dirPath: dir.path, dirId: dir.id });
                }}
              >
                <span className="sidebar-header-chevron">
                  <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={14} />
                </span>
                <span
                  className="sidebar-header-icon"
                  title="Change icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIconPickerDirId(dir.id);
                  }}
                >
                  <Icon name={dir.icon || "folder"} size={14} />
                </span>
                <span className="sidebar-header-label">{dir.label}</span>
                <div className="sidebar-header-actions" />
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
          <div
            className="sidebar-header"
            style={{ borderLeft: "2px solid var(--text-tertiary)" }}
            onClick={() => setOrphansCollapsed((c) => !c)}
          >
            <span className="sidebar-header-chevron">
              <Icon name={orphansCollapsed ? "chevron-right" : "chevron-down"} size={14} />
            </span>
            <span className="sidebar-header-icon">
              <Icon name="folder-x" size={14} />
            </span>
            <span className="sidebar-header-label">Orphan Notes</span>
          </div>
          {!orphansCollapsed && <div className="sidebar-content">
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
                  <span className="tree-item-chevron" />
                  <span className="tree-item-icon"><Icon name="file-text" size={14} /></span>
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
                    <Icon name="x" size={12} />
                  </button>
                </div>
              );
            })}
          </div>}
        </div>
      )}

      </div>

      <BookmarkStrip />
      </>
      )}

      {iconPickerDirId && (
        <IconPicker
          currentIcon={directories.find((d) => d.id === iconPickerDirId)?.icon || "folder"}
          onSelect={async (icon) => {
            const dirId = iconPickerDirIdRef.current;
            if (!dirId) return;
            try {
              await invoke("update_directory_icon", { id: dirId, icon });
              loadDirectories();
            } catch (err) {
              console.error("Failed to update directory icon:", err);
            }
            setIconPickerDirId(null);
          }}
          onClose={() => setIconPickerDirId(null)}
        />
      )}

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

      {rootDirMenu && (
        <RootDirContextMenu
          x={rootDirMenu.x}
          y={rootDirMenu.y}
          onClose={() => setRootDirMenu(null)}
          onNewNote={() => { handleNewNoteInDir(rootDirMenu.dirPath); setRootDirMenu(null); }}
          onNewFolder={async () => {
            try {
              const folderPath = await fileOps.createFolder(rootDirMenu.dirPath);
              setRenamingPath(folderPath);
            } catch (err) {
              console.error("Failed to create folder:", err);
            }
            setRootDirMenu(null);
          }}
          onReveal={() => { fileOps.revealInFinder(rootDirMenu.dirPath); setRootDirMenu(null); }}
          onUnregister={() => { removeDirectory(rootDirMenu.dirId); setRootDirMenu(null); }}
        />
      )}
    </div>
  );
}
