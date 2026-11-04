// Read API: findings (admin token) or the findings relevant to the signed-in user's repositories.
import { redactFinding } from "@/lib/authz";
import { isAdminAuth } from "@/lib/env";
import { currentUser, visibleRepoKeys } from "@/lib/session";
import { store } from "@/lib/store";

export async function GET(req: Request) {
  const admin = isAdminAuth(req.headers.get("authorization"));
  const user = admin ? null : await currentUser();
  if (!admin && !user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const keys = user ? await visibleRepoKeys(user.id) : null;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const f = await store.getFinding(id);
    if (!f || (keys && !f.relevant_repos.some((r) => keys.has(r)))) return Response.json({ error: "not found" }, { status: 404 });
    const items = (await Promise.all(f.items.map((i) => store.getItem(i)))).filter(Boolean);
    return Response.json({ finding: keys ? redactFinding(f, keys) : f, items });
  }
  const all = await store.listFindings();
  // Users see relevant_repos only for their own repositories, never other users' repository names (V2).
  return Response.json({ findings: keys ? all.filter((f) => f.relevant_repos.some((r) => keys.has(r))).map((f) => redactFinding(f, keys)) : all });
}
