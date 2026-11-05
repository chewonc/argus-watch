// Sign-in: Better Auth in stateless mode (no database; encrypted cookie sessions) with GitHub as the only provider.
// The OAuth client is the GitHub App's own client, so the user token can list the user's App installations.
// Nothing here grants repository access: that comes from App installations the user connects on /repos.
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { env } from "./env";

// The dev fallback is refused on a Vercel production deployment so sessions can never be signed with a public key.
function authSecret(): string {
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  if (process.env.VERCEL_ENV === "production") throw new Error("BETTER_AUTH_SECRET must be set in production");
  return "dev-only-secret-change-me-dev-only-secret-change-me";
}

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: authSecret(),
  // No `database`: sessions and the OAuth account live in encrypted cookies (storeAccountCookie is implied).
  session: { cookieCache: { enabled: true, maxAge: 60 * 60 * 24 * 7 } },
  socialProviders: {
    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, scope: ["read:user", "user:email"] },
  },
  plugins: [nextCookies()],
});

export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
