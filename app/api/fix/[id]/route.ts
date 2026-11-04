import { canSee, currentUser } from "@/lib/session";
import { ownFix } from "@/lib/authz";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Owner only: another user watching the same repository must not read this patch, runner log or PR (V3).
  const fix = await ownFix(user.id, (await ctx.params).id);
  if (!fix || !(await canSee(user.id, fix.repo_key))) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ fix });
}
