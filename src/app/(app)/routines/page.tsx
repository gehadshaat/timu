import { RoutinesBoard } from "@/components/routines/RoutinesBoard";
import { RoutinesImport } from "@/components/routines/RoutinesImport";
import { getOrg } from "@/lib/queries";
import { getRoutines, toRoutineItem } from "@/lib/routines";
import { routinesConfigFromEnv } from "@/lib/sources/routines";

/** Claude Code routines and the check-ins sessions have scheduled, as one board. */
export default async function RoutinesPage() {
  const org = await getOrg();
  const items = getRoutines(org).map(toRoutineItem);
  const scheduled = items.filter((r) => r.state === "scheduled").length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl font-bold">⏰ Scheduled</h1>
        <p className="text-zinc-600">
          Claude Code routines that run on a schedule, and the check-ins your sessions have set for themselves ({scheduled} coming up). Each is filed under the
          teammate whose session it belongs to.
        </p>
      </header>
      <RoutinesImport canSync={!!routinesConfigFromEnv()} />
      <RoutinesBoard
        items={items}
        empty={
          <>
            No routines yet. Sync, or paste them above — routines are made with <code>/schedule</code> in Claude Code, and sessions schedule check-ins with it too.
          </>
        }
      />
    </div>
  );
}
