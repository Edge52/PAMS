import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dirs let several dev servers run side by side (NEXT_DIST_DIR=.next-xyz).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Loaded from node_modules at runtime, not bundled (PGlite finds its WebAssembly files relative to itself).
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  agentRules: false, // AGENTS.md is our hand-written team conventions file
  experimental: { serverActions: { bodySizeLimit: "25mb" } }, // attachments up to 25 MB
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
