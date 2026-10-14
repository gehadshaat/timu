import { avatarFromQuery, avatarSvg } from "@/components/character-svg";

/** Each look is drawn once per server; there are as many as teammates times poses. */
const drawn = new Map<string, string>();
const MAX_DRAWN = 5000;

/**
 * GET /api/avatar?pose=…&seed=…: a small avatar as an SVG image (see Character and avatarUrl).
 * The browser keeps each one for a day, so a board's avatars cost one request per teammate, once.
 */
export function GET(req: Request) {
  const { searchParams, search } = new URL(req.url);
  const avatar = avatarFromQuery(searchParams);
  if (!avatar) return new Response("Not an avatar", { status: 400 });
  let svg = drawn.get(search);
  if (!svg) {
    svg = avatarSvg(avatar.spec, avatar.pose);
    if (drawn.size >= MAX_DRAWN) drawn.clear();
    drawn.set(search, svg);
  }
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": process.env.NODE_ENV === "production" ? "public, max-age=86400" : "no-cache",
      // It's an image: nothing in it may run or load anything, even when opened directly.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
