import { getOrganizeJob } from "@/lib/organize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polled by the setup wizard while the classifier runs. */
export async function GET() {
  return Response.json((await getOrganizeJob()) ?? { state: "idle" });
}
