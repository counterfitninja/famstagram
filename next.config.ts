import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

function resolveBuildCommit(): string {
  const configuredCommit =
    process.env.BUILD_COMMIT ??
    process.env.RENDER_GIT_COMMIT ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    process.env.COMMIT_SHA;
  if (configuredCommit) return configuredCommit;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    BUILD_COMMIT: resolveBuildCommit(),
  },
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
