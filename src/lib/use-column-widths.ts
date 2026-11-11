import { useEffect, useState } from "react";

/**
 * Resizable column widths for a table with a fixed column set, persisted
 * per-viewer in localStorage. `storageKey` should be unique per table.
 *
 * A table that also has drag-reorder/hide-show (`useColumnOrder`) should
 * use that hook's own `widths`/`setWidths`/`commitWidths` instead of this
 * one, so order/hidden/widths all live in a single persisted blob.
 */
export function useColumnWidths(storageKey: string) {
  const [widths, setWidthsState] = useState<Record<string, number>>({});

  useEffect(() => {
    // localStorage is unavailable during SSR, so preferences are synced
    // after mount rather than read in a lazy useState initializer.
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      const valid: Record<string, number> = {};
      for (const [id, w] of Object.entries(parsed)) {
        if (typeof w === "number" && w > 0) valid[id] = w;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWidthsState(valid);
    } catch {
      // Private browsing / blocked storage / corrupt value — defaults stand.
    }
  }, [storageKey]);

  /** Live width update while a resize drag is in progress — no
   * localStorage write, so dragging doesn't hammer it every frame. */
  function setWidths(next: Record<string, number>) {
    setWidthsState(next);
  }

  /** Width update to persist — called once a resize drag ends. */
  function commitWidths(next: Record<string, number>) {
    setWidthsState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Ignore — preference just won't persist this session.
    }
  }

  return { widths, setWidths, commitWidths };
}
