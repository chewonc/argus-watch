import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second dev server run from the same checkout without fighting over .next (NEXT_DIST_DIR=.next-xyz).
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
