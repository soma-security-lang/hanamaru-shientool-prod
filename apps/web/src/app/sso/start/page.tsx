"use client";

import { useEffect, useRef, useState } from "react";
import { beginCommonLogin, safeReturnTo } from "@/lib/auth/sso";

export default function CommonLoginStart() {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo") ?? "/");
    void beginCommonLogin(returnTo).catch(() => setFailed(true));
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f5f7] px-6 text-[#1d1d1f]">
      <section aria-live="polite" className="w-full max-w-md rounded-2xl border border-[#d2d2d7] bg-white p-6">
        <h1 className="text-xl font-semibold">共通ログイン</h1>
        <p className="mt-3 text-base leading-7">
          {failed ? "認証を開始できませんでした。接続を確認して、もう一度お試しください。" : "認証ページに移動しています。"}
        </p>
        {failed ? <button className="mt-5 min-h-12 rounded-xl bg-[#0066cc] px-5 text-white"
          onClick={() => { setFailed(false); const target = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo") ?? "/");
            void beginCommonLogin(target).catch(() => setFailed(true)); }}>
          もう一度試す
        </button> : null}
      </section>
    </main>
  );
}
