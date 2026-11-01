// Next.js 16 proxy (formerly middleware): cheap cookie-presence gate for signed-in pages.
// Real authorization happens in the pages and routes (lib/session.ts); this only avoids rendering private pages for anonymous visitors.
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const PRIVATE = [/^\/repos(\/|$)/, /^\/notifications(\/|$)/, /^\/settings(\/|$)/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!PRIVATE.some((re) => re.test(pathname))) return NextResponse.next();
  if (getSessionCookie(req)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("signin", "1");
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/repos/:path*", "/notifications/:path*", "/settings/:path*"] };
