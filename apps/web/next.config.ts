import type { NextConfig } from "next";
import path from "node:path";

const noStoreHeaders = [
  { key: "Cache-Control", value: "private, no-cache, no-store, max-age=0, must-revalidate" },
];

// Local checks retain compilation/type checks but omit reusable disk cache and
// unused deployment packaging. Default and Cloud Run builds remain unchanged.
const localLowDisk = process.env.HANAMARU_ALIGNMENT_LOW_DISK === "true" && process.env.K_SERVICE === undefined;

const nextConfig: NextConfig = {
  // Existing Node-only business/provider modules must not be browser-bundled.
  serverExternalPackages: ["@hanamaru/api", "@hanamaru/alignment", "@hanamaru/database", "@hanamaru/platform",
    "@google-cloud/storage", "@google-cloud/tasks", "@google-cloud/speech", "@google/genai", "googleapis"],
  distDir: process.env.HANAMARU_E2E_NEXT_DIST_DIR ?? ".next",
  devIndicators: false,
  output: localLowDisk ? undefined : "standalone",
  ...(localLowDisk ? { experimental: { turbopackFileSystemCacheForBuild: false } } : {}),
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  async headers() {
    return [
      { source: "/", headers: noStoreHeaders },
      {
        source: "/login",
        headers: [
          ...noStoreHeaders,
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
      { source: "/visits/:path*", headers: noStoreHeaders },
      { source: "/reviews/:path*", headers: noStoreHeaders },
      { source: "/knowledge/:path*", headers: noStoreHeaders },
      { source: "/training/:path*", headers: noStoreHeaders },
      { source: "/admin/:path*", headers: noStoreHeaders },
      { source: "/market-price/:path*", headers: noStoreHeaders },
      { source: "/expense-settlement/:path*", headers: noStoreHeaders },
      { source: "/performance/:path*", headers: noStoreHeaders },
      { source: "/api/:path*", headers: noStoreHeaders },
      { source: "/sso/:path*", headers: noStoreHeaders },
      { source: "/__prototype/:path*", headers: noStoreHeaders },
    ];
  },
  async redirects() {
    return [
      { source: "/visits/:id/document", destination: "/visits/:id/import", permanent: false },
      { source: "/visits/:id/recording", destination: "/visits/:id/transcription", permanent: false },
      { source: "/visits/:id/transcription/status", destination: "/visits/:id/transcription", permanent: false },
      { source: "/visits/:id/transcript", destination: "/visits/:id/transcription", permanent: false },
      { source: "/history", destination: "/reviews", permanent: false },
      { source: "/contents/talks", destination: "/knowledge/talks", permanent: false },
      { source: "/contents/reference", destination: "/knowledge/reference", permanent: false },
      { source: "/training", destination: "/training/roleplay", permanent: false },
      { source: "/admin/jobs", destination: "/admin/operations?tab=jobs", permanent: false },
      { source: "/admin/retention", destination: "/admin/operations?tab=retention", permanent: false },
      { source: "/admin/audit", destination: "/admin/operations?tab=audit", permanent: false },
      { source: "/admin/content-approvals", destination: "/admin/approvals", permanent: false },
    ];
  },
};

export default nextConfig;
