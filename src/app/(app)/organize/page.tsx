import { OrganizeBoard, type OrganizeCounts } from "@/components/organize/OrganizeBoard";
import { toSessionLite } from "@/lib/session-lite";
import { getLiteSessions } from "@/lib/home";
import { getOrg, getSessions, orgOptions } from "@/lib/queries";

export default async function OrganizePage() {
  const [org, unfiled, recent, lite] = await Promise.all([
    getOrg(),
    getSessions({ unfiled: true, limit: 500 }),
    getSessions({ limit: 300 }),
    getLiteSessions(),
  ]);
  const counts: OrganizeCounts = { agents: {}, teams: {}, projects: {} };
  for (const s of lite) {
    if (s.agent_id) counts.agents[s.agent_id] = (counts.agents[s.agent_id] ?? 0) + 1;
    if (s.team_id) counts.teams[s.team_id] = (counts.teams[s.team_id] ?? 0) + 1;
    if (s.project_id) counts.projects[s.project_id] = (counts.projects[s.project_id] ?? 0) + 1;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl font-bold">🧩 Organize</h1>
        <p className="max-w-3xl text-zinc-600">
          Drag sessions onto a teammate, a team or a project. Select several (shift-click for a range) and drag them together. Drag people between teams and projects
          between companies. Every move can be undone from the toast.
        </p>
      </header>
      <OrganizeBoard unfiled={unfiled.map(toSessionLite)} recent={recent.map(toSessionLite)} options={orgOptions(org)} counts={counts} />
    </div>
  );
}
