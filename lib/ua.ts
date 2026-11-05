// Outbound User-Agent for every HTTP request SaveBell makes (feeds, GitHub API, robots.txt, verification).
import { env } from "./env";

export const USER_AGENT = `SaveBell/0.1 (+${env.APP_URL})`;
