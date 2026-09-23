import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const DRAG_THRESHOLD = 5;

interface DirDragState {
  dirId: string;
  sourceEl: HTMLElement;
  startY: number;
  active: boolean;
}

/**
 * Pointer-based reorder of registered root directories by dragging their headers.
 *
 * A pointerdown on a header arms the drag; it starts once the pointer moves
 * DRAG_THRESHOLD px vertically. The header under the pointer (`data-dir-id`,
 * `data-dir-idx`) gets `dir-drop-above` or `dir-drop-below` depending on which side of
 * the source it sits. Dropping reorders `directories` optimistically, persists through
 * `reorder_directories`, and reloads from Rust if that fails.
 *
 * Returns the function a header calls on pointerdown; it keeps one identity.
 */
export function useDirReorder<D extends { id: string }>(
  directories: D[],
  setDirectories: (dirs: D[]) => void,
  loadDirectories: () => void,
): (dirId: string, sourceEl: HTMLElement, startY: number) => void {
  const dragRef = useRef<DirDragState | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const clearIndicators = () => {
      document.querySelectorAll(".sidebar-header.dir-drop-above, .sidebar-header.dir-drop-below").forEach(
        (el) => { el.classList.remove("dir-drop-above", "dir-drop-below"); }
      );
    };

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (!drag.active) {
        if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.active = true;
        drag.sourceEl.classList.add("dragging");
        document.body.classList.add("dragging");
      }

      // Hit-test: find directory header under pointer
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const headerEl = els.find(
        (el) => el instanceof HTMLElement && el.dataset.dirId && el.dataset.dirId !== drag.dirId
      ) as HTMLElement | undefined;

      const newIdx = headerEl ? Number(headerEl.dataset.dirIdx) : null;

      if (newIdx !== dropIndexRef.current) {
        clearIndicators();
        if (headerEl && newIdx !== null) {
          const sourceIdx = directories.findIndex((d) => d.id === drag.dirId);
          headerEl.classList.add(newIdx < sourceIdx ? "dir-drop-above" : "dir-drop-below");
        }
        dropIndexRef.current = newIdx;
      }
    };

    const handlePointerUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      const toIdx = dropIndexRef.current;

      // Reset visual state
      drag.sourceEl.classList.remove("dragging");
      document.body.classList.remove("dragging");
      clearIndicators();

      if (drag.active && toIdx !== null) {
        const fromIdx = directories.findIndex((d) => d.id === drag.dirId);
        if (fromIdx !== -1 && fromIdx !== toIdx) {
          const reordered = [...directories];
          const [moved] = reordered.splice(fromIdx, 1);
          reordered.splice(toIdx, 0, moved);
          // Optimistic UI update
          setDirectories(reordered);
          // Persist
          invoke("reorder_directories", { orderedIds: reordered.map((d) => d.id) })
            .catch((err) => {
              console.error("Failed to reorder directories:", err);
              loadDirectories(); // rollback on failure
            });
        }
      }

      dragRef.current = null;
      dropIndexRef.current = null;
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [directories, setDirectories, loadDirectories]);

  return useCallback((dirId: string, sourceEl: HTMLElement, startY: number) => {
    dragRef.current = { dirId, sourceEl, startY, active: false };
  }, []);
}
