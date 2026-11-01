import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// NOTE: we are still on next 14.2.10, which is vulnerable to CVE-2025-29927 (upgrade pending).
export function middleware(req: NextRequest) {
  const session = req.cookies.get("session");
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
