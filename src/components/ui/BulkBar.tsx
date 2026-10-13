"use client";

import { useEffect } from "react";

/**
 * The floating bar that appears while items are selected. Escape clears the selection.
 * Put the actions in `children`.
 */
export function BulkBar({
  count,
  noun,
  onClear,
  children,
  extra,
}: {
  count: number;
  noun: [string, string];
  onClear: () => void;
  children: React.ReactNode;
  /** e.g. "Select all 341 matching" */
  extra?: React.ReactNode;
}) {
  useEffect(() => {
    if (!count) return;
    document.body.dataset.bulkbar = "1";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) onClear();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      delete document.body.dataset.bulkbar;
      window.removeEventListener("keydown", onKey);
    };
  }, [count, onClear]);

  if (!count) return null;
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="bar-in fixed bottom-4 left-1/2 z-[60] flex w-[min(96vw,56rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl bg-ink px-3 py-2.5 text-sm text-paper shadow-2xl ring-1 ring-black/30"
    >
      <span className="flex items-center gap-2 pl-1 pr-2 font-bold">
        <span className="grid h-7 min-w-7 place-items-center rounded-full bg-amber-400 px-2 text-xs font-black text-amber-950">{count}</span>
        {count === 1 ? noun[0] : noun[1]} selected
      </span>
      {extra}
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
      <button type="button" onClick={onClear} className="rounded-lg px-2 py-1 text-paper/60 hover:bg-white/10 hover:text-paper" title="Clear selection (Esc)">
        ✕
      </button>
    </div>
  );
}

/** A button styled for the dark bulk bar. */
export function BarButton({
  onClick,
  children,
  tone = "plain",
  disabled,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "plain" | "good" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  const tones = {
    plain: "bg-white/10 hover:bg-white/20",
    good: "bg-emerald-500 text-white hover:bg-emerald-400",
    danger: "bg-rose-500/90 text-white hover:bg-rose-500",
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`rounded-xl px-3 py-1.5 font-semibold disabled:opacity-50 ${tones[tone]}`}>
      {children}
    </button>
  );
}

/** Class for a Popover trigger inside the bulk bar. */
export const BAR_POPOVER = "rounded-xl bg-white/10 px-3 py-1.5 font-semibold hover:bg-white/20 disabled:opacity-50";

/** A checkbox that understands shift-click (for range selection). */
export function SelectBox({
  checked,
  onToggle,
  label,
  className,
}: {
  checked: boolean;
  onToggle: (shift: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={() => undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
      className={className ?? "h-4 w-4 shrink-0 cursor-pointer accent-amber-500"}
    />
  );
}
