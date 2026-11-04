// Whether the one-click Fix may be shown. Every condition must hold; otherwise the button is not rendered at all.
import { env } from "./env";
import { isVerified } from "./labels";
import type { Assessment } from "./schema";

export type FixGate = { enabled?: boolean; allowPr: boolean; isDemo: boolean; hasInstallation: boolean; writePermission: boolean | null; loc: { file: string } | null; priorFailed: boolean };
export const UNFIXABLE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.env[^/]*|[^/]+\.(pem|key))$|^\.github\/workflows\//;

export function canFix(a: Pick<Assessment, "verdict">, g: FixGate): boolean {
  return (g.enabled ?? env.FIX_ENABLED) && isVerified(a) && !!g.loc && !UNFIXABLE.test(g.loc.file) && g.allowPr && !g.isDemo && g.hasInstallation && g.writePermission === true && !g.priorFailed;
}
