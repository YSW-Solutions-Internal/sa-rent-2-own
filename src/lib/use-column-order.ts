import { useEffect, useState } from "react";

interface StoredColumnPrefs {
  order?: string[];
  hidden?: string[];
  widths?: Record<string, number>;
}

/** Drag-reorderable, hide/show-able, resizable column state for a table,
 * persisted per-viewer in localStorage. `storageKey` should be unique per
 * table so different tables don't clobber each other's preferences.
 *
 * Widths are keyed by plain column id strings rather than `T` so a table
 * can also lock in a non-toggleable column's width (e.g. a fixed-width
 * checkbox/actions column) via `setWidths`/`commitWidths` without widening
 * `T` to include synthetic ids. */
export function useColumnOrder<T extends string>(
  storageKey: string,
  defaultOrder: T[],
  defaultHidden: T[] = []
) {
  const [order, setOrder] = useState<T[]>(defaultOrder);
  const [hidden, setHidden] = useState<Set<T>>(new Set(defaultHidden));
  const [widths, setWidthsState] = useState<Record<string, number>>({});

  useEffect(() => {
    // localStorage is unavailable during SSR, so preferences are synced
    // after mount rather than read in a lazy useState initializer (which
    // would run during hydration too and could mismatch the
    // server-rendered default order/visibility).
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredColumnPrefs;
      const known = new Set<string>(defaultOrder);

      if (Array.isArray(parsed.order)) {
        const kept = parsed.order.filter((id): id is T => known.has(id));
        const missing = defaultOrder.filter((id) => !kept.includes(id));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrder([...kept, ...missing]);
      }
      if (Array.isArray(parsed.hidden)) {
        setHidden(new Set(parsed.hidden.filter((id): id is T => known.has(id))));
      }
      if (parsed.widths && typeof parsed.widths === "object") {
        const validWidths: Record<string, number> = {};
        for (const [id, w] of Object.entries(parsed.widths)) {
          if (typeof w === "number" && w > 0) validWidths[id] = w;
        }
        setWidthsState(validWidths);
      }
    } catch {
      // Private browsing / blocked storage / corrupt value — defaults stand.
    }
    // defaultOrder/defaultHidden are static per table, not meant to re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function persist(nextOrder: T[], nextHidden: Set<T>, nextWidths: Record<string, number>) {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ order: nextOrder, hidden: [...nextHidden], widths: nextWidths })
      );
    } catch {
      // Ignore — preference just won't persist this session.
    }
  }

  function reorder(activeId: T, overId: T) {
    setOrder((prev) => {
      const from = prev.indexOf(activeId);
      const to = prev.indexOf(overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = prev.slice();
      next.splice(from, 1);
      next.splice(to, 0, activeId);
      persist(next, hidden, widths);
      return next;
    });
  }

  function toggleHidden(id: T) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      persist(order, next, widths);
      return next;
    });
  }

  /** Live width update while a resize drag is in progress — no
   * localStorage write, so dragging doesn't hammer it every frame. */
  function setWidths(next: Record<string, number>) {
    setWidthsState(next);
  }

  /** Width update to persist — called once a resize drag ends. */
  function commitWidths(next: Record<string, number>) {
    setWidthsState(next);
    persist(order, hidden, next);
  }

  function reset() {
    setOrder(defaultOrder);
    setHidden(new Set(defaultHidden));
    setWidthsState({});
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore.
    }
  }

  return {
    order,
    hidden,
    widths,
    reorder,
    toggleHidden,
    setWidths,
    commitWidths,
    reset,
    isHidden: (id: T) => hidden.has(id),
  };
}
