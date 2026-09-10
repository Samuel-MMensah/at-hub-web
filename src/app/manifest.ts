import type { MetadataRoute } from "next";

// --at-navy from globals.css — kept in sync manually since manifest.ts
// can't import CSS custom properties.
const AT_NAVY = "#0f172a";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Appointed Time Job Order Hub",
    short_name: "Job Order Hub",
    start_url: "/",
    display: "standalone",
    background_color: AT_NAVY,
    theme_color: AT_NAVY,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
