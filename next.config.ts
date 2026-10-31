import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
