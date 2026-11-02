import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { hasAuth } from "@/lib/env";

export const runtime = "nodejs";
const h = toNextJsHandler(auth);
// Without GITHUB_CLIENT_ID/SECRET and BETTER_AUTH_SECRET the provider cannot work; answer clearly instead of a 500.
const guard = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
  if (!hasAuth() && !/\/(ok|get-session)$/.test(new URL(req.url).pathname)) return Response.json({ error: "sign-in is not configured on this deployment (GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, BETTER_AUTH_SECRET)" }, { status: 503 });
  return fn(req);
};
export const GET = guard(h.GET);
export const POST = guard(h.POST);
