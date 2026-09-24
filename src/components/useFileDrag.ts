import { useCallback, useEffect, useRef } from "react";
import * as fileOps from "../lib/fileOps";

const DRAG_THRESHOLD = 5;

interface FileDragState {
  sourcePath: string;
  sourceEl: HTMLElement;
  startY: number;
  active: boolean;
}

/**
 * Pointer-based drag-to-move for files in the tree. HTML5 drag-drop doesn't work in
 * Tauri because its native handler intercepts drops.
 *
 * A pointerdown arms the drag; it starts once the pointer moves DRAG_THRESHOLD px
 * vertically. Folder rows (`data-tree-dir="true"`) under the pointer get `drop-target`,
 * except the file's own ancestors. Dropping moves the file through fileOps.renameFile.
 * Dropping on a canvas board (`data-canvas-drop`) hands the file to the board instead.
 *
 * Returns the function a row calls on pointerdown; it keeps one identity.
 */
export function useFileDrag(): (sourcePath: string, sourceEl: HTMLElement, startY: number) => void {
  const dragRef = useRef<FileDragState | null>(null);
  const dropTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const clearHighlight = (path: string) => {
      document.querySelector(`[data-tree-path="${CSS.escape(path)}"]`)?.classList.remove("drop-target");
    };

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      // Activate drag after threshold
      if (!drag.active) {
        if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.active = true;
        drag.sourceEl.style.opacity = "0.4";
        document.body.classList.add("dragging");
      }

      // Hit-test: find the folder element under the pointer
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const folderEl = els.find(
        (el) => el instanceof HTMLElement && el.dataset.treeDir === "true"
      ) as HTMLElement | undefined;

      const newTarget = folderEl?.dataset.treePath ?? null;

      // Don't allow dropping into the file's own parent
      if (newTarget && drag.sourcePath.startsWith(newTarget + "/")) {
        if (dropTargetRef.current) {
          clearHighlight(dropTargetRef.current);
          dropTargetRef.current = null;
        }
        return;
      }

      if (newTarget !== dropTargetRef.current) {
        if (dropTargetRef.current) clearHighlight(dropTargetRef.current);
        if (newTarget) folderEl?.classList.add("drop-target");
        dropTargetRef.current = newTarget;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const target = dropTargetRef.current;

      // Reset visual state
      drag.sourceEl.style.opacity = "";
      document.body.classList.remove("dragging");
      if (target) clearHighlight(target);

      // Dropped on a canvas: the board places the file as a card where it landed
      if (drag.active && !target) {
        const board = document.elementsFromPoint(e.clientX, e.clientY)
          .find((el) => el instanceof HTMLElement && el.dataset.canvasDrop !== undefined);
        board?.dispatchEvent(new CustomEvent("canvas-drop", {
          detail: { path: drag.sourcePath, clientX: e.clientX, clientY: e.clientY },
        }));
      }

      // Perform the move
      if (drag.active && target) {
        const fileName = drag.sourcePath.split("/").pop();
        if (fileName) {
          const newPath = `${target}/${fileName}`;
          fileOps.renameFile(drag.sourcePath, newPath).catch((err) =>
            console.error("Failed to move file:", err)
          );
        }
      }

      dragRef.current = null;
      dropTargetRef.current = null;
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  return useCallback((sourcePath: string, sourceEl: HTMLElement, startY: number) => {
    dragRef.current = { sourcePath, sourceEl, startY, active: false };
  }, []);
}
