// Queue: QStash when configured (one invocation per item, retries, signature-verified),
// else direct in-process call (dev). Every publish is counted against the daily free quota.
import { Client } from "@upstash/qstash";
import { env, hasQStash } from "./env";
import { store } from "./store";

const DAILY_SOFT_LIMIT = 900; // free tier is 1,000/day; keep headroom for schedules

export async function enqueueProcess(findingId: string, opts: { replayed?: boolean; onlyRepo?: string } = {}) {
  const url = `${env.APP_URL}/api/process/${encodeURIComponent(findingId)}`;
  const body = { replayed: !!opts.replayed, ...(opts.onlyRepo ? { only_repo: opts.onlyRepo } : {}) };
  if (!hasQStash()) {
    // Dev fallback: process inline (still async relative to the caller).
    const { processFinding } = await import("./pipeline");
    void processFinding(findingId, { replayed: !!opts.replayed, onlyRepo: opts.onlyRepo }).catch((e) =>
      store.log({ kind: "error", source: "queue", detail: `inline process failed: ${String(e).slice(0, 200)}`, ref: findingId }),
    );
    return { mode: "inline" as const };
  }
  const n = await store.countMessage();
  if (n > DAILY_SOFT_LIMIT) {
    await store.log({ kind: "error", source: "queue", detail: `daily QStash soft limit reached (${n}); finding deferred`, ref: findingId });
    return { mode: "deferred" as const };
  }
  const client = new Client({ token: env.QSTASH_TOKEN, ...(env.QSTASH_URL ? { baseUrl: env.QSTASH_URL } : {}) });
  // Dedup window: the same finding re-enqueued within the same 10-minute bucket is one QStash message (not one per source hit).
  const bucket = Math.floor(Date.now() / 600e3).toString(36);
  const res = await client.publishJSON({ url, body, retries: 3, deduplicationId: `${findingId}-${opts.replayed ? "replay" : "live"}-${opts.onlyRepo ? "bf-" + opts.onlyRepo : ""}-${bucket}`.replace(/[^A-Za-z0-9_.-]/g, "-") });
  return { mode: "qstash" as const, messageId: res.messageId };
}
