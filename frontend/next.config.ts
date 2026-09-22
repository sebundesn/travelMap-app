import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
