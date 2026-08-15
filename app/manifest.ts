import type { MetadataRoute } from "next";

// Powers "Add to Home Screen" on Android/iOS — no Play Store/App Store listing
// involved, just a home-screen icon + standalone launch, backed by this file
// (Next.js auto-serves it and links it into every page's <head>).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dev OMS",
    short_name: "Dev OMS",
    description: "Dev OMS Internal Order & Inventory Management System",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
