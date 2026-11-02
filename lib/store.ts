// Storage: Upstash Redis when configured, else an in-process Map persisted to .data/store.json (dev only).
import { Redis } from "@upstash/redis";
import { env, hasRedis } from "./env";
import type { Assessment, Finding, Fix, Installation, Item, LogEntry, Notification, PushSubscription, User, UserRepo, WatchedRepo } from "./schema";

type KV = {
  get<T>(k: string): Promise<T | null>;
  set(k: string, v: unknown): Promise<void>;
  del(k: string): Promise<void>;
  sadd(k: string, ...m: string[]): Promise<void>;
  smembers(k: string): Promise<string[]>;
  lpush(k: string, v: unknown): Promise<void>;
  lrange<T>(k: string, start: number, stop: number): Promise<T[]>;
  ltrim(k: string, start: number, stop: number): Promise<void>;
  setnx(k: string, v: unknown): Promise<boolean>;
  incr(k: string): Promise<number>;
  srem(k: string, ...m: string[]): Promise<void>;
  scard(k: string): Promise<number>;
  mget<T>(ks: string[]): Promise<(T | null)[]>;
  mset(kv: Record<string, unknown>): Promise<void>;
};

// Dev fallback persists to .data/store.json (gitignored) so hot reloads and restarts keep state.
import fs from "node:fs";
import path from "node:path";
const DATA_FILE = path.join(process.cwd(), ".data", "store.json");
function loadMem(): Map<string, unknown> {
  try {
    const j = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Record<string, { t: "v" | "s"; v: unknown }>;
    return new Map(Object.entries(j).map(([k, e]) => [k, e.t === "s" ? new Set(e.v as string[]) : e.v]));
  } catch { return new Map(); }
}
const g = globalThis as unknown as { __aw_mem?: Map<string, unknown>; __aw_timer?: NodeJS.Timeout };
const mem = (g.__aw_mem ??= loadMem());
function persist() {
  if (hasRedis() || process.env.AW_NO_PERSIST) return; // tests never touch .data/store.json
  clearTimeout(g.__aw_timer);
  g.__aw_timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const obj: Record<string, { t: "v" | "s"; v: unknown }> = {};
      for (const [k, v] of mem) obj[k] = v instanceof Set ? { t: "s", v: [...v] } : { t: "v", v };
      fs.writeFileSync(DATA_FILE, JSON.stringify(obj));
    } catch { /* best effort */ }
  }, 250);
}
const memKV: KV = {
  async get<T>(k: string) { return (mem.get(k) as T) ?? null; },
  async set(k, v) { mem.set(k, v); persist(); },
  async del(k) { mem.delete(k); persist(); },
  async sadd(k, ...m) { const s = (mem.get(k) as Set<string>) ?? new Set(); m.forEach((x) => s.add(x)); mem.set(k, s); persist(); },
  async smembers(k) { return [...((mem.get(k) as Set<string>) ?? new Set())]; },
  async lpush(k, v) { const l = (mem.get(k) as unknown[]) ?? []; l.unshift(v); mem.set(k, l); persist(); },
  async lrange<T>(k: string, a: number, b: number) { const l = (mem.get(k) as T[]) ?? []; return l.slice(a, b === -1 ? undefined : b + 1); },
  async ltrim(k, a, b) { const l = (mem.get(k) as unknown[]) ?? []; mem.set(k, l.slice(a, b + 1)); persist(); },
  async setnx(k, v) { if (mem.has(k)) return false; mem.set(k, v); persist(); return true; },
  async incr(k) { const n = ((mem.get(k) as number) ?? 0) + 1; mem.set(k, n); persist(); return n; },
  async srem(k, ...m) { const s = mem.get(k) as Set<string> | undefined; if (!s) return; m.forEach((x) => s.delete(x)); persist(); },
  async scard(k) { return ((mem.get(k) as Set<string>) ?? new Set()).size; },
  async mget<T>(ks: string[]) { return ks.map((k) => (mem.get(k) as T) ?? null); },
  async mset(o) { for (const [k, v] of Object.entries(o)) mem.set(k, v); persist(); },
};

function redisKV(): KV {
  const r = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return {
    get: (k) => r.get(k),
    set: async (k, v) => { await r.set(k, v); },
    del: async (k) => { await r.del(k); },
    sadd: async (k, ...m) => { if (m.length) await r.sadd(k, m[0], ...m.slice(1)); },
    smembers: (k) => r.smembers(k),
    lpush: async (k, v) => { await r.lpush(k, v); },
    lrange: (k, a, b) => r.lrange(k, a, b),
    ltrim: async (k, a, b) => { await r.ltrim(k, a, b); },
    setnx: async (k, v) => (await r.setnx(k, v)) === 1,
    incr: (k) => r.incr(k),
    srem: async (k, ...m) => { if (m.length) await r.srem(k, m[0], ...m.slice(1)); },
    scard: (k) => r.scard(k),
    mget: async <T,>(ks: string[]) => (ks.length ? await r.mget<(T | null)[]>(...ks) : []),
    mset: async (o) => { if (Object.keys(o).length) await r.mset(o); },
  };
}

export const kv: KV = hasRedis() ? redisKV() : memKV;
export const storageMode = hasRedis() ? "upstash-redis" : "local file (.data/store.json, dev only)";

const K = {
  item: (id: string) => `item:${id}`,
  finding: (id: string) => `finding:${id}`,
  findings: "findings", // set of ids
  alias: (id: string) => `alias:${id.toUpperCase()}`, // CVE/GHSA/OSV id -> finding id
  urlKey: (u: string) => `url:${u}`,
  assessment: (id: string) => `assessment:${id}`,
  assessments: "assessments", // list, newest first
  repo: (r: string) => `repo:${r}`,
  repos: "repos",
  log: "log",
  seen: (source: string, key: string) => `seen:${source}:${key}`,
  pollState: (source: string) => `poll:${source}`,
  daily: (d: string) => `msgs:${d}`,
  // identity layer
  user: (uid: string) => `user:${uid}`,
  users: "users",
  inst: (id: number) => `inst:${id}`,
  userInsts: (uid: string) => `user:${uid}:insts`,
  urepo: (uid: string, k: string) => `urepo:${uid}:${k}`,
  userRepos: (uid: string) => `user:${uid}:repos`,
  repoUsers: (k: string) => `repo:${k}:users`,
  read: (uid: string) => `read:${uid}`,
  resolved: (uid: string) => `resolved:${uid}`,
  notif: (uid: string) => `notif:${uid}`, // list of notification ids, newest first
  notifi: (nid: string) => `notifi:${nid}`,
  unread: (uid: string) => `notif:${uid}:unread`,
  notifDedup: (uid: string, fid: string, k: string) => `notifd:${uid}:${fid}:${k}`,
  push: (uid: string) => `push:${uid}`,
  fix: (id: string) => `fix:${id}`,
  fixesFor: (aid: string) => `assessment:${aid}:fixes`,
  ghtok: (inst: number) => `ghtok:${inst}`,
};
export const SYSTEM_USER = "system";

export const store = {
  // items
  putItem: (i: Item) => kv.set(K.item(i.id), i),
  getItem: (id: string) => kv.get<Item>(K.item(id)),
  /** returns true the first time a (source,key) pair is seen */
  markSeen: (source: string, key: string) => kv.setnx(K.seen(source, key), new Date().toISOString()),

  // findings
  async putFinding(f: Finding) {
    await kv.set(K.finding(f.id), f);
    await kv.sadd(K.findings, f.id);
    for (const a of f.ids) await kv.set(K.alias(a), f.id);
  },
  getFinding: (id: string) => kv.get<Finding>(K.finding(id)),
  findingIdByAlias: (a: string) => kv.get<string>(K.alias(a)),
  findingIdByUrl: (u: string) => kv.get<string>(K.urlKey(u)),
  setUrl: (u: string, fid: string) => kv.set(K.urlKey(u), fid),
  async listFindings(): Promise<Finding[]> {
    const ids = await kv.smembers(K.findings);
    const fs = await Promise.all(ids.map((id) => kv.get<Finding>(K.finding(id))));
    return fs.filter((x): x is Finding => !!x).sort((a, b) => b.discovered_at.localeCompare(a.discovered_at));
  },

  // assessments (idempotent: the list holds each id once, newest first)
  async putAssessment(a: Assessment) {
    const had = await kv.get<Assessment>(K.assessment(a.id));
    await kv.set(K.assessment(a.id), a);
    if (!had) { await kv.lpush(K.assessments, a.id); await kv.ltrim(K.assessments, 0, 999); }
  },
  getAssessment: (id: string) => kv.get<Assessment>(K.assessment(id)),
  async listAssessmentIds(n = 1000): Promise<string[]> {
    return [...new Set(await kv.lrange<string>(K.assessments, 0, n - 1))];
  },
  async listAssessments(n = 100): Promise<Assessment[]> {
    const ids = (await this.listAssessmentIds(n + 50)).slice(0, n);
    const as = await kv.mget<Assessment>(ids.map(K.assessment));
    return as.filter((x): x is Assessment => !!x);
  },
  /** Rewrite the assessments list without duplicates or dangling ids; delete assessments/findings whose repo matches `repoPrefix` when given. */
  async cleanup(repoPrefix?: string): Promise<{ list_before: number; list_after: number; deleted_assessments: number; deleted_findings: number }> {
    const raw = await kv.lrange<string>(K.assessments, 0, -1);
    const ids = [...new Set(raw)];
    const as = await kv.mget<Assessment>(ids.map(K.assessment));
    const keep: string[] = []; let deleted_assessments = 0;
    for (let i = 0; i < ids.length; i++) {
      const a = as[i];
      if (!a) continue;
      if (repoPrefix && a.repo.startsWith(repoPrefix)) { await kv.del(K.assessment(ids[i])); deleted_assessments++; continue; }
      keep.push(ids[i]);
    }
    await kv.del(K.assessments);
    for (const id of keep.reverse()) await kv.lpush(K.assessments, id);
    let deleted_findings = 0;
    if (repoPrefix) for (const f of await this.listFindings()) if (f.relevant_repos.some((r) => r.startsWith(repoPrefix)) && f.relevant_repos.every((r) => r.startsWith(repoPrefix))) {
      await kv.del(K.finding(f.id)); await kv.srem(K.findings, f.id); for (const a of f.ids) await kv.del(K.alias(a)); deleted_findings++;
    }
    return { list_before: raw.length, list_after: keep.length, deleted_assessments, deleted_findings };
  },

  // repos
  repoKey: (r: WatchedRepo) => (r.subdir ? `${r.repo}/${r.subdir}` : r.repo),
  async putRepo(r: WatchedRepo) { const k = r.subdir ? `${r.repo}/${r.subdir}` : r.repo; await kv.set(K.repo(k), r); await kv.sadd(K.repos, k); },
  getRepo: (r: string) => kv.get<WatchedRepo>(K.repo(r)),
  async removeRepo(k: string) { await kv.del(K.repo(k)); await kv.srem(K.repos, k); },
  async listRepos(): Promise<WatchedRepo[]> {
    const ids = await kv.smembers(K.repos);
    const rs = await Promise.all(ids.map((id) => kv.get<WatchedRepo>(K.repo(id))));
    return rs.filter((x): x is WatchedRepo => !!x);
  },

  // poll state + log
  getPollState: <T>(source: string) => kv.get<T>(K.pollState(source)),
  setPollState: (source: string, v: unknown) => kv.set(K.pollState(source), v),
  /** one document per poller family holding etags + recent guids (replaces one setnx per entry) */
  getSeenDoc: <T>(key: string) => kv.get<T>(key),
  setSeenDoc: (key: string, v: unknown) => kv.set(key, v),
  async log(e: Omit<LogEntry, "at">) {
    const entry: LogEntry = { at: new Date().toISOString(), ...e };
    await kv.lpush(K.log, entry);
    await kv.ltrim(K.log, 0, 1999);
    return entry;
  },
  recentLog: (n = 200) => kv.lrange<LogEntry>(K.log, 0, n - 1),
  /** daily QStash message counter (free tier: 1,000/day) */
  countMessage: () => kv.incr(K.daily(new Date().toISOString().slice(0, 10))),

  // ---- users / installations / per-user repos ----------------------------
  async putUser(u: User) { await kv.set(K.user(u.id), u); await kv.sadd(K.users, u.id); },
  getUser: (uid: string) => kv.get<User>(K.user(uid)),
  listUserIds: () => kv.smembers(K.users),
  async putInstallation(i: Installation) { await kv.set(K.inst(i.id), i); for (const u of i.user_ids) await kv.sadd(K.userInsts(u), String(i.id)); },
  getInstallation: (id: number) => kv.get<Installation>(K.inst(id)),
  async listUserInstallations(uid: string): Promise<Installation[]> {
    const ids = await kv.smembers(K.userInsts(uid));
    return (await kv.mget<Installation>(ids.map((i) => K.inst(Number(i))))).filter((x): x is Installation => !!x);
  },
  async addUserRepo(ur: UserRepo) { await kv.set(K.urepo(ur.user_id, ur.repo_key), ur); await kv.sadd(K.userRepos(ur.user_id), ur.repo_key); await kv.sadd(K.repoUsers(ur.repo_key), ur.user_id); },
  getUserRepo: (uid: string, k: string) => kv.get<UserRepo>(K.urepo(uid, k)),
  /** Remove the user's link; drop the WatchedRepo itself once nobody watches it. */
  async removeUserRepo(uid: string, k: string): Promise<{ repo_removed: boolean }> {
    await kv.del(K.urepo(uid, k)); await kv.srem(K.userRepos(uid), k); await kv.srem(K.repoUsers(k), uid);
    if ((await kv.scard(K.repoUsers(k))) === 0) { await this.removeRepo(k); return { repo_removed: true }; }
    return { repo_removed: false };
  },
  listUserRepoKeys: (uid: string) => kv.smembers(K.userRepos(uid)),
  async listUserRepos(uid: string): Promise<UserRepo[]> {
    const ks = await kv.smembers(K.userRepos(uid));
    return (await kv.mget<UserRepo>(ks.map((k) => K.urepo(uid, k)))).filter((x): x is UserRepo => !!x);
  },
  repoUsers: (k: string) => kv.smembers(K.repoUsers(k)),

  // ---- per-user read / resolved state ---------------------------------------
  markRead: (uid: string, aid: string) => kv.sadd(K.read(uid), aid),
  readSet: (uid: string) => kv.smembers(K.read(uid)),
  markResolved: (uid: string, aid: string) => kv.sadd(K.resolved(uid), aid),
  unresolve: (uid: string, aid: string) => kv.srem(K.resolved(uid), aid),
  resolvedSet: (uid: string) => kv.smembers(K.resolved(uid)),

  // ---- notifications ----------------------------------------------------------
  async putNotification(n: Notification, isNew: boolean) {
    await kv.set(K.notifi(n.id), n);
    if (isNew) { await kv.lpush(K.notif(n.user_id), n.id); await kv.ltrim(K.notif(n.user_id), 0, 299); }
    if (!n.read_at) await kv.sadd(K.unread(n.user_id), n.id);
  },
  getNotification: (nid: string) => kv.get<Notification>(K.notifi(nid)),
  async listNotifications(uid: string, n = 50): Promise<Notification[]> {
    const ids = [...new Set(await kv.lrange<string>(K.notif(uid), 0, n - 1))];
    return (await kv.mget<Notification>(ids.map(K.notifi))).filter((x): x is Notification => !!x);
  },
  /** Recent notifications across all users (for latency L5/L6); bounded to keep the status route cheap. */
  async listAllNotifications(perUser = 30, maxUsers = 50): Promise<Notification[]> {
    const uids = (await kv.smembers(K.users)).slice(0, maxUsers);
    const lists = await Promise.all(uids.map((u) => store.listNotifications(u, perUser)));
    return lists.flat();
  },
  unreadCount: (uid: string) => kv.scard(K.unread(uid)),
  unreadIds: (uid: string) => kv.smembers(K.unread(uid)),
  async markNotificationRead(uid: string, nid: string) {
    const n = await kv.get<Notification>(K.notifi(nid));
    if (n && n.user_id === uid) { if (!n.read_at) { n.read_at = new Date().toISOString(); await kv.set(K.notifi(nid), n); } await kv.srem(K.unread(uid), nid); await kv.sadd(K.read(uid), n.assessment_id); }
  },
  notifDedupGet: (uid: string, fid: string, k: string) => kv.get<string>(K.notifDedup(uid, fid, k)),
  notifDedupSet: (uid: string, fid: string, k: string, nid: string) => kv.set(K.notifDedup(uid, fid, k), nid),

  // ---- push subscriptions -----------------------------------------------------
  addPush: (uid: string, s: PushSubscription) => kv.sadd(K.push(uid), JSON.stringify(s)),
  removePush: (uid: string, endpoint: string) => kv.smembers(K.push(uid)).then(async (all) => { for (const j of all) if ((JSON.parse(j) as PushSubscription).endpoint === endpoint) await kv.srem(K.push(uid), j); }),
  async listPush(uid: string): Promise<PushSubscription[]> { return (await kv.smembers(K.push(uid))).map((j) => JSON.parse(j) as PushSubscription); },

  // ---- fixes ------------------------------------------------------------------
  async putFix(f: Fix, isNew = false) { await kv.set(K.fix(f.id), f); if (isNew) await kv.lpush(K.fixesFor(f.assessment_id), f.id); },
  getFix: (id: string) => kv.get<Fix>(K.fix(id)),
  async listFixes(aid: string): Promise<Fix[]> {
    const ids = [...new Set(await kv.lrange<string>(K.fixesFor(aid), 0, 19))];
    return (await kv.mget<Fix>(ids.map(K.fix))).filter((x): x is Fix => !!x);
  },

  // ---- installation token cache (KV has no TTL; expiry checked by the caller) ----
  getToken: (inst: number) => kv.get<{ token: string; exp: string }>(K.ghtok(inst)),
  setToken: (inst: number, v: { token: string; exp: string }) => kv.set(K.ghtok(inst), v),
};
