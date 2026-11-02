// Server-side session helpers. A user id is "gh:<github numeric id>" so that it is stable across stateless sessions.
// `system` is the reserved owner of admin-registered demo repos (shown to everyone when DEMO_SHARED_REPOS=1).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { env, hasAuth } from "./env";
import type { User } from "./schema";
import { SYSTEM_USER, kv, store } from "./store";

const memo = new Map<string, { uid: string; at: number }>();

/** The GitHub user access token from the encrypted account cookie (null when signed out). */
export async function githubUserToken(): Promise<string | null> {
  try {
    const r = await auth.api.getAccessToken({ body: { providerId: "github", useAccountCookie: true } as never, headers: await headers() });
    return (r as { accessToken?: string } | null)?.accessToken ?? null;
  } catch { return null; }
}

/** Local development only: `AW_DEV_USER=<login>` signs in a stub user so the signed-in UI can be exercised without GitHub
 *  OAuth credentials. Honoured only outside production AND only when real sign-in is not configured; never on Vercel. */
export const devUserLogin = () => (process.env.NODE_ENV !== "production" && !hasAuth() && process.env.AW_DEV_USER) || null;
async function devUser(login: string): Promise<User> {
  const uid = `dev:${login}`;
  let u = await store.getUser(uid);
  if (!u) {
    u = { id: uid, login, name: `${login} (local dev stub)`, email: null, avatar: null, created_at: new Date().toISOString(), settings: { inapp: true, push: false, webhook_url: null, locale: "en" } };
    await store.putUser(u);
    await store.log({ kind: "auth", source: "dev", detail: `dev stub user ${login} (AW_DEV_USER; not available in production)` });
  }
  return u;
}

/** Resolve the signed-in user; creates the User record on first sight. */
export async function currentUser(): Promise<User | null> {
  const dev = devUserLogin();
  if (dev) return devUser(dev);
  if (!hasAuth()) return null;
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s?.user) return null;
  const baId = s.user.id;
  const cached = memo.get(baId);
  let uid = cached && Date.now() - cached.at < 10 * 60e3 ? cached.uid : (await kv.get<string>(`uidmap:${baId}`)) ?? null;
  if (!uid) {
    // First sight of this session: ask GitHub for the numeric id once, then remember the mapping.
    const token = await githubUserToken();
    const gh = token ? await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, "User-Agent": "ArgusWatch/0.1", Accept: "application/vnd.github+json" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { id: number; login: string; name: string | null; email: string | null; avatar_url: string | null } | null : null;
    if (!gh) return null;
    uid = `gh:${gh.id}`;
    await kv.set(`uidmap:${baId}`, uid);
    if (!(await store.getUser(uid))) {
      await store.putUser({ id: uid, login: gh.login, name: gh.name ?? s.user.name ?? null, email: gh.email ?? s.user.email ?? null, avatar: gh.avatar_url ?? s.user.image ?? null, created_at: new Date().toISOString(), settings: { inapp: true, push: false, webhook_url: null, locale: "en" } });
      await store.log({ kind: "auth", source: "github", detail: `new user ${gh.login}` });
    }
  }
  memo.set(baId, { uid, at: Date.now() });
  const u = await store.getUser(uid);
  return u ?? null;
}

export async function requireUser(nextPath = "/"): Promise<User> {
  const u = await currentUser();
  if (!u) redirect(`/?signin=1&next=${encodeURIComponent(nextPath)}`);
  return u;
}

/** Repo keys this user may see: their own plus the system (demo) repos when sharing is enabled. */
export async function visibleRepoKeys(uid: string): Promise<Set<string>> {
  const own = await store.listUserRepoKeys(uid);
  const sys = env.DEMO_SHARED_REPOS ? await store.listUserRepoKeys(SYSTEM_USER) : [];
  return new Set([...own, ...sys]);
}

export const canSee = async (uid: string, repoKey: string) => (await visibleRepoKeys(uid)).has(repoKey);
export const isSystemRepo = async (repoKey: string) => (await store.repoUsers(repoKey)).includes(SYSTEM_USER);
