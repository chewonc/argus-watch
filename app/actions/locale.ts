"use server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { normalizeLocale } from "@/lib/i18n/translate";

/** Persist the chosen language. The client then calls router.refresh(): server components re-render in place, no navigation. */
export async function setLocale(code: string) {
  (await cookies()).set(LOCALE_COOKIE, normalizeLocale(code), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
