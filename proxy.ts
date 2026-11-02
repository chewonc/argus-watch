// Next.js 16 proxy (formerly middleware): cheap cookie-presence gate for signed-in pages.
// Real authorization happens in the pages and routes (lib/session.ts); this only avoids rendering private pages for anonymous visitors.
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";


const PRIVATE = [/^\/repos(\/|$)/, /^\/notifications(\/|$)/, /^\/settings(\/|$)/, /^\/monitoring(\/|$)/, /^\/activity(\/|$)/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!PRIVATE.some((re) => re.test(pathname))) return NextResponse.next();
  if (getSessionCookie(req)) return NextResponse.next();
  // Local dev stub (lib/session.ts devUserLogin): same guard, never in production, never when real sign-in is configured.
  if (process.env.NODE_ENV !== "production" && process.env.AW_DEV_USER && !(process.env.BETTER_AUTH_SECRET && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("signin", "1");
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/repos/:path*", "/notifications/:path*", "/settings/:path*", "/monitoring/:path*", "/activity/:path*"] };
