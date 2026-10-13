"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

/**
 * A button that opens a small floating panel. Closes on outside click and Escape.
 * `children` can be a render function that receives `close`.
 *
 * `floating` renders the panel on top of the page (portalled, fixed-positioned) so it isn't
 * clipped or covered when the button sits in a table row or a box with overflow hidden. It
 * closes when the page scrolls, since it doesn't follow the button.
 */
export function Popover({
  label,
  children,
  className,
  panelClassName,
  align = "left",
  side = "bottom",
  disabled,
  title,
  floating,
}: {
  label: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  className?: string;
  panelClassName?: string;
  align?: "left" | "right";
  side?: "bottom" | "top";
  disabled?: boolean;
  title?: string;
  floating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      !!t && ((ref.current?.contains(t as Node) ?? false) || (panelRef.current?.contains(t as Node) ?? false));
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) setOpen(false);
    };
    // A floating panel is pinned to where the button was; close it rather than let it drift.
    const onMove = (e: Event) => {
      if (!inside(e.target)) setOpen(false);
    };
    if (floating) {
      window.addEventListener("scroll", onMove, true);
      window.addEventListener("resize", onMove);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, floating]);

  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        onClick={(e) => {
          if (floating) setRect(e.currentTarget.getBoundingClientRect());
          setOpen((v) => !v);
        }}
        className={className ?? "rounded-xl bg-white px-3 py-1.5 text-sm font-semibold ring-1 ring-black/10 hover:bg-zinc-50 disabled:opacity-50"}
      >
        {label}
      </button>
      {open && floating && rect
        ? createPortal(
            <div
              ref={panelRef}
              className={clsx("fixed z-[60] overflow-hidden rounded-2xl bg-white text-sm text-ink shadow-xl ring-1 ring-black/10", panelClassName ?? "w-56")}
              style={{
                ...(side === "top" ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 4 }),
                ...(align === "right" ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) }),
              }}
            >
              {typeof children === "function" ? children(close) : children}
            </div>,
            document.body,
          )
        : null}
      {open && !floating ? (
        <div
          ref={panelRef}
          className={clsx(
            "absolute z-50 overflow-hidden rounded-2xl bg-white text-sm text-ink shadow-xl ring-1 ring-black/10",
            align === "right" ? "right-0" : "left-0",
            side === "top" ? "bottom-full mb-2" : "top-full mt-1",
            panelClassName ?? "w-56",
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

/** A plain menu item for use inside a Popover. */
export function MenuItem({
  onClick,
  children,
  danger,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 disabled:opacity-40",
        danger && "text-rose-600 hover:bg-rose-50",
      )}
    >
      {children}
    </button>
  );
}

export const SNOOZE_CHOICES: [string, number][] = [
  ["1 hour", 1],
  ["Tonight", 6],
  ["Tomorrow", 24],
  ["In 3 days", 72],
  ["Next week", 24 * 7],
];
