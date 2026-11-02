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
  return (await githubUserTokenDiag()).token;
}
/** Same, with the failure reason kept (never the token itself) for /api/auth/whoami and the auth log. */
export async function githubUserTokenDiag(): Promise<{ token: string | null; error: string | null }> {
  try {
    // Better Auth 1.7 stateless mode: the account-cookie selection is a strict object; passing providerId with it is rejected.
    const r = await auth.api.getAccessToken({ body: { useAccountCookie: true } as never, headers: await headers() });
    const token = (r as { accessToken?: string } | null)?.accessToken ?? null;
    return { token, error: token ? null : "getAccessToken returned no accessToken (account cookie missing or not bound to this session)" };
  } catch (e) { return { token: null, error: `getAccessToken threw: ${String((e as Error).message ?? e).slice(0, 160)}` }; }
}

/** Step-by-step view of the current browser's sign-in state (no secrets). */
export async function whoami(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { auth_configured: hasAuth(), dev_stub: !!devUserLogin() };
  if (!hasAuth()) return out;
  try {
    const s = await auth.api.getSession({ headers: await headers() });
    out.session = s ? { user_id: s.user.id, name: s.user.name, expires: s.session.expiresAt } : null;
  } catch (e) { out.session_error = String((e as Error).message ?? e).slice(0, 160); }
  const t = await githubUserTokenDiag();
  out.github_token = !!t.token; if (t.error) out.github_token_error = t.error;
  if (t.token) {
    const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${t.token}`, "User-Agent": "ArgusWatch/0.1", Accept: "application/vnd.github+json" } }).catch((e) => ({ ok: false, status: 0, statusText: String(e) } as Response));
    out.github_user = r.ok ? (await r.json() as { id: number; login: string }).login : `GitHub /user ${r.status} ${r.statusText}`;
  }
  const u = await currentUser().catch((e) => ({ error: String(e).slice(0, 160) } as unknown as User));
  out.resolved_user = u ? { id: (u as User).id, login: (u as User).login } : null;
  return out;
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
    const t = await githubUserTokenDiag();
    let ghErr: string | null = t.error;
    const gh = t.token ? await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${t.token}`, "User-Agent": "ArgusWatch/0.1", Accept: "application/vnd.github+json" } }).then(async (r) => (r.ok ? r.json() : (ghErr = `GitHub /user ${r.status}`, null))).catch((e) => (ghErr = `GitHub /user failed: ${String(e).slice(0, 80)}`, null)) as { id: number; login: string; name: string | null; email: string | null; avatar_url: string | null } | null : null;
    if (gh) {
      uid = `gh:${gh.id}`;
      await kv.set(`uidmap:${baId}`, uid);
      if (!(await store.getUser(uid))) {
        await store.putUser({ id: uid, login: gh.login, name: gh.name ?? s.user.name ?? null, email: gh.email ?? s.user.email ?? null, avatar: gh.avatar_url ?? s.user.image ?? null, created_at: new Date().toISOString(), settings: { inapp: true, push: false, webhook_url: null, locale: "en" } });
        await store.log({ kind: "auth", source: "github", detail: `new user ${gh.login}` });
      }
    } else {
      // The Better Auth session is valid but the GitHub token path failed: keep the user signed in with the session
      // identity rather than silently showing the landing page, and record why so /api/status shows it.
      // (Repository listing needs the token, so the Repos page will say so; demo repos still work.)
      uid = `ba:${baId}`;
      await store.log({ kind: "auth", source: "github", detail: `session ok but no GitHub token: ${ghErr ?? "unknown"}; using session identity` });
      if (!(await store.getUser(uid))) {
        const login = (s.user.name || s.user.email || baId).replace(/\s+/g, "-").slice(0, 40);
        await store.putUser({ id: uid, login, name: s.user.name ?? null, email: s.user.email ?? null, avatar: s.user.image ?? null, created_at: new Date().toISOString(), settings: { inapp: true, push: false, webhook_url: null, locale: "en" } });
      }
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
