import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Middleware buffers request bodies before passing them to route handlers.
    // Leave room for multipart overhead above the 100 MB media validation limit.
    middlewareClientMaxBodySize: "110mb",
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },

  async headers() {
    return [
      {
        // Service worker updates must never be served from cache: browsers revalidate
        // /sw.js on every page load, and a stale cached copy can strand clients on an
        // old worker indefinitely.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
