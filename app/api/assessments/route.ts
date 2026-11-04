// Read API: the signed-in user's visible assessments (or everything with the admin token).
import { assessmentFor, withAgentFor } from "@/lib/authz";
import { isAdminAuth } from "@/lib/env";
import { currentUser, visibleRepoKeys } from "@/lib/session";
import { store } from "@/lib/store";

export async function GET(req: Request) {
  const admin = isAdminAuth(req.headers.get("authorization"));
  const user = admin ? null : await currentUser();
  if (!admin && !user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const keys = user ? await visibleRepoKeys(user.id) : null;
  const id = new URL(req.url).searchParams.get("id");
  if (id) { const a = user ? await assessmentFor(user.id, id) : await store.getAssessment(id); return a && (!keys || keys.has(a.repo)) ? Response.json({ assessment: a }) : Response.json({ error: "not found" }, { status: 404 }); }
  const all = await store.listAssessments(200);
  return Response.json({ assessments: user && keys ? await withAgentFor(user.id, all.filter((a) => keys.has(a.repo))) : all });
}
