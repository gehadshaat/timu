import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/SetupWizard";
import { hasClaude } from "@/lib/classify/claude";
import { all } from "@/lib/db";
import { getOrganizeJob, isSetupComplete, loadProposal } from "@/lib/organize";
import { getSourceInfo } from "@/lib/source-info";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await isSetupComplete()) redirect("/");
  const [info, job] = await Promise.all([getSourceInfo(), getOrganizeJob()]);
  const proposal = job?.state === "ready" && job.proposalId ? await loadProposal(job.proposalId) : null;
  const draft = proposal && proposal.status === "draft" ? proposal : null;
  const sessions = draft ? all<{ id: string; title: string }>("select id, title from sessions") : [];

  return <SetupWizard info={info} job={job} proposal={draft} sessions={sessions} claudeAvailable={hasClaude()} />;
}
