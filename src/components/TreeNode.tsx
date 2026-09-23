import { memo, useState, useEffect, useRef, useContext } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectActiveTabPath } from "../stores/app";
import type { DirEntry } from "../types";
import { Icon } from "./Icon";
import { TreeIcon } from "./TreeIcon";
import { TreeStylesContext } from "../lib/treeStyles";

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

/**
 * Props are primitives or callbacks the sidebar keeps stable, so a node re-renders only
 * when something it shows changes. Expansion and the active file are read from the store
 * per node as booleans, so expanding one folder or switching tabs re-renders the nodes
 * whose answer changed rather than the whole tree. Icon and colour come from
 * TreeStylesContext, which re-renders every node when the styles change.
 */
interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  renamingPath: string | null;
  /** The file a reveal just scrolled to; it flashes once so the eye lands on it. */
  flashPath: string | null;
  fileTreeVersion: number;
  sortOrder: string;
  onFileClick: (path: string, name: string, metaKey: boolean) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
  onRenameSubmit: (entry: DirEntry, newName: string) => void;
  onRenameCancel: () => void;
  /** Arms a file drag-to-move; it starts only once the pointer passes the threshold. */
  onDragStart: (sourcePath: string, sourceEl: HTMLElement, startY: number) => void;
}

export const TreeNode = memo(function TreeNode({ entry, depth, renamingPath, flashPath, fileTreeVersion, sortOrder, onFileClick, onContextMenu, onRenameSubmit, onRenameCancel, onDragStart }: TreeNodeProps) {
  const expanded = useAppStore((s) => entry.is_dir && s.expandedSubdirs.includes(entry.path));
  const isActive = useAppStore((s) => selectActiveTabPath(s) === entry.path);
  const toggleSubdirExpanded = useAppStore((s) => s.toggleSubdirExpanded);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Re-fetch children when fileTreeVersion bumps or sort order changes.
  // On error, keep prior children — a transient IPC failure (e.g. DB lock contention during
  // a concurrent reconcile) would otherwise make the folder appear empty. If the folder was
  // actually deleted, the parent's loadDirectories will drop it from the tree entirely.
  useEffect(() => {
    if (expanded && loaded && entry.is_dir) {
      invoke<DirEntry[]>("list_directory", { path: entry.path, sortOrder })
        .then(setChildren)
        .catch((err) => console.error(`list_directory refetch failed for ${entry.path}:`, err));
    }
  }, [fileTreeVersion, sortOrder]); // eslint-disable-line -- only re-fetch on version/sort bump

  // Load children when first expanded (from persisted state or user click)
  useEffect(() => {
    if (expanded && !loaded && entry.is_dir) {
      invoke<DirEntry[]>("list_directory", { path: entry.path, sortOrder })
        .then((entries) => { setChildren(entries); setLoaded(true); })
        .catch(() => {});
    }
  }, [expanded, loaded, entry.is_dir, entry.path, sortOrder]);

  const toggle = async (e: React.MouseEvent) => {
    if (!entry.is_dir) {
      onFileClick(entry.path, entry.name, e.metaKey);
      return;
    }

    if (!loaded) {
      try {
        const entries = await invoke<DirEntry[]>("list_directory", {
          path: entry.path,
          sortOrder,
        });
        setChildren(entries);
        setLoaded(true);
      } catch (err) {
        console.error("Failed to list directory:", err);
      }
    }
    toggleSubdirExpanded(entry.path);
  };

  const isMarkdown = entry.extension === "md";
  const style = useContext(TreeStylesContext)[entry.path];
  const isRenaming = renamingPath === entry.path;

  return (
    <div className={entry.is_dir ? "tree-directory" : "tree-file"}>
      <div
        className={`tree-item ${isActive ? "active" : ""} ${flashPath === entry.path ? "tree-reveal-flash" : ""}`}
        style={{ "--indent": depth } as React.CSSProperties}
        onClick={isRenaming ? undefined : toggle}
        onContextMenu={(e) => onContextMenu(e, entry)}
        onPointerDown={(e) => {
          // Only initiate drag for files (not dirs), left button, not renaming
          if (entry.is_dir || isRenaming || e.button !== 0) return;
          onDragStart(entry.path, e.currentTarget, e.clientY);
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
          <TreeIcon
            name={style?.icon}
            fallback={entry.is_dir ? "folder" : isMarkdown ? "file-text" : "file"}
            color={style?.color}
            size={15}
          />
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
              renamingPath={renamingPath}
              flashPath={flashPath}
              fileTreeVersion={fileTreeVersion}
              sortOrder={sortOrder}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onDragStart={onDragStart}
            />
          ))}
        </div>
      )}
    </div>
  );
});
