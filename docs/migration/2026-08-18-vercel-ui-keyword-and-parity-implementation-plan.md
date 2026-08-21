# Vercel水準 UIキーワード・機能パリティ実装計画

## 1. ゴール

Vercel版の「機能名を見ただけで用途が分かる」語彙水準をGCP版へ反映しつつ、GCP版で追加した20画面、PC/Web中心構成、実API、認証、権限、監査、保存・削除を維持する。

完成状態は次のとおり。

- Vercel版の主要業務キーワードが、GCP版のナビゲーション、画面見出し、検索、空状態から認識できる。
- GCP版の追加機能を削らず、Vercel版以上の業務導線を維持する。
- 管理画面のraw enum、英語type、`batch`、hash等を利用者向け日本語へ翻訳する。
- 技術情報は削除せず、監査・障害対応者向けの詳細表示へ移す。
- 20画面、全role、レスポンシブ、アクセシビリティを再検証する。
- 設計書、差分台帳、修正台帳、実装、テスト、画像のdriftを0にする。
- Cloud Run反映は固定digest、no-traffic Green、公開検証、rollback保持の順で行う。

## 2. 入力と正本

| Input ID | 入力 | 用途 |
| --- | --- | --- |
| IN-001 | `https://hanamaru-shientool.vercel.app/app.html` | Vercel本番の表示語彙、機能入口、説明文 |
| IN-002 | Vercel commit `1c40c3ecd521a8640af3f6b6e98f36b029dde8dc` | 公開物と一致する旧実装正本 |
| IN-003 | [差分台帳](./2026-08-18-vercel-gcp-difference-ledger.md) | 差分、証拠、意図的変更 |
| IN-004 | [修正台帳](./2026-08-18-vercel-gcp-correction-ledger.md) | 修正単位、優先度、受入条件 |
| IN-005 | `apps/web/src/features/lane-a|b|c/screens.ts` | SCR-001〜020の画面名・route・role |
| IN-006 | `apps/web/src/components/shell/AppShell.tsx` | グローバルナビゲーション正本 |
| IN-007 | `apps/web/src/features/web/Experience.tsx` | 本番表示・操作実装 |
| IN-008 | `packages/contracts` | API enum・DTOの型正本 |
| IN-009 | 成果物グラフのSCR-001〜020、DLV-040/041、Trace | 画面設計と追跡性 |

## 3. 実装原則

### 3.1 Vercel版から継承するもの

- 買取支援AIであることが分かる名称。
- 訪問前チェック、振り返り、切り返しトーク、困ったときのフロー、用語集、金券買取価格表、接客マニュアル、法務・コンプライアンス、動画ライブラリ、AIロープレという業務語。
- 機能名の直下に、利用者が得られる結果を短く示す説明。
- 業務担当者が内部構造を知らなくても操作できる文言。

### 3.2 GCP版で維持するもの

- Next.js／Reactによるsemantic HTML。
- PC 1440pxを中心とするSidebar、Table、Split view。
- PDF起点の訪問登録。
- 録音同意、音声取込、Chirp 3文字起こし、話者割当。
- 根拠付きAI訪問準備、6領域AI振り返り、自由対話ロールプレイ。
- Identity Platform、Bearer token、membership、RBAC、scope。
- 1,676件の移行コンテンツと未承認利用警告。
- ジョブ、監査、保存・削除、Legal Hold、承認SoD。
- 個人ランキング、人事評価、ブラウザAPIキー、匿名利用の禁止。

### 3.3 実装しないもの

- Vercel版の単一HTML、DOM、CSS、インラインJavaScriptの移植。
- 絵文字を主要アイコン体系へ戻すこと。
- Vercel固定件数の複製。
- API/DB enum自体の日本語化。
- Request ID、hash、ジョブIDの削除。
- UI文言変更と無関係なバックエンド仕様変更。
- HITL前の公開デプロイ。

## 4. 確定する語彙体系

### 4.1 レベル別の名称

| レベル | 用途 | 基準 |
| --- | --- | --- |
| Product | 製品名 | 「買取支援ツール」 |
| Domain | 上位ナビゲーション | 買取支援AI、訪問前チェック、振り返りチェックシート、現場の知識、研修、管理 |
| Feature | 画面・サブナビゲーション | Vercel版の具体的な業務名を優先 |
| Action | ボタン | 「対象＋動詞」で結果を明示 |
| State | Badge／Table | 日本語の状態＋必要時に短い補足 |
| Technical | 詳細表示 | Request ID、hash、内部コード。通常情報から分離 |

### 4.2 画面名の作業案

| SCR | 現在 | 作業案 | 備考 |
| --- | --- | --- | --- |
| SCR-001 | ログイン | ログイン | 維持 |
| SCR-002 | AI支援ホーム／AI支援 | 買取支援AI | Vercelの用途具体性を継承 |
| SCR-003 | 訪問業務／訪問支援 | 訪問前チェック | Vercel利用者が入口を即時認識できる名称を上位導線に使用 |
| SCR-004 | PDF取込・情報確認 | PDFから訪問を登録 | 利用者行動を優先 |
| SCR-005 | 訪問前チェック | 訪問前チェック | 維持 |
| SCR-006 | 録音・文字起こし | 録音・文字起こし | 維持 |
| SCR-007 | 振り返り入力 | 振り返りを作成 | 行動を明示 |
| SCR-008 | AI振り返り結果 | AI振り返り結果 | 維持 |
| SCR-009 | 振り返り履歴 | 振り返り履歴 | 維持 |
| SCR-010 | 切り返しトーク | 切り返しトーク集 | Vercel表記へ寄せる候補 |
| SCR-011 | 困ったときのフロー | 困ったときのフロー集 | Vercel表記と一致させ、説明文で対応手順であることを補う |
| SCR-012 | 用語・価格 | 用語集・金券買取価格表 | 2機能を明示 |
| SCR-013 | マニュアル・法務 | 接客マニュアル・法務 | コンプライアンスは常設タブで明示 |
| SCR-014 | 動画ライブラリ | 動画ライブラリ | 維持 |
| SCR-015 | AIロールプレイ | AIロープレ | Vercel表記へ寄せる案。HITLで最終決定 |
| SCR-016 | コンテンツ管理 | コンテンツ管理 | 維持 |
| SCR-017 | 利用者・権限 | 利用者・権限 | 維持 |
| SCR-018 | システム運用 | システム運用 | 維持。内部値のみ翻訳 |
| SCR-019 | コンテンツ承認 | コンテンツ承認 | 維持。`batch`を廃止 |
| SCR-020 | チーム分析 | チーム分析 | 維持 |

確定語彙は実装、aria-label、画面定義、設計書へ同時反映する。現行の工程名は維持しつつ、上位導線ではVercel利用者が認識できる具体語を優先する。

## 5. UI内部インターフェース

### 5.1 表示辞書

新規の表示層を`apps/web/src/lib/ui-vocabulary/`へ置く。

```text
apps/web/src/lib/ui-vocabulary/
├── content.ts
├── jobs.ts
├── memberships.ts
├── approvals.ts
├── routes.ts
├── technical-details.ts
└── index.ts
```

想定APIは次のとおり。

```ts
interface DisplayLabel {
  label: string;
  description?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  nextAction?: string;
}

function contentTypeLabel(value: ContentType): DisplayLabel;
function publicationStateLabel(value: PublicationState): DisplayLabel;
function jobTypeLabel(value: JobType): DisplayLabel;
function jobStateLabel(value: JobState): DisplayLabel;
function entityTypeLabel(value: EntityType): DisplayLabel;
function approvalStateLabel(value: ApprovalState): DisplayLabel;
function membershipStateLabel(value: MembershipState): DisplayLabel;
function unknownValueLabel(namespace: string, value: never): DisplayLabel;
```

### 5.2 TechnicalDetails

`Request ID`、hash、ジョブID、エラーコードを表示する共通部品を追加する。

```ts
interface TechnicalDetailItem {
  label: string;
  value: string;
  copyable?: boolean;
}

interface TechnicalDetailsProps {
  summary?: string;
  items: TechnicalDetailItem[];
}
```

要件：

- 初期状態は閉じる。
- `<details>`／`<summary>`または同等のkeyboard操作を提供する。
- コピー結果をlive regionで通知する。
- token、署名URL、本文、provider raw errorを渡せない型・呼出し規約にする。
- 値がない項目を表示しない。

## 6. 実装工程

### Stage 0：ベースライン固定

1. Vercel公開HTMLのSHA-256、commit、Deployment IDを証拠へ保存する。
2. GCP公開URL、現行local HEAD、20画面routeを記録する。
3. [差分台帳](./2026-08-18-vercel-gcp-difference-ledger.md)と[修正台帳](./2026-08-18-vercel-gcp-correction-ledger.md)をCritic確認する。
4. 意図的差分を修正対象へ混入させない。

完了条件：差分IDとCOR IDが1対多または1対1で追跡できる。

### Stage 1：語彙契約

1. Feature名、Action名、State名、Technical名の4層を確定する。
2. `UiVocabulary`と各enum表示辞書を実装する。
3. 未知値fallbackをfail-visibleにする。
4. 用語単体テストを作成する。

完了条件：既知enum 100%に日本語labelがあり、未知値の挙動がテストされる。

### Stage 2：査定員向け主要導線

対象：SCR-002〜015。

1. `AppShell`の上位カテゴリは維持し、下位機能を常設表示する。
2. AI、訪問、振り返り、知識、研修のPage titleと説明を語彙契約へ合わせる。
3. 「用語集」「金券買取価格表」「接客マニュアル」「法務・コンプライアンス」を画面を開く前から認識可能にする。
4. 「AIロープレ／AIロールプレイ」を1表記へ統一する。
5. 件数をAPI／catalog由来のまま維持する。

完了条件：Vercelの主要9機能がナビゲーションまたは常設サブナビゲーションで認識できる。

### Stage 3：管理画面日本語化

対象：SCR-016〜019。

1. 公開状態、利用状態、ジョブ状態、承認状態を辞書へ接続する。
2. job type、entity type、content typeを業務語へ変換する。
3. `batch`を日本語の承認単位へ置換する。
4. Snapshot/hash/Request ID/ジョブID/エラーコードを`TechnicalDetails`へ移す。
5. 復旧可能な状態では、状態名と次の行動を同時に表示する。
6. 監査イベントはaction codeに加え、日本語の操作名を主表示する。

完了条件：通常表示領域のraw enumと禁止語が0件になる。

### Stage 4：横断状態・アクセシビリティ

1. loading、empty、success、partial、failure、retry、forbidden、deletedの表示語を統一する。
2. 状態を色だけで表現しない。
3. 読込中、完了、失敗、コピー完了を適切なlive regionへ出す。
4. 文言変更後のfocus、dialog、sheet、keyboard操作を再確認する。
5. 200% zoom、390／834／1440pxで文字切れを確認する。

完了条件：axe serious/critical 0、主要操作44px以上、headingと表示階層が一致する。

### Stage 5：自動検証

順序：

```text
pnpm lint
→ pnpm typecheck
→ pnpm test
→ pnpm test:db
→ pnpm build
→ Playwright route/role/accessibility
→ 60画面画像
→ forbidden-term scan
→ docs/trace drift検査
```

静的検査対象：

- 通常UIの`batch`。
- raw job status。
- raw approval status。
- raw publication status。
- raw content type。
- `Snapshot SHA-256`と`原文hash`の常時表示。
- `SCR-*`、fixture、prototype、API未接続等の開発メタ情報。

例外として許容する場所：

- `TechnicalDetails`内部。
- 開発時限定`/__prototype`。
- test fixture、型定義、API client。
- screen reader向けに意味が明確な技術ラベル。

### Stage 6：設計同期

1. SCR-001〜020の画面名、説明、状態、エラー、受入条件を更新する。
2. DLV-040、DLV-041、共通UI仕様を同期する。
3. `DIFF-* → COR-* → SCR-* → test`をTraceへ追加する。
4. HTML／Markdown driftを0にする。
5. CriticでVercel機能欠落、過剰コピー、内部語露出を再確認する。

### Stage 7：HITL

HITLでは次を確認する。

- Vercel版を知る利用者が、GCP版の同等機能を迷わず見つけられるか。
- Vercel版より増えた工程が、不要な管理画面化になっていないか。
- 査定員向け機能が管理機能より先に見えるか。
- 主要ボタンが「何が起きるか」を説明しているか。
- 英語状態値や内部コードが通常UIへ残っていないか。
- 技術詳細から障害調査情報へ到達できるか。
- 個人ランキング、人事評価、ブラウザAPIキーが復活していないか。

### Stage 8：Cloud Run反映

HITL承認後にのみ実施する。

1. Web imageをdigest固定でbuildする。
2. privateまたはno-traffic revisionへ反映する。
3. Identity Platform認証、20画面、role、PDF、音声、AI導線をsmoke確認する。
4. 既存revisionと比較し、問題がなければtrafficを切り替える。
5. 公開URLでPlaywright、axe、画像、語彙scanを再実行する。
6. 問題時は旧revisionへtrafficを戻す。

## 7. テスト設計

### 7.1 Unit

| Test ID | 検証 |
| --- | --- |
| UT-LEX-001 | 全ContentTypeが日本語表示を持つ |
| UT-LEX-002 | 全JobStateが状態、説明、toneを持つ |
| UT-LEX-003 | 全ApprovalStateが日本語表示を持つ |
| UT-LEX-004 | 全MembershipStateが日本語表示を持つ |
| UT-LEX-005 | 未知値はraw値だけを主要表示しない |
| UT-TECH-001 | TechnicalDetailsは初期状態で閉じている |
| UT-TECH-002 | keyboardで開閉・コピーできる |
| UT-TECH-003 | コピー完了を読み上げる |
| UT-NAV-001 | Vercel主要9機能の語がナビゲーション階層に存在する |

### 7.2 Component／Route

| Test ID | 検証 |
| --- | --- |
| CT-SCR-002 | 買取支援AI、根拠、訪問入口が表示される |
| CT-SCR-012 | 用語集と金券買取価格表を認識できる |
| CT-SCR-013 | 接客マニュアルと法務・コンプライアンスを認識できる |
| CT-SCR-015 | ロールプレイ表記が統一される |
| CT-SCR-016 | publicationStateが日本語になる |
| CT-SCR-017 | membership stateが日本語になる |
| CT-SCR-018 | job state/type/entityが日本語になり、IDは詳細内にある |
| CT-SCR-019 | batch/type/status/hashが通常表示へ露出しない |

### 7.3 E2E

| E2E ID | Journey |
| --- | --- |
| E2E-PAR-001 | Login → 買取支援AI → 根拠コンテンツ |
| E2E-PAR-002 | Login → PDFから訪問登録 → 訪問前チェック |
| E2E-PAR-003 | 訪問 → 録音 → 文字起こし → 振り返り |
| E2E-PAR-004 | 現場の知識 → トーク／フロー／用語／価格／マニュアル／法務 |
| E2E-PAR-005 | 研修 → AIロープレ → 自分の練習履歴 |
| E2E-PAR-006 | 管理 → ジョブ詳細 → 日本語状態 → 技術詳細 |
| E2E-PAR-007 | 承認 → 対象固定確認 → 承認／差戻し |
| E2E-PAR-008 | system_adminが案件本文へ到達できない |

## 8. 受入条件

- Vercel版の主要9機能がGCP版から到達可能。
- 査定員向け主要機能の欠落0件。
- 通常UIのraw enum露出0件。
- 通常UIの`batch`表示0件。
- hashとRequest IDは技術詳細から確認可能。
- 固定件数表示0件。
- 20画面の表示名、role、feature flag、routeが整合する。
- 個人ランキング、人事評価、匿名利用、ブラウザAPIキーが存在しない。
- lint、typecheck、unit、DB、build、Playwrightが成功する。
- axe serious/critical 0。
- 20画面×3幅の画像を確認済み。
- HTML／Markdown drift 0。
- 公開時はno-traffic Green、20 Route、認証、Error log、rollback先を確認済み。

## 9. リスクと対策

| Risk ID | リスク | 対策 |
| --- | --- | --- |
| R-001 | Vercel表記へ寄せすぎてGCPの工程が分かりにくくなる | 上位語は継承し、工程名はGCPの正確な行動語を維持する |
| R-002 | 状態翻訳で障害調査情報が失われる | raw値をTechnicalDetailsへ保持する |
| R-003 | 未知enumを誤って正常表示する | 未知値をfail-visibleにし、監視対象にする |
| R-004 | 文言変更でテストselectorが壊れる | role/label主体を維持し、必要箇所は安定したdata属性を使う |
| R-005 | 長い日本語でPC／Mobile表示が崩れる | 390／834／1440px、200% zoom、長文fixtureで確認する |
| R-006 | 個人評価表現が再導入される | forbidden-term検査とSCR-015/020の受入条件で防ぐ |
| R-007 | 公開中サービスへ直接反映して戻せない | no-traffic revision、digest固定、traffic rollbackを使う |
| R-008 | Vercel内部設定を取得できず誤認する | 公開物、GitHub Deployment、対象commitの一致だけを比較根拠とする |

## 10. 成果物

- 更新済みSCR-001〜020。
- 共通UI語彙仕様。
- 表示辞書とTechnicalDetails。
- 更新済み全20画面。
- Unit／Component／E2E証跡。
- 20画面×3幅の画像。
- forbidden-term scan結果。
- HTML／Markdown drift結果。
- 更新済み[修正台帳](./2026-08-18-vercel-gcp-correction-ledger.md)。
- Cloud Run反映時のrevision、digest、rollback記録。

## 11. 実装状況（2026-08-19）

- Stage 1〜3を実装し、共通表示辞書、未知値fallback、`TechnicalDetails`、査定員向けサブナビゲーション、管理画面日本語化を反映した。
- SCR-001〜020、DLV-040、共通UI仕様、コンポーネントカタログを実装語彙へ同期した。
- Node.js `22.16.0`でlint、typecheck、unit、PostgreSQL結合、production build、screen-doc validation、security scanを完走した。Webは152 tests、DB結合はDatabase 18／Worker 12／API 44 testsが成功した。
- Stage 4〜5のoffline Browser-to-DB E2Eは4/4成功し、全20画面、PDF→準備、音声→文字起こし→6領域AI振り返り、査定員RBAC、axe serious/critical 0、60画面画像を確認した。証跡は `.artifacts/offline-e2e/20260819T011757Z`。
- このE2Eはdeterministic local providerであり、Google Identity／Drive／Vertex AI／Chirp 3のlive受入を代替しない。
- 初回修正はCloud Build `f4daf935-7416-45cc-860a-18566a1b326a`で成功し、Cloud Run Web revision `hanamaru-pilot-web-00043-yic`へ100%反映した。公開20 RouteはHTTP 200、Web/APIの切替後ERROR logは0件だった。
- 公開後再比較で、具体語を常設しない上位導線、「困ったときの対応フロー」、API由来`承認batch`の3点を検出し、COR-025として追加修正した。
- COR-025追加後はNode.js `22.16.0`でWeb 155 tests、root lint、typecheck、production build、20画面／180状態の文書検査、250 filesのSecret/PII検査に合格した。production bundleから旧フロー名と`承認batch`が消えていることも確認した。
- COR-025はCloud Build `b628ba62-320c-4c4e-9064-8dff9885836d`の固定digestでGreen revision `hanamaru-pilot-web-00045-niw`へ配備し、公開トラフィックを100%切り替えた。20 Route、認証基盤、API health、配信語彙、Error logは合格し、rollback先`00043-yic`を保持している。

現在の状態は「COR-001〜026実装・検証・Cloud Run公開完了、利用者HITL可能」。VercelとGitHubには変更していない。
