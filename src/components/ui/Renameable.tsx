"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { renameAction, type RenameKind } from "@/app/_actions/rename";
import { companyHref, projectHref } from "@/lib/links";
import { useToast } from "./Toaster";

/**
 * A name you can edit in place: click the pencil (or double-click the text), type,
 * Enter to save, Escape to cancel. Renaming a company or project moves its page to the
 * new URL when you're on it.
 */
export function Renameable({
  kind,
  id,
  value,
  as: Tag = "span",
  className,
  inputClassName,
  label,
}: {
  kind: RenameKind;
  id: string;
  value: string;
  as?: "span" | "h1" | "h2" | "h3" | "div";
  className?: string;
  inputClassName?: string;
  /** Accessible name, e.g. "Rename project". */
  label?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const path = usePathname();
  const { toast } = useToast();

  useEffect(() => setShown(value), [value]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const save = () => {
    const next = draft.replace(/\s+/g, " ").trim();
    setEditing(false);
    if (!next || next === shown) return;
    const before = shown;
    setShown(next);
    start(async () => {
      const r = await renameAction(kind, id, next);
      if (!r.ok) {
        setShown(before);
        toast({ message: r.message, tone: "error" });
        return;
      }
      toast({ message: `Renamed to “${r.name}”.`, tone: "success" });
      // Companies and projects live at /…/<slug>; follow the page to its new address.
      if (r.slug && (kind === "company" || kind === "project")) {
        const href = kind === "company" ? companyHref(r.slug) : projectHref(r.slug);
        const base = kind === "company" ? "/companies/" : "/projects/";
        if (path.startsWith(base) && path !== href) router.replace(href);
      }
    });
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label={label ?? "New name"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(shown);
            setEditing(false);
          }
        }}
        className={clsx(
          "w-full min-w-0 rounded-lg border-0 bg-white px-2 py-0.5 outline-none ring-2 ring-amber-300",
          inputClassName ?? className,
        )}
      />
    );
  }

  return (
    <Tag className={clsx("group/rename inline-flex max-w-full items-center gap-1.5", className, pending && "opacity-60")}>
      <span
        className="min-w-0 truncate"
        onDoubleClick={() => {
          setDraft(shown);
          setEditing(true);
        }}
      >
        {shown}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDraft(shown);
          setEditing(true);
        }}
        aria-label={label ?? "Rename"}
        title={label ?? "Rename"}
        className="shrink-0 rounded-md px-1 text-[0.6em] text-zinc-400 opacity-0 transition hover:bg-black/5 hover:text-zinc-700 focus:opacity-100 group-hover/rename:opacity-100"
      >
        ✏️
      </button>
    </Tag>
  );
}
