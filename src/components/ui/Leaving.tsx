"use client";

import clsx from "clsx";
import type { LeaveEffect, LeavePhase } from "./useLeaving";

/** Wraps a list item so it can fold away (height → 0) once its exit effect has played. */
export function Leaving({
  phase,
  className,
  children,
  as: Tag = "div",
}: {
  phase: LeavePhase;
  className?: string;
  children: React.ReactNode;
  as?: "div" | "li";
}) {
  return (
    <Tag className={clsx("leave", phase === "collapsing" && "leave-out", className)} data-phase={phase}>
      <div className="leave-inner">{children}</div>
    </Tag>
  );
}

/** Ring/background classes for a card while it is marked. */
export function markedClasses(phase: LeavePhase, effect: LeaveEffect): string {
  if (phase === "idle") return "";
  switch (effect) {
    case "done":
      return "flash-done bg-emerald-50 ring-2 ring-emerald-400";
    case "dismiss":
      return "bg-zinc-50 opacity-70 ring-1 ring-zinc-300";
    case "snooze":
      return "bg-amber-50 ring-2 ring-amber-300";
    case "move":
      return "bg-sky-50 ring-2 ring-sky-300";
  }
}

const STAMP: Record<LeaveEffect, { text: string; tone: string }> = {
  done: { text: "✓ Handled", tone: "bg-emerald-500 text-white" },
  dismiss: { text: "🙅 Not needed", tone: "bg-zinc-700 text-white" },
  snooze: { text: "⏰ Snoozed", tone: "bg-amber-400 text-amber-950" },
  move: { text: "➜ Moved", tone: "bg-sky-500 text-white" },
};

const CONFETTI = ["#10b981", "#f59e0b", "#ec4899", "#6366f1", "#06b6d4", "#f97316", "#84cc16", "#e11d48"];

/** The stamp that pops onto a card when it's handled, with a little confetti burst. */
export function LeaveStamp({ phase, effect, size = "md" }: { phase: LeavePhase; effect: LeaveEffect; size?: "sm" | "md" }) {
  if (phase === "idle") return null;
  const s = STAMP[effect];
  return (
    <span className="pointer-events-none absolute right-3 top-3 z-10" aria-hidden>
      <span
        className={clsx(
          "stamp-pop relative inline-block rounded-xl font-display font-black uppercase tracking-wide shadow-lg",
          size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-sm",
          s.tone,
        )}
      >
        {s.text}
        {effect === "done" ? (
          <span className="burst">
            {CONFETTI.map((c, i) => {
              const angle = (i / CONFETTI.length) * Math.PI * 2;
              const dist = size === "sm" ? 34 : 54;
              return (
                <i
                  key={c}
                  style={
                    {
                      background: c,
                      "--dx": `${Math.round(Math.cos(angle) * dist)}px`,
                      "--dy": `${Math.round(Math.sin(angle) * dist)}px`,
                      "--r": `${(i % 2 ? 1 : -1) * (120 + i * 25)}deg`,
                    } as React.CSSProperties
                  }
                />
              );
            })}
          </span>
        ) : null}
      </span>
    </span>
  );
}
