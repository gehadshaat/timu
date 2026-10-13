/**
 * Multi-select with shift-click ranges (Gmail-style): a plain click toggles one item and
 * becomes the anchor; shift-click applies the clicked item's new state to every item
 * between the anchor and it, in display order.
 */
export function nextSelection(
  prev: ReadonlySet<string>,
  order: readonly string[],
  id: string,
  opts: { shift?: boolean; anchor?: string | null } = {},
): { selected: Set<string>; anchor: string } {
  const selected = new Set(prev);
  const turnOn = !prev.has(id);
  const a = opts.shift && opts.anchor ? order.indexOf(opts.anchor) : -1;
  const b = order.indexOf(id);
  if (a >= 0 && b >= 0) {
    const [from, to] = a < b ? [a, b] : [b, a];
    for (const x of order.slice(from, to + 1)) {
      if (turnOn) selected.add(x);
      else selected.delete(x);
    }
  } else if (turnOn) selected.add(id);
  else selected.delete(id);
  return { selected, anchor: id };
}

/** Keep only ids that are still present (after filtering or a refresh). */
export function pruneSelection(prev: ReadonlySet<string>, present: readonly string[]): Set<string> {
  const keep = new Set(present);
  return new Set([...prev].filter((id) => keep.has(id)));
}
