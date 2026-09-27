"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { completeCommonLogin } from "@/lib/auth/sso";

export default function CommonLoginCallback() {
  const router = useRouter();
  const [error, setError] = useState("");
  const started = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    if (!started.current) {
      started.current = true;
      void completeCommonLogin(new URL(window.location.href))
        .then((returnTo) => { if (active.current) { router.replace(returnTo); router.refresh(); } })
        .catch(() => { if (active.current) setError("共通ログインに失敗しました。もう一度お試しください。"); });
    }
    return () => { active.current = false; };
  }, [router]);
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
    {error ? <div role="alert"><p>{error}</p><Link href="/login">ログインへ戻る</Link></div>
      : <p role="status">ログインを確認しています…</p>}
  </main>;
}
