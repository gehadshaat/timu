"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSessionsAction, type SessionOp } from "@/app/_actions/bulk";
import { rejudgeSessionAction } from "@/app/_actions/triage";
import type { OrgOptions } from "@/lib/queries";
import { OrgPicker } from "../ui/Picker";
import { Popover } from "../ui/Popover";
import { useToast } from "../ui/Toaster";
import { useBulkRunner } from "../ui/useBulk";
import { opForPick } from "./SessionBoard";

/** Filing and housekeeping for one session: reassign, goal, re-file, archive, re-check. */
export function SessionControls({
  sessionId,
  options,
  archived,
  hasOwner,
  hasGoal,
  hasProject,
}: {
  sessionId: string;
  options: OrgOptions;
  archived: boolean;
  hasOwner: boolean;
  hasGoal: boolean;
  hasProject: boolean;
}) {
  const { run, pending } = useBulkRunner();
  const [checking, startCheck] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const apply = (op: SessionOp) => run(() => bulkSessionsAction([sessionId], op));
  const btn = "rounded-xl bg-white px-3 py-1.5 text-sm font-semibold ring-1 ring-black/10 hover:bg-zinc-50 disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!archived ? (
        <>
          <Popover label={hasOwner ? "👤 Reassign…" : "👤 Assign…"} className={btn} panelClassName="w-80" disabled={pending}>
            {(close) => (
              <OrgPicker
                options={options}
                kinds={["person", "team", "project"]}
                none={hasOwner ? { kind: "person", label: "🚫 Unassign (keep the project)" } : undefined}
                onPick={(p) => {
                  close();
                  const op = opForPick(p);
                  if (op) apply(op);
                }}
              />
            )}
          </Popover>
          <Popover label="🎯 Goal…" className={btn} panelClassName="w-80" disabled={pending}>
            {(close) => (
              <OrgPicker
                options={options}
                kinds={["goal"]}
                none={hasGoal ? { kind: "goal", label: "🚫 Unlink from goal" } : undefined}
                placeholder="Search goals…"
                onPick={(p) => {
                  close();
                  apply({ type: "goal", goalId: p.id });
                }}
              />
            )}
          </Popover>
          {hasProject ? (
            <button type="button" className={btn} disabled={pending} onClick={() => apply({ type: "project", projectId: null })}>
              Remove from project
            </button>
          ) : null}
          <button type="button" className={btn} disabled={pending} onClick={() => apply({ type: "refile" })} title="Clear its filing and let the organiser place it again">
            🔄 Re-file with AI
          </button>
          <button
            type="button"
            className={btn}
            disabled={checking}
            title="Ask the triage judge again whether this genuinely needs you"
            onClick={() =>
              startCheck(async () => {
                const r = await rejudgeSessionAction(sessionId);
                toast({ message: r.message, tone: r.ok ? (r.needed ? "info" : "success") : "error" });
                router.refresh();
              })
            }
          >
            {checking ? "Checking…" : "🧠 Re-check if it needs me"}
          </button>
          <button type="button" className={`${btn} text-rose-700`} disabled={pending} onClick={() => apply({ type: "archive" })}>
            🗄️ Archive
          </button>
        </>
      ) : (
        <button type="button" className={btn} disabled={pending} onClick={() => apply({ type: "unarchive" })}>
          ↩ Unarchive
        </button>
      )}
    </div>
  );
}
