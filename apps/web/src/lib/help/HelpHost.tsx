"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useViewer } from "@/components/auth/ViewerProvider";
import { AppShell } from "@/components/shell/AppShell";
import { apiClient } from "@/lib/api/client";
import HelpCenter from "./HelpCenter";
import type { HelpArticle, HelpAnswer, HelpQuestion } from "./engine";
type Catalog = { name: string; examples: string[]; articles: HelpArticle[] };
async function ask(input: HelpQuestion, signal: AbortSignal) {
  return apiClient.request<HelpAnswer>("/help/questions", {
    method: "POST",
    signal,
    body: JSON.stringify(input),
  });
}
function HelpLoader({ slug, retry }: { slug?: string; retry: () => void }) {
  const [data, setData] = useState<Catalog | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .request<Catalog>("/help", { signal: controller.signal })
      .then((v) => {
        if (!controller.signal.aborted) setData(v);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  return error ? (
    <section>
      <h1>ヘルプを取得できませんでした</h1>
      <button type="button" onClick={retry}>
        再読み込み
      </button>
    </section>
  ) : data ? (
    <HelpCenter
      name={data.name}
      articles={data.articles}
      examples={data.examples}
      {...(slug ? { slug } : {})}
      ask={ask}
    />
  ) : (
    <p role="status">ヘルプを読み込んでいます。</p>
  );
}
export default function HelpHost({ slug }: { slug?: string }) {
  const { viewer, authState, retryViewer } = useViewer(),
    pathname = usePathname();
  if (!viewer)
    return (
      <main style={{ padding: 24 }}>
        <h1>ヘルプ・使い方</h1>
        {authState === "loading" ? (
          <p role="status">利用者情報を確認しています。</p>
        ) : (
          <>
            <p>ログインしてヘルプをご利用ください。</p>
            <Link href="/login?returnTo=%2Fhelp">ログインへ進む</Link>
            {authState === "failed" && (
              <button onClick={retryViewer}>再読み込み</button>
            )}
          </>
        )}
      </main>
    );
  const role = viewer.roles[0] ?? "assessor";
  return (
    <AppShell
      pathname={pathname}
      role={role}
      roles={viewer.roles}
      displayName={viewer.displayName}
      featureFlags={viewer.featureFlags}
    >
      <HelpLoader
        key={JSON.stringify([viewer.id, viewer.roles, viewer.featureFlags])}
        {...(slug ? { slug } : {})}
        retry={retryViewer}
      />
    </AppShell>
  );
}
