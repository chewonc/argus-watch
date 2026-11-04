// Product landing page: what Argus Watch is and how it works. Shown to everyone; signed-in users get a link to
// their alerts instead of sign-in. Older dashboard links (/?f=…) are forwarded to /alerts.
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing";
import { hasAuth } from "@/lib/env";
import { currentUser } from "@/lib/session";
import { getDict, getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (sp.f) redirect(`/alerts?f=${encodeURIComponent(sp.f)}`);
  const [user, d] = await Promise.all([currentUser(), getLocale().then(getDict)]);
  return <Landing signin={sp.signin === "1"} next={sp.next} authReady={hasAuth()} signedIn={!!user} d={d} />;
}
