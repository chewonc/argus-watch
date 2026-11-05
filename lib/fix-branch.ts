/** Destination branch for a fix. Fixed by the fix id, never chosen by the client.
 *  New fixes use "savebell/"; grants issued before the rename keep their stored "argus/" branch (see lib/fix-apply.ts). */
export const fixBranch = (fixId: string) => `savebell/fix-${fixId.slice(0, 8)}`;
