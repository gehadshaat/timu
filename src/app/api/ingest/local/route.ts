import { importLocalFiles } from "@/lib/importers";
import { CORS_HEADERS, checkIngestToken } from "@/lib/ingest-auth";

export const runtime = "nodejs";

/** Called by `npm run sync:local` with `{ files: [{ id, mtimeMs, content }] }`. */
export async function POST(req: Request) {
  const denied = checkIngestToken(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { files?: { id: string; mtimeMs?: number; content: string }[] };
    const result = await importLocalFiles(body.files ?? []);
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400, headers: CORS_HEADERS });
  }
}
