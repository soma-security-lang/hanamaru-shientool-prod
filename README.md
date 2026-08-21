# 買取支援ツール GCP版

PoCの業務機能と1,676件のコンテンツを継承した、GCP向け買取支援Webシステムです。Next.js Web、Fastify API、非同期Worker、PostgreSQL migration、GCP provider adapterをpnpm workspaceで管理します。

## Scope

- 実装対象: 20画面、REST `/api/v1`、RBAC、冪等性、監査、PostgreSQL、Worker、Storage/Tasks/STT/Vertex/Drive境界。
- ローカル: 匿名seed、一時PostgreSQL、deterministic provider。実PIIや秘密情報を使用しない。
- 本番: GCP providerとCloud SQLを必須設定で選択し、local adapterへfallbackしない。
- 公開先: GCP project `monocle-503402` の専用 `hanamaru-pilot-*` resource。既存`monocle-*` resourceは変更しない。
- 禁止: リポジトリをPRIVATE化しmain保護・Environment承認・WIFを設定する前のGitHub push、および実顧客PIIの試験投入。

## Local commands

```bash
corepack enable
pnpm install
pnpm dev
pnpm dev:api
pnpm dev:worker
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm infra:validate
pnpm test:security
pnpm docs:validate
pnpm test:e2e
pnpm test:local
```

Webは`http://localhost:3100`、APIは既定で`http://localhost:3200`です。`pnpm test:db`は隔離した一時PostgreSQL 16を起動し、現行migration manifest、匿名seed、PoC 1,676件import、DB/API/Worker統合試験を行って停止します。`pnpm test:local`は静的検査から実Google接続のPlaywright test・20画面×3 viewportの60枚HITL画像生成までを順に実行します。資格情報や匿名fixtureがない場合はskipを成功扱いせず停止します。

本番adapterは`PROVIDER_MODE=gcp`、Identity Platform短命Bearer token、runtime別`DATABASE_CONTEXT_ROLE`／`DATABASE_SYSTEM_ROLE`を必須とし、独自session cookieやfixture/local providerへfallbackしません。Terraformと`release-blue-green.sh`は、digest固定image、traffic 0% Green受入、段階昇格、自動rollback、exact-origin復元を正本とします。

PoC Git管理コンテンツを再抽出する場合は、clone済み`app.html`の絶対pathを指定します。

```bash
POC_GIT_SHA=<commit> pnpm poc:extract /absolute/path/to/app.html
```

設計正本はmonocle workspaceの`03_project-management/working-docs/hanamaru-shientool/`です。同期scriptは`HANAMARU_DOCS_ROOT`で別pathを明示できます。
