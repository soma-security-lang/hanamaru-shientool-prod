import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  async headers() {
    return [{
      source: "/login",
      headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
    }];
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
