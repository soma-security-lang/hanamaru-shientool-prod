import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { ViewerProvider } from "@/components/auth/ViewerProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "買取支援ツール｜華丸",
  description: "訪問準備、文字起こし、振り返り、現場知識、研修を一つにつなぐ買取支援ツール",
};
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const runtime = {
    apiBaseUrl: process.env.HANAMARU_RUNTIME_API_BASE_URL || undefined,
    ssoIssuer: process.env.SSO_ISSUER || undefined,
  };
  const serialized = JSON.stringify(runtime).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return (
    <html lang="ja">
      <body>
        <Script id="hanamaru-runtime-config" strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: `window.__HANAMARU_RUNTIME_CONFIG=${serialized};` }} />
        <ViewerProvider>{children}</ViewerProvider>
      </body>
    </html>
  );
}
