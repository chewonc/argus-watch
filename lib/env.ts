// Central env access. Secrets are read here only and never logged.
export const env = {
  META_API_KEY: process.env.META_API_KEY ?? "",
  META_MODEL: process.env.META_MODEL ?? "muse-spark-1.3",
  META_BASE_URL: process.env.META_BASE_URL ?? "https://api.meta.ai/v1",
  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "", // read-only contents access
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? "",
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ?? "",
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  QSTASH_TOKEN: process.env.QSTASH_TOKEN ?? "",
  QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
  QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL ?? "", // Slack or Discord incoming webhook
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "", // protects replay / manual routes
  APP_URL: process.env.APP_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000",
};

export const hasRedis = () => !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
export const hasQStash = () => !!env.QSTASH_TOKEN;
