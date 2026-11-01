import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Locale routing only. Authorization is NOT performed here; see app/admin/page.tsx.
export function middleware(req: NextRequest) {
  const locale = req.cookies.get("locale")?.value ?? "en";
  return NextResponse.rewrite(new URL("/" + locale + req.nextUrl.pathname, req.url));
}

export const config = { matcher: ["/((?!_next|api).*)"] };
