import { importClaudeAiPayload } from "@/lib/importers";
import { CORS_HEADERS, checkIngestToken } from "@/lib/ingest-auth";

export const runtime = "nodejs";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Called by the Timu Chrome extension with `{ conversations: [...] }` read from claude.ai. */
export async function POST(req: Request) {
  const denied = checkIngestToken(req);
  if (denied) return denied;
  try {
    const result = await importClaudeAiPayload(await req.json());
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400, headers: CORS_HEADERS });
  }
}
