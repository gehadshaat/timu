"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAgentAction, deleteCompanyAction, deleteProjectAction, deleteTeamAction, type SessionFate } from "@/app/actions";

const NOUN = { team: "team", project: "project", agent: "teammate", company: "company" } as const;

export interface MoveTarget {
  id: string;
  label: string;
}

/**
 * Confirm deleting a team or project, and choose what happens to its sessions.
 * Nothing is deleted until the user types the name (projects) or confirms (teams).
 */
export function DeleteDialog({
  kind,
  id,
  name,
  impact,
  targets,
  redirectTo,
  buttonClassName,
  buttonLabel,
}: {
  kind: "team" | "project" | "agent" | "company";
  id: string;
  name: string;
  /** Plain-language consequences, e.g. "3 teammates leave". */
  impact: string[];
  /** Where the sessions could go instead: teams (team/project) or teammates (agent). */
  targets: MoveTarget[];
  redirectTo?: string;
  buttonClassName?: string;
  buttonLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [fate, setFate] = useState<SessionFate["kind"]>("unfile");
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const needsTyping = kind === "project" || kind === "company";
  const canConfirm = (!needsTyping || typed.trim() === name.trim()) && (fate !== "move" || !!target);

  const confirm = () =>
    start(async () => {
      const chosen: SessionFate = fate === "move" ? { kind: "move", teamId: target } : { kind: fate };
      const r =
        kind === "team"
          ? await deleteTeamAction(id, chosen)
          : kind === "project"
            ? await deleteProjectAction(id, chosen)
            : kind === "agent"
              ? await deleteAgentAction(id, fate === "move" ? target : null)
              : await deleteCompanyAction(id);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      ref.current?.close();
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });

  return (
    <>
      <button
        type="button"
        aria-label={`${kind === "agent" ? "Remove" : "Delete"} ${NOUN[kind]} ${name}`}
        title={`${kind === "agent" ? "Remove" : "Delete"} ${NOUN[kind]}`}
        onClick={() => {
          setError(null);
          setTyped("");
          ref.current?.showModal();
        }}
        className={buttonClassName ?? "rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"}
      >
        {buttonLabel ?? `${kind === "agent" ? "Remove" : "Delete"} ${NOUN[kind]}`}
      </button>
      <dialog
        ref={ref}
        className="w-[min(92vw,460px)] rounded-3xl p-0 text-ink shadow-2xl backdrop:bg-black/40"
        onClick={(e) => e.target === ref.current && !pending && ref.current?.close()}
      >
        <div className="space-y-4 p-6">
          <h2 className="font-display text-xl font-bold">
            {kind === "agent" ? "Remove" : "Delete"} {NOUN[kind]} “{name}”?
          </h2>
          {impact.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-600">
              {impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}

          {kind === "company" ? null : (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-bold">What should happen to {kind === "agent" ? "their" : "its"} sessions?</legend>
            <label className="flex gap-2 text-sm">
              <input type="radio" name={`fate-${id}`} checked={fate === "unfile"} onChange={() => setFate("unfile")} />
              <span>
                <b>Leave them unfiled</b>
                <span className="block text-xs text-zinc-500">They stay imported; reassign them any time from All sessions.</span>
              </span>
            </label>
            {kind === "agent" ? null : (
              <label className="flex gap-2 text-sm">
                <input type="radio" name={`fate-${id}`} checked={fate === "refile"} onChange={() => setFate("refile")} />
                <span>
                  <b>Re-file them on the next sync</b>
                  <span className="block text-xs text-zinc-500">The organiser places them again, possibly in a new team.</span>
                </span>
              </label>
            )}
            {targets.length ? (
              <label className="flex gap-2 text-sm">
                <input type="radio" name={`fate-${id}`} checked={fate === "move"} onChange={() => setFate("move")} />
                <span className="min-w-0 flex-1">
                  <b>{kind === "agent" ? "Hand them to another teammate" : "Move them to another team"}</b>
                  <select
                    aria-label="Move sessions to"
                    value={target}
                    onFocus={() => setFate("move")}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setFate("move");
                    }}
                    className="mt-1 block w-full rounded-lg border-0 bg-zinc-50 px-2 py-1 text-sm ring-1 ring-black/10"
                  >
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            ) : null}
          </fieldset>
          )}

          {needsTyping ? (
            <label className="block text-sm">
              Type <b>{name}</b> to confirm
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Type the project name to confirm"
                className="mt-1 block w-full rounded-lg border-0 bg-zinc-50 px-2 py-1.5 ring-1 ring-black/10"
              />
            </label>
          ) : null}

          {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" disabled={pending} onClick={() => ref.current?.close()} className="rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-black/10">
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm || pending}
              onClick={confirm}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {pending ? "Deleting…" : `${kind === "agent" ? "Remove" : "Delete"} ${NOUN[kind]}`}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
