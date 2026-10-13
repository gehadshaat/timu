"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEntityAction, type EntityKind, type EntityValues } from "@/app/actions";
import { PROP_KINDS } from "@/lib/classify/schema";
import { Character } from "./Character";
import { companyHref, personHref, projectHref, teamHref } from "@/lib/links";

export interface Choice {
  id: string;
  label: string;
}

const NOUN: Record<EntityKind, string> = { company: "company", project: "project", team: "team", agent: "teammate" };
const field = "mt-1 block w-full rounded-lg border-0 bg-zinc-50 px-2 py-1.5 text-sm ring-1 ring-black/10";

/**
 * One dialog to create or edit a company, project, team or teammate.
 * `choices` supplies the pickers that kind needs (company for a project, project for a new team,
 * team for a teammate).
 */
export function EntityDialog({
  kind,
  id = null,
  initial = {},
  choices = [],
  buttonLabel,
  buttonClassName,
  navigate = false,
  currentSlug,
}: {
  kind: EntityKind;
  id?: string | null;
  initial?: EntityValues;
  choices?: Choice[];
  buttonLabel?: string;
  buttonClassName?: string;
  /** After saving, open the entity's page (for edits, only when its URL changed). */
  navigate?: boolean;
  /** The slug the current page is on, so a rename can follow the new URL. */
  currentSlug?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [v, setV] = useState<EntityValues>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const creating = !id;
  const noun = NOUN[kind];

  const save = () =>
    start(async () => {
      const r = await saveEntityAction(kind, id, v);
      if (!r.ok) return setMsg(r.message);
      ref.current?.close();
      const href =
        kind === "company" && r.slug
          ? companyHref(r.slug)
          : kind === "project" && r.slug
            ? projectHref(r.slug)
            : kind === "team" && r.id
              ? teamHref(r.id)
              : kind === "agent" && r.id
                ? personHref(r.id)
                : null;
      const moved = creating || (r.slug && currentSlug && r.slug !== currentSlug);
      if (navigate && href && moved) router.push(href);
      else router.refresh();
    });

  return (
    <>
      <button
        type="button"
        aria-label={buttonLabel ?? (creating ? `New ${noun}` : `Edit ${noun}`)}
        onClick={() => {
          setV(initial);
          setMsg(null);
          ref.current?.showModal();
        }}
        className={buttonClassName ?? "rounded-lg px-2 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-black/10 hover:bg-white"}
      >
        {buttonLabel ?? (creating ? `+ New ${noun}` : "✎ Edit")}
      </button>
      <dialog
        ref={ref}
        className="w-[min(92vw,440px)] rounded-3xl p-0 text-ink shadow-2xl backdrop:bg-black/40"
        onClick={(e) => e.target === ref.current && !pending && ref.current?.close()}
      >
        <form
          className="space-y-3 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <h2 className="font-display text-xl font-bold">{creating ? `New ${noun}` : `Edit ${noun}`}</h2>

          {kind === "agent" ? (
            <div className="flex justify-center">
              <Character spec={{ seed: `${v.name ?? ""}:${v.role ?? ""}`, prop: (v.prop as (typeof PROP_KINDS)[number]) || "mug" }} pose="working" size={110} />
            </div>
          ) : null}

          <div className="flex gap-2">
            {kind === "company" || kind === "project" ? (
              <label className="w-16 text-sm font-semibold">
                Icon
                <input value={v.emoji ?? ""} onChange={(e) => set("emoji", e.target.value)} className={`${field} text-center text-lg`} aria-label="Icon" />
              </label>
            ) : null}
            <label className="min-w-0 flex-1 text-sm font-semibold">
              Name
              <input autoFocus value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} className={field} aria-label="Name" />
            </label>
          </div>

          {kind === "agent" ? (
            <label className="block text-sm font-semibold">
              Role
              <input value={v.role ?? ""} onChange={(e) => set("role", e.target.value)} placeholder="e.g. SEO Lead" className={field} aria-label="Role" />
            </label>
          ) : null}

          {kind === "agent" ? (
            <label className="block text-sm font-semibold">
              What they own
              <textarea value={v.persona ?? ""} onChange={(e) => set("persona", e.target.value)} rows={2} className={field} aria-label="What they own" />
            </label>
          ) : (
            <label className="block text-sm font-semibold">
              Description
              <textarea value={v.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} className={field} aria-label="Description" />
            </label>
          )}

          {kind === "agent" ? (
            <label className="block text-sm font-semibold">
              Prop
              <select value={v.prop ?? "mug"} onChange={(e) => set("prop", e.target.value)} className={field} aria-label="Prop">
                {PROP_KINDS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          ) : null}

          {choices.length && kind !== "company" ? (
            <label className="block text-sm font-semibold">
              {kind === "project" ? "Company" : kind === "team" ? "Project" : "Team"}
              <select
                value={(kind === "project" ? v.company_id : kind === "team" ? v.project_id : v.team_id) ?? ""}
                onChange={(e) => set(kind === "project" ? "company_id" : kind === "team" ? "project_id" : "team_id", e.target.value)}
                className={field}
                aria-label={kind === "project" ? "Company" : kind === "team" ? "Project" : "Team"}
                disabled={kind === "team" && !creating}
              >
                {kind === "project" ? <option value="">No company</option> : <option value="">Choose…</option>}
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {msg ? <p className="text-sm font-semibold text-rose-600">{msg}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => ref.current?.close()} className="rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-black/10">
              Cancel
            </button>
            <button disabled={pending} className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-paper disabled:opacity-50">
              {pending ? "Saving…" : creating ? (kind === "agent" ? "Hire" : "Create") : "Save"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
