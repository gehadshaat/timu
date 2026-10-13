"use client";

import { useTransition } from "react";
import { setProjectThemeAction } from "@/app/actions";
import { THEMES } from "@/lib/themes";

export function ThemePicker({ projectId, current }: { projectId: string; current: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Office theme">
      <span className="mr-1 text-xs font-semibold text-zinc-500">Floor theme</span>
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={pending}
          title={t.label}
          aria-label={t.label}
          aria-pressed={t.id === current}
          onClick={() => start(() => setProjectThemeAction(projectId, t.id))}
          className={`h-7 w-7 rounded-full text-sm ring-2 transition ${t.id === current ? "scale-110 ring-ink" : "ring-black/10 hover:scale-105"}`}
          style={{ background: t.wall }}
        >
          {t.decor[0]}
        </button>
      ))}
    </div>
  );
}
