# 買取支援ツール GCP版 開発ガイド

このリポジトリは、既存PoCをGCP向けのレスポンシブWebシステムへ再構築するための実装正本です。

## 固定方針

- Next.js 16 App Router、TypeScript strict、pnpm workspaceを使用する。
- UIはCSS Modulesとsemantic design tokensで実装し、Tailwind CSSを導入しない。
- 実行先はGCP Cloud Runを前提とし、Vercel、Supabase、Cloudflare Sitesへ切り替えない。
- Web、API、Worker、PostgreSQL migration、GCP provider adapterを同一monorepoで管理する。
- 自動テストの`local` providerと、利用者確認用の`local-connected` providerを分ける。利用者確認ではローカルPostgreSQL/Storage/Taskと正式なGoogle APIを組み合わせる。
- 音声文字起こしはGoogle Cloud Speech-to-Text V2のSTT専用モデル`chirp_3`を使用する。Gemini Audio、Speech-to-Text V1、Whisperを本番・利用者確認経路へ入れない。
- 本番設定でlocal adapterや開発用認証へ黙ってfallbackしない。必須設定がなければ起動を失敗させる。
- 現工程では、ローカル検証済みの実装を専用のGCP `hanamaru-pilot-*` 資源へデプロイし、公開後の実E2Eまでを対象とする。既存の `monocle-*` 資源は変更しない。GitHub pushは別途明示承認があるまで行わない。
- UI文言は日本語とし、実顧客情報、秘密情報、APIキーをfixtureへ含めない。
- PoCの業務要素とコンテンツは継承するが、DOM、CSS、インラインJavaScript、画面構成はコピーしない。

## 品質

- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:db`、`pnpm build`、`pnpm test:e2e`を成功させる。
- WebはIdentity PlatformでGoogle認証を行い、APIへ短命ID tokenをBearer送信する。APIはtoken検証とmembership/RBAC判定を行い、独自session cookieやCSRF tokenを発行しない。
- state-changing APIは認可、冪等性、楽観ロック、監査を通す。本文、token、署名URL、provider raw errorをlogへ出さない。
- semantic HTML、keyboard操作、focus管理、44px以上の操作領域、reduced motion/transparency/contrastを守る。
- SCR-019とSCR-020は既定feature flag無効とし、開発用prototype modeからのみ確認可能にする。
