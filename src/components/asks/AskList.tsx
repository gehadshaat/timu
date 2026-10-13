"use client";

import { useRef } from "react";
import type { AskView } from "@/lib/ask-view";
import { Leaving } from "../ui/Leaving";
import { useLeavingList } from "../ui/useLeaving";
import { AskCard, AskRow } from "./AskCard";
import { useAskActions } from "./useAskActions";

/** A plain list of asks with the same actions and done effect as the inbox. */
export function AskList({ asks, compact = false, showProject = true }: { asks: AskView[]; compact?: boolean; showProject?: boolean }) {
  const list = useLeavingList(asks, (a) => a.id);
  const asksRef = useRef(asks);
  asksRef.current = asks;
  const actions = useAskActions(list, () => asksRef.current);
  if (!list.visible.length) return <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Nothing waiting on you here 🎉</p>;
  return (
    <div className={compact ? "space-y-1.5" : "space-y-3"}>
      {list.visible.map((a) => {
        const { phase, effect } = list.phaseOf(a.id);
        const props = {
          ask: a,
          phase,
          effect,
          handlers: {
            onHandled: () => actions.handled([a.id]),
            onNotNeeded: (why?: string) => actions.notNeeded([a.id], why),
            onSnooze: (hours: number, label: string) => actions.snooze([a.id], hours, label),
          },
        };
        return (
          <Leaving key={a.id} phase={phase}>
            {compact ? <AskRow {...props} showProject={showProject} /> : <AskCard {...props} />}
          </Leaving>
        );
      })}
    </div>
  );
}
