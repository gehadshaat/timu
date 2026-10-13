"use client";

import { useState } from "react";
import clsx from "clsx";
import { MenuItem, Popover, SNOOZE_CHOICES } from "../ui/Popover";

export interface AskHandlers {
  onHandled: () => void;
  onNotNeeded: (why?: string) => void;
  onSnooze: (hours: number, label: string) => void;
}

/** Open the session where it lives: a link for cloud/claude.ai, a copyable resume command for local ones. */
export function OpenSession({ url, resume, small = false }: { url: string | null; resume: string | null; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={clsx("rounded-xl bg-ink font-bold text-paper shadow-sm hover:opacity-90", small ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm")}
      >
        Open ↗
      </a>
    );
  }
  if (!resume) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(resume);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked; the title still shows the command.
        }
      }}
      title={`Copy: ${resume}`}
      className={clsx("rounded-xl bg-ink font-mono font-bold text-paper shadow-sm hover:opacity-90", small ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs")}
    >
      {copied ? "Copied!" : small ? "⧉ resume" : resume}
    </button>
  );
}

export function AskActions({ url, resume, handlers, disabled }: { url: string | null; resume: string | null; handlers: AskHandlers; disabled?: boolean }) {
  const [dismissing, setDismissing] = useState(false);
  const [why, setWhy] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <OpenSession url={url} resume={resume} />
      <button
        type="button"
        disabled={disabled}
        onClick={handlers.onHandled}
        className="rounded-xl bg-emerald-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-60"
      >
        ✓ Handled
      </button>
      <Popover label="⏰ Snooze" disabled={disabled} panelClassName="w-40">
        {(close) =>
          SNOOZE_CHOICES.map(([label, hours]) => (
            <MenuItem
              key={label}
              onClick={() => {
                close();
                handlers.onSnooze(hours, label);
              }}
            >
              {label}
            </MenuItem>
          ))
        }
      </Popover>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setDismissing((v) => !v)}
        className="rounded-xl px-3 py-1.5 text-sm font-semibold text-zinc-500 ring-1 ring-black/10 hover:bg-zinc-50"
      >
        🙅 Not needed
      </button>
      {dismissing ? (
        <form
          className="flex w-full flex-wrap gap-2 rounded-xl bg-zinc-50 p-2 ring-1 ring-black/5"
          onSubmit={(e) => {
            e.preventDefault();
            handlers.onNotNeeded(why);
          }}
        >
          <input
            autoFocus
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Teach Timu why (optional), e.g. “PRs waiting on a reviewer don't need me”"
            aria-label="Why it isn't needed"
            className="min-w-0 flex-1 rounded-lg border-0 bg-white px-2 py-1.5 text-sm ring-1 ring-black/10"
          />
          <button className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-bold text-white">{why.trim() ? "Dismiss & remember" : "Dismiss"}</button>
        </form>
      ) : null}
    </div>
  );
}
