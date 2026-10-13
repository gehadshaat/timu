export const runtime = "nodejs";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Lets the Chrome extension pick up TIMU_INGEST_TOKEN by itself on a local install, so nobody has to paste it.
 * Only answers on localhost with no TIMU_PASSWORD, and sends no CORS headers, so web pages can't read it.
 */
export async function GET(req: Request) {
  const token = process.env.TIMU_INGEST_TOKEN;
  const origin = req.headers.get("origin");
  const local = LOCAL_HOST.test(req.headers.get("host") ?? "");
  if (!token || process.env.TIMU_PASSWORD || !local || (origin && !origin.startsWith("chrome-extension://"))) {
    return Response.json({ error: "Not available. Paste TIMU_INGEST_TOKEN into the extension instead." }, { status: 404 });
  }
  return Response.json({ token });
}
