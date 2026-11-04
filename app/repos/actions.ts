"use server";
// Repository onboarding actions. Every write here is to SaveBell's own store; nothing is written to GitHub.
import { listUserInstallationRepos } from "@/lib/github-app";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { explainGitHubError, listInstallationReposApp } from "@/lib/github-app";
import { forgetInstallations, refreshRepo } from "@/lib/repo";
import { backfillRepo } from "@/lib/pipeline";
import { WatchedRepo } from "@/lib/schema";
import { githubUserToken, requireUser } from "@/lib/session";
import { SYSTEM_USER, store } from "@/lib/store";

/** Start the GitHub App installation flow with a state nonce that /api/github/setup checks. */
/** Where to send the user after an action: Settings → Repositories when the form came from Settings, else /repos. */
const dest = (fd: FormData | undefined, qs: string) => (fd?.get("back") === "settings" ? `/settings?${qs}#repositories` : `/repos?${qs}`);

export async function beginConnect(formData?: FormData) {
  await requireUser("/repos");
  if (!env.GITHUB_APP_SLUG) redirect(dest(formData, "error=app_slug_missing"));
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("aw_gh_state", state, { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https"), path: "/", maxAge: 600 });
  redirect(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${state}`);
}

/**
 * Save the repository picker: start monitoring the ticked repositories (`repo`) and stop monitoring the unticked
 * ones (`stop`, confirmed by the user in the browser). Stopping keeps history and never touches GitHub access.
 */
export async function addRepos(formData: FormData) {
  const user = await requireUser("/repos");
  const instId = Number(formData.get("installation_id"));
  const picked = formData.getAll("repo").map(String).filter(Boolean);
  const stops = formData.getAll("stop").map(String).filter(Boolean);
  const inst = await store.getInstallation(instId);
  if (!inst || !inst.user_ids.includes(user.id)) redirect(dest(formData, "error=installation_not_yours"));
  const stopped: string[] = [];
  for (const key of stops) {
    const ur = await store.getUserRepo(user.id, key);
    if (!ur || ur.paused || (ur.installation_id != null && ur.installation_id !== instId)) continue; // only this user's own, in this installation
    await store.addUserRepo({ ...ur, paused: true });
    stopped.push(key);
  }
  if (stopped.length) await store.log({ kind: "auth", source: "repos", detail: `${user.login} stopped monitoring ${stopped.join(", ")}`.slice(0, 300) });
  if (!picked.length) {
    revalidatePath("/repos"); revalidatePath("/settings"); revalidatePath("/alerts");
    redirect(dest(formData, `paused=${encodeURIComponent(stopped.join(", "))}`));
  }
  // Listed with the App's installation token: works after the user's sign-in token has expired.
  let list: Awaited<ReturnType<typeof listInstallationReposApp>>;
  try { list = await listInstallationReposApp(instId); } catch (e) { redirect(dest(formData, `error=${encodeURIComponent(explainGitHubError(e, inst.account))}`)); }
  // Only repositories this user can access on GitHub themselves, not everything the App can read in a shared org (V6).
  const token = await githubUserToken();
  if (!token) redirect(dest(formData, "error=no_token"));
  let mineOnGitHub: Set<string>;
  try { mineOnGitHub = new Set((await listUserInstallationRepos(token, instId)).map((r) => r.full_name)); } catch (e) { redirect(dest(formData, `error=${encodeURIComponent(explainGitHubError(e, inst.account))}`)); }
  const available = new Map(list.filter((r) => mineOnGitHub.has(r.full_name)).map((r) => [r.full_name, r]));
  const errors: string[] = [];
  let backfilled = 0;
  for (const full of picked) {
    const meta = available.get(full);
    if (!meta) { errors.push(`${full}: not in this installation, or your GitHub account cannot access it`); continue; }
    const existing = await store.getRepo(full);
    const w = existing ?? WatchedRepo.parse({ repo: full, default_branch: meta.default_branch, installation_id: instId, private: meta.private });
    try {
      const r = await refreshRepo({ ...w, installation_id: instId, private: meta.private });
      await store.putRepo(r);
    } catch (e) { errors.push(`${full}: ${String(e).slice(0, 120)}`); continue; }
    // Re-adding a repository keeps the user's earlier settings (draft-PR opt-in, local path) and resumes monitoring.
    const prev = await store.getUserRepo(user.id, full);
    await store.addUserRepo({ user_id: user.id, repo_key: full, installation_id: instId, allow_pr: prev?.allow_pr ?? false, local_root: prev?.local_root ?? null, paused: false, added_at: prev?.added_at ?? new Date().toISOString() });
    // Initial scan: check the last 30 days of actionable threats against the new repository (queued, bounded).
    try { const b = await backfillRepo(full); backfilled += b.queued; } catch (e) { await store.log({ kind: "error", source: "backfill", detail: `${full}: ${String(e).slice(0, 160)}` }); }
  }
  forgetInstallations();
  await store.log({ kind: "auth", source: "repos", detail: `${user.login} watches ${picked.length - errors.length} repo(s) via installation ${instId}${errors.length ? `; errors: ${errors.join("; ")}` : ""}`.slice(0, 300) });
  revalidatePath("/repos"); revalidatePath("/settings"); revalidatePath("/alerts");
  const stopQs = stopped.length ? `&paused=${encodeURIComponent(stopped.join(", "))}` : "";
  redirect(errors.length ? dest(formData, `error=${encodeURIComponent(errors.join(" | ").slice(0, 300))}${stopQs}`) : dest(formData, `added=1&checking=${backfilled}${stopQs}`));
}

export async function removeRepo(formData: FormData) {
  const user = await requireUser("/repos");
  const key = String(formData.get("repo_key"));
  const r = await store.removeUserRepo(user.id, key);
  forgetInstallations();
  await store.log({ kind: "auth", source: "repos", detail: `${user.login} stopped watching ${key}${r.repo_removed ? " (last watcher; repo dropped)" : ""}` });
  revalidatePath("/repos"); revalidatePath("/settings"); revalidatePath("/alerts");
}

/** Pause or resume monitoring for this user. Paused: no new assessments or notifications; existing alerts stay. */
export async function setPaused(formData: FormData) {
  const user = await requireUser("/repos");
  const key = String(formData.get("repo_key"));
  const paused = formData.get("paused") === "1";
  const ur = await store.getUserRepo(user.id, key);
  if (!ur) redirect(dest(formData, "error=not_watched"));
  await store.addUserRepo({ ...ur, paused });
  await store.log({ kind: "auth", source: "repos", detail: `${user.login} ${paused ? "paused" : "resumed"} monitoring of ${key}` });
  revalidatePath("/repos"); revalidatePath("/settings"); revalidatePath("/alerts");
  redirect(dest(formData, `${paused ? "paused" : "resumed"}=${encodeURIComponent(key)}`));
}

/** Explicit per-repo opt-in for draft pull requests. Never available for shared demo repos. */
export async function setAllowPr(formData: FormData) {
  const user = await requireUser("/repos");
  const key = String(formData.get("repo_key"));
  const on = formData.get("allow_pr") === "on";
  const ur = await store.getUserRepo(user.id, key);
  if (!ur) redirect(dest(formData, "error=not_watched"));
  if ((await store.repoUsers(key)).includes(SYSTEM_USER)) redirect(dest(formData, "error=demo_repo_no_pr"));
  await store.addUserRepo({ ...ur, allow_pr: on });
  await store.log({ kind: "auth", source: "repos", detail: `${user.login} ${on ? "enabled" : "disabled"} draft PRs for ${key}` });
  revalidatePath("/repos"); revalidatePath("/settings"); revalidatePath("/alerts");
}

export async function setLocalRoot(formData: FormData) {
  const user = await requireUser("/repos");
  const key = String(formData.get("repo_key"));
  const root = String(formData.get("local_root") ?? "").trim() || null;
  const ur = await store.getUserRepo(user.id, key);
  if (!ur) redirect(dest(formData, "error=not_watched"));
  await store.addUserRepo({ ...ur, local_root: root });
  revalidatePath("/repos");
}

export async function rescan(formData: FormData) {
  const user = await requireUser("/repos");
  const key = String(formData.get("repo_key"));
  // Only a user's own repositories; shared demo repositories are rescanned by the operator, not by every user (V5).
  if (!(await store.getUserRepo(user.id, key))) redirect(dest(formData, "error=not_watched"));
  const w = await store.getRepo(key);
  if (!w) redirect(dest(formData, "error=not_watched"));
  try { const r = await refreshRepo({ ...w, refreshed_at: null }); await store.putRepo(r); }
  catch (e) { redirect(`/repos?error=${encodeURIComponent(`rescan ${key}: ${String(e).slice(0, 120)}`)}`); }
  revalidatePath("/repos"); revalidatePath("/settings"); revalidatePath("/alerts");
  redirect(dest(formData, "rescanned=1"));
}
