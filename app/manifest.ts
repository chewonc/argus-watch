// Web app manifest: name and icons for bookmarks, shortcuts and "install" prompts (Next.js serves it at /manifest.webmanifest).
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SaveBell",
    short_name: "SaveBell",
    description: "Continuous AI security threat intelligence, connected to your actual code.",
    start_url: "/",
    display: "browser",
    background_color: "#f7f5f0",
    theme_color: "#b4452b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
