import { timingSafeEqual } from "node:crypto";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

/** Ingest endpoints are called by the Chrome extension and the sync CLI with a shared bearer token. */
export function checkIngestToken(req: Request): Response | null {
  const expected = process.env.TIMU_INGEST_TOKEN;
  if (!expected) {
    return Response.json({ error: "TIMU_INGEST_TOKEN is not set on the Timu server." }, { status: 503, headers: CORS_HEADERS });
  }
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!sameToken(got, expected)) {
    return Response.json({ error: "Invalid ingest token." }, { status: 401, headers: CORS_HEADERS });
  }
  return null;
}

/** Constant-time token comparison. */
export function sameToken(got: string, expected: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
