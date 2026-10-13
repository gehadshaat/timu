"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nextSelection, pruneSelection } from "@/lib/selection";

/**
 * Multi-select over a list in display order: click toggles, shift-click selects a range,
 * and anything that drops out of the list (filtered away, handled) is unselected.
 */
export function useSelection(order: readonly string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  // Lists derived from optimistic or server state can be a new array on every render;
  // prune only when the ids themselves change, or the effect would loop.
  const orderKey = order.join("|");

  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const next = pruneSelection(prev, orderRef.current);
      return next.size === prev.size ? prev : next;
    });
  }, [orderKey]);

  const toggle = useCallback(
    (id: string, opts: { shift?: boolean } = {}) => {
      setSelected((prev) => {
        const r = nextSelection(prev, order, id, { shift: opts.shift, anchor: anchor.current });
        anchor.current = r.anchor;
        return r.selected;
      });
    },
    [order],
  );

  const selectAll = useCallback((ids: readonly string[] = order) => setSelected(new Set(ids)), [order]);
  const clear = useCallback(() => {
    anchor.current = null;
    setSelected(new Set());
  }, []);
  const remove = useCallback((ids: readonly string[]) => {
    setSelected((prev) => {
      const drop = new Set(ids);
      return new Set([...prev].filter((id) => !drop.has(id)));
    });
  }, []);

  /** Selected ids in display order. */
  const ids = useMemo(() => order.filter((id) => selected.has(id)), [order, selected]);

  return { selected, ids, size: ids.length, has: (id: string) => selected.has(id), toggle, selectAll, clear, remove };
}

export type Selection = ReturnType<typeof useSelection>;
