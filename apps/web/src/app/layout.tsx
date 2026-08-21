import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "買取支援ツール｜華丸",
  description: "訪問準備、文字起こし、振り返り、現場知識、研修を一つにつなぐ買取支援ツール",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
