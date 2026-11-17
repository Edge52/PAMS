import type { MetadataRoute } from "next";

/** Lets a phone add PAMS to its home screen and open it full screen, like an app (wave 26). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hospital PAMS",
    short_name: "PAMS",
    description: "Hospital procurement, BOQ and medical asset management",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f5f3",
    theme_color: "#0c1f1a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Scan a label", url: "/scan", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Report a fault", url: "/assets/work-orders/new" },
      { name: "Rounds and stock-take", url: "/assets/rounds" },
    ],
  };
}
