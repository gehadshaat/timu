import { notFound } from "next/navigation";
import { Character } from "@/components/Character";
import { Crumbs } from "@/components/Crumbs";
import { DeleteDialog } from "@/components/DeleteDialog";
import { EntityDialog } from "@/components/EntityDialog";
import { PeopleWorkBoard } from "@/components/board/PeopleBoard";
import { SessionBoard } from "@/components/sessions/SessionBoard";
import { toSessionLite } from "@/lib/session-lite";
import { QuickAdd } from "@/components/todos/QuickAdd";
import { CommentThread } from "@/components/comments/CommentThread";
import { Renameable } from "@/components/ui/Renameable";
import { POSE_LABEL } from "@/lib/avatar";
import { getComments } from "@/lib/comments";
import { getInbox, getOffice, getOrg, getSessions, getTodos, orgOptions, placeOf, teamTargets } from "@/lib/queries";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getOrg();
  const { agent, team, project, company } = placeOf(org, id);
  if (!agent || !team || !project) notFound();
  const [office, sessions, todos, inbox, comments] = await Promise.all([
    getOffice(project.id),
    getSessions({ agentId: agent.id }),
    getTodos({ includeDone: false }),
    getInbox(org),
    getComments("agent", agent.id),
  ]);
  const me = office.flatMap((t) => t.members).find((m) => m.agent.id === agent.id);
  const pose = me?.pose ?? "idle";
  const options = orgOptions(org);
  const asks = inbox.filter((i) => i.agent?.id === agent.id);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-6">
        <div className="rounded-3xl bg-gradient-to-b from-amber-50 to-orange-100 p-2">
          <Character spec={agent.avatar} pose={pose} size={120} title={`${agent.name}, ${agent.role}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Crumbs company={company} project={project} team={team} />
          <Renameable kind="agent" id={agent.id} value={agent.name} as="h1" className="font-display text-3xl font-bold" label="Rename teammate" />
          <p className="text-lg text-zinc-600">
            {agent.role} · <span className="font-semibold">{POSE_LABEL[pose]}</span>
          </p>
          {agent.persona ? <p className="text-sm text-zinc-500">{agent.persona}</p> : null}
          {me?.line ? <p className="inline-block rounded-2xl bg-white px-3 py-1.5 text-sm font-semibold ring-1 ring-black/5">💬 {me.line}</p> : null}
          <div className="flex gap-2 pt-1">
            <EntityDialog
              kind="agent"
              id={agent.id}
              initial={{ name: agent.name, role: agent.role, persona: agent.persona, prop: agent.avatar.prop ?? "mug", team_id: agent.team_id }}
              choices={teamTargets(org).map(({ id, label }) => ({ id, label }))}
            />
            <DeleteDialog
              kind="agent"
              id={agent.id}
              name={agent.name}
              targets={org.agents.filter((a) => a.id !== agent.id).map((a) => ({ id: a.id, label: `${a.name} · ${a.role}` }))}
              impact={[`${sessions.length} session${sessions.length === 1 ? "" : "s"} need a new owner`]}
              redirectTo={`/teams/${team.id}`}
            />
          </div>
        </div>
      </header>

      <section className="space-y-3">
        <QuickAdd options={options} projectId={project.id} agentId={agent.id} compact placeholder={`Add a to-do for ${agent.name}…`} />
        <PeopleWorkBoard
          people={[
            {
              agent: { id: agent.id, name: agent.name, role: agent.role, avatar: agent.avatar },
              sessions,
              todos: todos.filter((t) => t.task.agent_id === agent.id),
            },
          ]}
          options={options}
          asks={Object.fromEntries(asks.map((a) => [a.session.id, a.task.id]))}
          goals={Object.fromEntries(org.goals.map((g) => [g.id, g.title]))}
        />
      </section>

      <details className="group rounded-2xl bg-white/60 p-3 ring-1 ring-black/5">
        <summary className="cursor-pointer list-none font-display text-lg font-bold">
          <span className="inline-block w-4 text-sm text-zinc-400 group-open:rotate-90">▸</span> All sessions · move, archive, re-file
        </summary>
        <div className="mt-3">
          <SessionBoard sessions={sessions.map(toSessionLite)} options={options} asks={Object.fromEntries(asks.map((a) => [a.session.id, a.task.id]))} scope="agent" empty="No sessions yet." />
        </div>
      </details>

      <CommentThread entity="agent" entityId={agent.id} initial={comments} title={`💬 Notes about ${agent.name}`} />
    </div>
  );
}
