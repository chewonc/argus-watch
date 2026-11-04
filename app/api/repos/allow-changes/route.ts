// POST { repo_key }: the signed-in user turns on "allow changes" for one of their own repositories from the Fix modal
// (same rule as Settings → Repositories → Allow draft pull requests). This is SaveBell's own per-repository opt-in; it
// writes nothing to GitHub, and every change still needs approval of the exact patch.
import { currentUser } from "@/lib/session";
import { SYSTEM_USER, store } from "@/lib/store";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { repo_key } = (await req.json().catch(() => ({}))) as { repo_key?: string };
  const key = String(repo_key ?? "");
  const ur = key ? await store.getUserRepo(user.id, key) : null;
  if (!ur) return Response.json({ error: "this repository is not connected to your account" }, { status: 404 });
  if ((await store.repoUsers(key)).includes(SYSTEM_USER)) return Response.json({ error: "shared demo repositories cannot receive changes" }, { status: 403 });
  if (!ur.allow_pr) {
    await store.addUserRepo({ ...ur, allow_pr: true });
    await store.log({ kind: "auth", source: "repos", detail: `${user.login} enabled draft PRs for ${key} (from the Fix modal)` });
  }
  return Response.json({ ok: true });
}
