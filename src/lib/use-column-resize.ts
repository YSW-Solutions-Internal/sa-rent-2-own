import { useCallback, useEffect, useRef } from "react";

export const MIN_COLUMN_WIDTH = 60;

/**
 * Drag-to-resize for table columns. Each resizable header cell renders a
 * handle wired to `startResize(id)`; the header row itself needs
 * `headerRowRef` and every resizable `<th>` needs `data-column-id={id}`.
 *
 * The *first* resize of any column in a table snapshots every other
 * resizable column's current (auto-layout) width in the same update, so
 * switching the table to `table-layout: fixed` never visually shifts a
 * column the user didn't touch — only the one being dragged changes from
 * then on. A fixed-width column (e.g. a checkbox or actions column set via
 * a CSS width class rather than this hook) doesn't need to be captured:
 * `table-layout: fixed` already honours its own first-row width.
 */
export function useColumnResize(
  widths: Record<string, number>,
  onChange: (next: Record<string, number>) => void,
  onCommit: (next: Record<string, number>) => void
) {
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const drag = useRef<{ id: string; startX: number; base: Record<string, number> } | null>(null);
  const latest = useRef<Record<string, number>>(widths);
  const frame = useRef<number | null>(null);
  // Holds the current stopResize so it can remove its own "pointerup"
  // listener without referencing the const before it's declared.
  const stopResizeRef = useRef<() => void>(() => {});

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d || frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const delta = e.clientX - d.startX;
        const startWidth = d.base[d.id] ?? MIN_COLUMN_WIDTH;
        const nextWidth = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + delta));
        const next = { ...d.base, [d.id]: nextWidth };
        latest.current = next;
        onChange(next);
      });
    },
    [onChange]
  );

  const stopResize = useCallback(() => {
    if (drag.current) onCommit(latest.current);
    drag.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResizeRef.current);
  }, [onCommit, onPointerMove]);

  useEffect(() => {
    stopResizeRef.current = stopResize;
  }, [stopResize]);

  const startResize = useCallback(
    (id: string) =>
      (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();

        let base = widths;
        if (Object.keys(widths).length === 0 && headerRowRef.current) {
          const snapshot: Record<string, number> = {};
          headerRowRef.current.querySelectorAll<HTMLElement>("[data-column-id]").forEach((el) => {
            const colId = el.dataset.columnId;
            if (colId) snapshot[colId] = Math.round(el.getBoundingClientRect().width);
          });
          base = snapshot;
        }

        drag.current = { id, startX: e.clientX, base };
        latest.current = base;
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", stopResizeRef.current);
      },
    [widths, onPointerMove]
  );

  return { headerRowRef, startResize };
}
