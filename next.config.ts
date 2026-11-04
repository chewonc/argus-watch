import type { NextConfig } from "next";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

// A second dev server can run from the same checkout with NEXT_DIST_DIR=.next-xyz (see SETUP "Second dev server").
// Next.js appends `<distDir>/types/**/*.ts` and `<distDir>/dev/types/**/*.ts` to the `include` of whichever tsconfig it
// uses, and rewrites that file. With a custom distDir that would edit the tracked tsconfig.json on every start, so a
// custom distDir gets its own generated, git-ignored tsconfig.<distDir>.json that extends the tracked one.
const distDir = process.env.NEXT_DIST_DIR || ".next";

function tsconfigFor(dir: string): string | undefined {
  if (dir === ".next") return undefined; // default: the tracked tsconfig.json already lists the .next type paths
  const name = `tsconfig.${dir.replace(/^\./, "").replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
  const file = path.join(process.cwd(), name);
  if (!existsSync(file)) {
    const base = JSON.parse(readFileSync(path.join(process.cwd(), "tsconfig.json"), "utf8")) as { include?: string[]; exclude?: string[] };
    // `extends` does not merge arrays, so include/exclude are copied, with the .next type paths swapped for this distDir.
    const include = (base.include ?? []).map((p) => p.replace(/^\.next\//, `${dir}/`));
    writeFileSync(file, JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { plugins: [{ name: "next" }] }, include, exclude: base.exclude ?? ["node_modules"] }, null, 2) + "\n");
  }
  return name;
}

const tsconfigPath = tsconfigFor(distDir);

const nextConfig: NextConfig = {
  distDir,
  ...(tsconfigPath ? { typescript: { tsconfigPath } } : {}),
  // Pages read a live store on every request; cacheComponents (static-first) is off on purpose.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
