import { sameToken } from "../ingest-auth";

/**
 * The MCP endpoint can change or delete anything in Timu, so it has its own token,
 * TIMU_MCP_TOKEN. Clients send it as `Authorization: Bearer …`; clients that can't set
 * headers (some connector UIs) may put it in the URL as `?token=…` instead.
 */
export function checkMcpToken(req: Request): Response | null {
  const expected = process.env.TIMU_MCP_TOKEN?.trim();
  if (!expected) {
    return Response.json(
      { error: "TIMU_MCP_TOKEN is not set on the Timu server. Restart Timu with `npm start` (it writes one to .env.local), or add it yourself." },
      { status: 503 },
    );
  }
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const got = bearer || new URL(req.url).searchParams.get("token") || "";
  if (!sameToken(got, expected)) return Response.json({ error: "Missing or wrong Timu MCP token." }, { status: 401 });
  return null;
}
