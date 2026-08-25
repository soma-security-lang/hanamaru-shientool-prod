import type { NextConfig } from "next";
import path from "node:path";

const noStoreHeaders = [
  { key: "Cache-Control", value: "private, no-cache, no-store, max-age=0, must-revalidate" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
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
