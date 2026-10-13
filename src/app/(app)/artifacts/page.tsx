import { ArtifactsBoard, ArtifactsImport } from "@/components/artifacts/ArtifactsBoard";
import { getArtifacts } from "@/lib/artifacts";
import { getOrg, orgOptions } from "@/lib/queries";

/** Your Claude artifacts, filed by project like everything else. */
export default async function ArtifactsPage() {
  const org = await getOrg();
  const items = getArtifacts(org);
  const unfiled = items.filter((a) => !a.project).length;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl font-bold">🖼️ Artifacts</h1>
        <p className="text-zinc-600">
          The pages you and your sessions published to claude.ai, filed under the project of the session that made them, else by their title
          {unfiled ? ` (${unfiled} still to file)` : ""}. Click a project cell to move one.
        </p>
      </header>
      <ArtifactsImport />
      <ArtifactsBoard
        items={items}
        options={orgOptions(org)}
        empty={<>No artifacts yet. Import your gallery above — or just sync: artifacts your local Claude Code sessions link to come in on their own.</>}
      />
    </div>
  );
}
