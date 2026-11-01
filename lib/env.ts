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
  QSTASH_URL: process.env.QSTASH_URL ?? "", // regional endpoint, e.g. https://qstash-eu-central-1.upstash.io (from the Upstash console)
  QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
  QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL ?? "", // Slack or Discord incoming webhook
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "", // protects replay / manual routes
  // Identity + GitHub App (sign-in uses the App's OAuth client; repo access uses installation tokens)
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "",
  GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
  GITHUB_APP_PRIVATE_KEY: (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG ?? "",
  DEMO_SHARED_REPOS: process.env.DEMO_SHARED_REPOS === "1", // show admin-registered ("system") repos to every signed-in user
  // Translation + push
  GOOGLE_TRANSLATE_API_KEY: process.env.GOOGLE_TRANSLATE_API_KEY ?? "",
  VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "",
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? "",
  VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? "mailto:argus-watch@example.com",
  APP_URL: (process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, ""),
};

export const hasRedis = () => !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
export const hasQStash = () => !!env.QSTASH_TOKEN;
export const hasAuth = () => !!(env.BETTER_AUTH_SECRET && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
export const hasGitHubApp = () => !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
export const hasTranslate = () => !!env.GOOGLE_TRANSLATE_API_KEY;
export const hasPush = () => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
