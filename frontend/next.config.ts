import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone build: Dockerfile copies only .next/standalone + static/public,
  // no node_modules needed at runtime.
  output: "standalone",
  // Old bookmarks and QR codes keep working; the query string (?add=handle) is carried over.
  async redirects() {
    return [
      { source: "/friends", destination: "/profile", permanent: false },
      { source: "/stats", destination: "/diary", permanent: false },
      { source: "/ranking", destination: "/diary?tab=ranking", permanent: false },
    ];
  },
};

export default nextConfig;
