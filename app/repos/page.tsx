// /repos: onboarding (connect GitHub, choose the first repositories). Users who already monitor repositories manage
// them in Settings → Repositories; action results (?added=…, ?error=…) still render here for the onboarding flow.
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";
import { RepositoriesPanel } from "./panel";

export const dynamic = "force-dynamic";

export default async function Repos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("/repos");
  const sp = await searchParams;
  const hasResult = Object.keys(sp).length > 0;
  if (!hasResult && (await store.listUserRepoKeys(user.id)).length > 0) redirect("/settings#repositories");
  return <RepositoriesPanel sp={sp} />;
}
