import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth-token";

/** Only active when TIMU_PASSWORD is set. Ingest and MCP endpoints use their own bearer tokens. */
export async function middleware(req: NextRequest) {
  const password = process.env.TIMU_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/ingest") || pathname.startsWith("/api/mcp")) return NextResponse.next();
  if (req.cookies.get(AUTH_COOKIE)?.value === (await sessionToken(password))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
