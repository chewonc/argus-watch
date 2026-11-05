// GitHub access revalidation (V6). Repository visibility in SaveBell is a cache of what GitHub allows; this keeps it honest.
//   revalidateAccess   at most every ACCESS_TTL per user, with the user's own GitHub token: installations the user can
//                      no longer see are unlinked; repositories they can no longer access are marked access_lost (hidden,
//                      not notified, nothing deleted) and restored automatically when access returns.
//   assertUserCanWrite before any repository write: the user's own GitHub permission must include push, so an org
//                      member with read-only access cannot make the App write on their behalf.
import type { Installation } from "./schema";
import { store } from "./store";

export const ACCESS_TTL_MS = 15 * 60e3;

type GH = { listUserInstallations(t: string): Promise<{ id: number }[]>; listUserInstallationRepos(t: string, id: number): Promise<{ full_name: string }[]>; userRepoPermission(t: string, full: string): Promise<{ pull: boolean; push: boolean } | null> };
const github = async (): Promise<GH> => import("./github-app");

export async function revalidateAccess(uid: string, userToken: string | null, now = Date.now(), gh?: GH): Promise<{ checked: boolean; lost: string[]; restored: string[] }> {
  const last = await store.getAccessChecked(uid);
  if (!userToken || (last && now - Date.parse(last) < ACCESS_TTL_MS)) return { checked: false, lost: [], restored: [] };
  gh ??= await github();
  const insts = new Set((await gh.listUserInstallations(userToken)).map((i) => i.id));
  const lost: string[] = [], restored: string[] = [];
  const reposByInst = new Map<number, Set<string>>();
  for (const link of await store.listUserRepos(uid)) {
    let ok = true;
    if (link.installation_id) {
      if (!insts.has(link.installation_id)) ok = false;
      else {
        if (!reposByInst.has(link.installation_id)) reposByInst.set(link.installation_id, new Set((await gh.listUserInstallationRepos(userToken, link.installation_id)).map((r) => r.full_name)));
        ok = reposByInst.get(link.installation_id)!.has(link.repo_key.split("/").slice(0, 2).join("/"));
      }
    }
    if (!ok !== !!link.access_lost) {
      await store.addUserRepo({ ...link, access_lost: !ok });
      (ok ? restored : lost).push(link.repo_key);
    }
  }
  for (const i of (await store.listUserInstallations(uid)) as Installation[]) {
    if (!insts.has(i.id)) await store.putInstallation({ ...i, user_ids: i.user_ids.filter((u) => u !== uid) });
  }
  if (lost.length || restored.length) await store.log({ kind: "auth", source: "access", detail: `access revalidated for ${uid}: ${lost.length} lost, ${restored.length} restored`, ref: null });
  await store.setAccessChecked(uid, new Date(now).toISOString());
  return { checked: true, lost, restored };
}

export class AccessError extends Error { constructor(message: string, readonly status = 403) { super(message); } }

/** The user's own GitHub permission must allow pushing to this repository. Fails closed without a token. */
export async function assertUserCanWrite(userToken: string | null, repoKey: string, gh?: GH): Promise<void> {
  if (!userToken) throw new AccessError("sign in with GitHub again so SaveBell can confirm your write access to this repository");
  gh ??= await github();
  const p = await gh.userRepoPermission(userToken, repoKey.split("/").slice(0, 2).join("/"));
  if (!p?.push) throw new AccessError("your GitHub account does not have write access to this repository");
}
