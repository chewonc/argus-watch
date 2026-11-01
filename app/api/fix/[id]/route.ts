import { canSee, currentUser } from "@/lib/session";
import { store } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const fix = await store.getFix((await ctx.params).id);
  if (!fix || !(await canSee(user.id, fix.repo_key))) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ fix });
}
