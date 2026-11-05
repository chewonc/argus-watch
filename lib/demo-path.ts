/** Demo fixture path shown to users, without the legacy or renamed repository prefix. Pure: safe in client components. */
export const demoPath = (k: string) => k.replace(/^chewonc\/(argus-watch|save-bell)\//, "");
