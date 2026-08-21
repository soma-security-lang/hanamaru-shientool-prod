# Vercel版／GCP版 UI差分 修正管理台帳

## 1. 文書情報

| 項目 | 内容 |
| --- | --- |
| 文書ID | MIG-CORR-20260818 |
| 基準日 | 2026-08-18 |
| 目的 | [差分台帳](./2026-08-18-vercel-gcp-difference-ledger.md)で検出した差分を、修正単位、影響範囲、受入条件、検証証拠へ分解する |
| 現在状態 | 初回修正と公開後再比較の追加修正をCloud Runへ公開し、20 Route、認証基盤、API health、配信語彙、Error logを検証済み |
| 実装計画 | [UIキーワード・パリティ実装計画](./2026-08-18-vercel-ui-keyword-and-parity-implementation-plan.md) |

## 2. 管理ルール

### 2.1 状態

| 状態 | 定義 |
| --- | --- |
| 未着手 | 差分と修正方針を記録したが、コード変更を開始していない |
| 実装中 | 対象ファイルを変更している |
| 検証待ち | コード変更済みで、自動検証またはHITLが残る |
| 完了 | 受入条件、テスト、設計同期を満たした |
| 対象外 | 意図的差分として維持する |
| 保留 | 意思決定または外部条件待ち |

### 2.2 優先度

| 優先度 | 定義 |
| --- | --- |
| P0 | 誤操作、誤判断、復旧遅延、公開状態の誤認につながる |
| P1 | 主要導線の理解を妨げる、Vercel版より具体性が低い |
| P2 | 表記統一、編集品質、補助説明の改善 |

### 2.3 変更禁止事項

- Vercel版のDOM、CSS、インラインJavaScriptを移植しない。
- Vercel版のメール・パスワード認証、匿名利用、ブラウザAPIキー入力を復活させない。
- Vercel版の固定件数「880件」を使用しない。
- 個人ランキング、点数、成績、人事評価を復活させない。
- API、DB、監査ログの内部値そのものを変更しない。UI表示層で翻訳する。
- Request ID、hash、ジョブIDを削除しない。通常情報から詳細情報へ階層を下げる。

## 3. 修正台帳

| 修正ID | 優先度 | 対応差分 | 修正対象 | 修正内容 | 受入条件 | 状態 |
| --- | --- | --- | --- | --- | --- | --- |
| COR-001 | P1 | DIFF-NAV-001 | SCR-002 | 見出し「AI支援」を、買取業務のAI支援だと一読で分かる名称へ統一する | Page title、document title、画面定義、テストが同じ語彙を使う | 完了 |
| COR-002 | P1 | DIFF-NAV-002 | SCR-003〜005 | 上位ナビゲーションを「訪問前チェック」とし、PDF起点・訪問前準備を一読で認識できるようにする | 初見利用者が説明文なしでもPDF登録へ進める | 完了 |
| COR-003 | P2 | DIFF-NAV-003 | SCR-007〜009 | 上位ナビゲーションに「振り返りチェックシート」を使用し、入力・結果・履歴は工程名で分ける | Vercel利用者が同じ親概念を認識し、各工程へ移動できる | 完了 |
| COR-004 | P1 | DIFF-NAV-004 | Global nav、SCR-010〜013 | 「現場の知識」の下位機能を常設サブナビゲーションで明示する | PCでトーク、フロー、用語、価格、接客マニュアル、法務へ1クリックで到達できる | 完了 |
| COR-005 | P1 | DIFF-NAV-005 | Global nav、SCR-014〜015 | 「研修」の下にAIロールプレイと動画ライブラリを常時表示する | PCで研修の内容を開く前から判断できる | 完了 |
| COR-006 | P2 | DIFF-KW-001〜002 | SCR-010〜011 | `集`の有無を語彙基準で決める | Page title、subnav、検索placeholder、空状態が統一される | 完了 |
| COR-007 | P1 | DIFF-KW-003〜004 | SCR-012 | 上位表示で「用語集」と「金券買取価格表」を明示する | ナビゲーションまたは画面見出しから両機能を認識できる | 完了 |
| COR-008 | P1 | DIFF-KW-005〜006 | SCR-013 | 「接客マニュアル」と「法務・コンプライアンス」を明示する | `接客`と`コンプライアンス`がPage titleまたは常設タブに存在する | 完了 |
| COR-009 | P1 | DIFF-KW-008 | SCR-015、コンテンツ種別 | 「AIロープレ」または「AIロールプレイ」に統一する | UI、aria-label、テスト、設計書に別表記が残らない | 完了 |
| COR-010 | P0 | DIFF-ADM-001〜002 | SCR-016〜017 | 公開状態、利用者状態の表示辞書を実装する | 英語状態値が通常UIに表示されない | 完了 |
| COR-011 | P0 | DIFF-ADM-003〜005 | SCR-018 | ジョブ種別、対象種別、状態を日本語化する | `queued/running/retry_wait/failed/cancelled`が通常セルに露出しない | 完了 |
| COR-012 | P0 | DIFF-ADM-006〜007 | SCR-018 | Request ID、ジョブID、エラーコード、監査内部値を「技術詳細」に格納する | 初期表示は業務名、結果、復旧行動を優先し、詳細は明示操作で開ける | 完了 |
| COR-013 | P0 | DIFF-ADM-008 | SCR-019 | `batch`を「承認対象セット」等の日本語へ置換する | 見出し、ボタン、エラー、空状態に`batch`が残らない | 完了 |
| COR-014 | P0 | DIFF-ADM-009 | SCR-019 | Snapshot/hashを完全性確認の日本語へ翻訳し、生値を詳細表示へ移す | 通常表示は「対象固定済み」「原文一致」、必要時のみ値を確認できる | 完了 |
| COR-015 | P0 | DIFF-ADM-010〜011 | SCR-019 | コンテンツ種別・承認状態の表示辞書を共通化する | type/statusが英語で表示されない | 完了 |
| COR-016 | P1 | 横断 | SCR-003、016〜019 | API由来の状態・種別・理由コードを中央辞書経由で表示する | JSXでraw enumを直接描画する箇所が0件 | 完了 |
| COR-017 | P1 | 横断 | エラー・空状態 | Vercel水準の短い説明と、GCP版の復旧導線を両立する | エラー文に原因の断定を入れず、再読込・再試行・問い合わせ情報を示す | 完了 |
| COR-018 | P1 | 横断 | 件数表示 | 件数はAPI／catalogから取得し、固定表示を禁止する | 1,156、159、107、76、168等が正本データと一致する | 完了 |
| COR-019 | P2 | 横断 | 英数字表記 | `AI`、`PDF`、`Google Drive`、`Request ID`等の許容語彙を決める | 許容語彙以外の英語が通常UIに残らない | 完了 |
| COR-020 | P1 | 横断 | Accessibility | 表示名変更をaria-label、heading、focus、読み上げへ同期する | axe serious/critical 0、heading順序と表示名が一致する | 完了 |
| COR-021 | P1 | 横断 | テスト | UI語彙契約、raw enum非露出、全Route smokeを追加する | lint、typecheck、unit、build、Playwrightが成功する | 完了 |
| COR-022 | P1 | 横断 | 画像証跡 | 20画面×3幅の画像を再生成し、変更前後を比較する | PC 1440pxを主、Tablet 834px、Mobile 390pxを縮退確認として保存する | 完了 |
| COR-023 | P1 | 文書 | SCR、DLV-040/041、Trace | 確定語彙、画面名、受入条件を設計正本へ逆反映する | HTML／Markdown drift 0 | 完了 |
| COR-024 | P1 | 公開 | Cloud Run Web | 初回修正を固定digestでGreenへ配備し、公開トラフィックを切り替える | Green確認後、全20 Route、API health、Error logを公開URLで再検証する | 完了 |
| COR-025 | P1 | 再比較 | Global nav、SCR-011、SCR-019 | 具体語をPCで常設表示し、「困ったときのフロー集」へ統一する。API由来`batch`は表示時に「承認対象セット」へ正規化する | Vercel主要語が1クリックで見え、通常DOMに`承認batch`が表示されない | 完了 |
| COR-026 | P1 | 再公開 | Cloud Run Web | COR-025の検証済みWeb imageをGreenへ配備し、公開版を更新する | no-traffic確認、20 Route、認証、Error log確認後に100%切替する | 完了 |
| COR-027 | P0 | 振り返りAI | Worker／Vertex AI／DB | 文字起こし後の評価基準をPoCへ揃え、Talk最大3件、Compliance 4項目、再訪の高・中・低判定を承認済みversion 2として実装する | 実在segment IDを維持したままPoC全評価項目を返し、長文統合後もTalk上限・Compliance・再訪強度が保持される | ローカル完了・公開待ち |

## 4. 意図的差分の維持台帳

| 維持ID | 対象 | 維持内容 | 理由 | 状態 |
| --- | --- | --- | --- | --- |
| KEEP-001 | SCR-001 | Google認証とmembership必須 | 実顧客情報、録音、AI本文を匿名利用へ公開しない | 対象外 |
| KEEP-002 | SCR-001 | 管理共通パスワードを実装しない | RBACと監査へ統一する | 対象外 |
| KEEP-003 | SCR-002等 | ブラウザAPIキー入力を実装しない | Secret Managerとサーバー権限で管理する | 対象外 |
| KEEP-004 | SCR-010 | Vercel表示880件を使用しない | GCP正本は実データ1,156件 | 対象外 |
| KEEP-005 | SCR-014 | 未取得動画を実データとして表示しない | データ未取得を空状態で明示する | 対象外 |
| KEEP-006 | SCR-015 | 個人点数、順位を表示しない | 育成目的を維持し、人事評価利用を避ける | 対象外 |
| KEEP-007 | SCR-020 | 店舗・チーム集約だけを表示する | 個人ランキングを禁止する | 対象外 |
| KEEP-008 | 横断 | VercelのDOM、CSS、絵文字中心表現をコピーしない | GCP版のPC/Web中心デザインを正本とする | 対象外 |
| KEEP-009 | 横断 | Request IDとhash自体は保持する | 障害調査、監査、完全性確認に必要 | 対象外 |

## 5. 修正仕様

### 5.1 共通語彙辞書

表示文字列を画面ごとに直書きせず、最低限次の辞書へ集約する。

```ts
type UiVocabulary = {
  contentType: Record<ContentType, string>;
  publicationState: Record<PublicationState, string>;
  approvalState: Record<ApprovalState, string>;
  jobType: Record<JobType, string>;
  jobState: Record<JobState, string>;
  entityType: Record<EntityType, string>;
  membershipState: Record<MembershipState, string>;
};
```

辞書に存在しない値は、raw valueをそのまま表示せず、「未定義の状態」と技術詳細を分けて表示する。未知値は監視対象とし、UIで黙って正常扱いしない。

### 5.2 状態表示案

| 内部値 | 通常表示 | 補助説明 |
| --- | --- | --- |
| `queued` | 受付済み | 処理開始を待っています |
| `running` | 処理中 | ページを閉じても処理は続きます |
| `retry_wait` | 再試行待ち | 一時的な問題のため自動で再試行します |
| `succeeded` | 完了 | 結果を確認できます |
| `failed` | 要対応 | 再試行または管理者確認が必要です |
| `cancelled` | 取消済み | 処理は実行されません |
| `draft` | 下書き | 現場には正式公開されていません |
| `published` | 公開中 | 現場で利用できます |
| `in_review` | 確認中 | 承認担当者の判断を待っています |
| `approved` | 承認済み | 公開条件を満たしました |
| `rejected` | 差戻し | 修正して再提出してください |
| `active` | 利用中 | ログインできます |
| `invited` | 招待済み | 初回ログインを待っています |
| `suspended` | 利用停止 | ログインできません |

### 5.3 技術詳細の階層

次の値は削除せず、通常表示から折り畳みの「技術詳細」へ移動する。

- Request ID
- ジョブID
- エラーコード
- Snapshot SHA-256
- 原文hash
- resource type
- action code
- provider operation ID

技術詳細を開く操作はkeyboardで利用でき、コピー後は成功を読み上げる。秘密情報、署名URL、token、本文は表示しない。

## 6. 対象ファイル

| 対象 | 役割 |
| --- | --- |
| `apps/web/src/components/shell/AppShell.tsx` | グローバルナビゲーション |
| `apps/web/src/features/lane-a/screens.ts` | SCR-001〜007の画面名・要約 |
| `apps/web/src/features/lane-b/screens.ts` | SCR-008〜015の画面名・要約 |
| `apps/web/src/features/lane-c/screens.ts` | SCR-016〜020の画面名・要約 |
| `apps/web/src/features/web/Experience.tsx` | 本番UIの見出し、状態、管理画面表示 |
| `apps/web/src/lib/prototype/types.ts` | 表示辞書が参照する型境界 |
| `packages/contracts` | API enumの型正本。表示語は持たせない |
| `apps/web/src/**/__tests__`、`*.test.tsx` | 文言、状態翻訳、非露出検証 |
| `apps/web/e2e` | 全Route、role、axe、画像検証 |

## 7. 検証証拠

各修正は次の証拠へ結び付ける。

| 証拠 | 必須内容 |
| --- | --- |
| Unit | 全enumの表示辞書、未知値fallback、技術詳細開閉 |
| Static scan | 禁止語`batch`、raw state、raw typeが通常UIへ直接出ない |
| Route smoke | SCR-001〜020の全Routeが描画できる |
| Role | assessor、manager、educator、content_approver、system_adminの表示差 |
| Accessibility | axe serious/critical 0、focus、heading、label、live region |
| Visual | 1440／834／390px、20画面、主要状態 |
| Drift | 画面設計Markdownと実装語彙の差分0 |
| Live | 公開Cloud Runで同じ文言とRouteを確認する |

## 8. 現在の集計

| 状態 | 件数 |
| --- | ---: |
| 未着手 | 0 |
| 実装中 | 0 |
| 検証待ち | 0 |
| 完了 | 26 |
| 対象外 | 9 |
| 保留 | 0 |

### 8.1 2026-08-19 実装証跡

- Node.js `22.16.0`でroot lint、typecheck、unit、production buildが成功した。
- Webは17 test files／152 tests、Platformは7 files／21 testsが成功した。
- PostgreSQL結合はmigration 47件、PoC 1,676件import、Database 18、Worker 12、API 44 testsが成功した。
- 画面設計検査は20 screens／20 routes／180 state contracts／error 0、Security scanは250 files／secret 0／non-anonymous email 0だった。
- 最新のoffline Browser-to-DB E2Eは4/4成功し、全20画面、PDF→訪問前準備、音声→文字起こし→6領域AI振り返り、査定員RBAC、axe serious/critical 0、60枚画像を確認した。
- 証跡は `.artifacts/offline-e2e/20260819T011757Z`。deterministic local providerであり、Google Identity／Drive／Vertex AI／Chirp 3のlive受入証跡ではない。
- 初回修正はCloud Build `f4daf935-7416-45cc-860a-18566a1b326a`で成功し、Web revision `hanamaru-pilot-web-00043-yic`へ100%切替済み。公開20 RouteはHTTP 200、Web/APIの切替後ERROR logは0件だった。
- 再比較ではVercel公開物が1,172,142 bytes、SHA-256 `defc22f7a8efb85113ed6cc2442441d4b523b95cff9db97298f6b53cda4c1f3f`のまま変化していないことを再確認した。
- COR-025はローカル実装・検証対象、COR-026は次回Cloud Run公開の独立Gateとして保持する。
- COR-025追加後、Node.js `22.16.0`でWeb 17 files／155 tests、root lint、typecheck、production buildが成功した。画面設計検査は20 screens／20 routes／180 state contracts／error 0、Security scanは250 files／secret 0／non-anonymous email 0だった。
- production bundleには「訪問前チェック」「振り返りチェックシート」「困ったときのフロー集」「承認対象セット」が含まれ、「困ったときの対応フロー」「承認batch」は含まれないことを確認した。
- COR-026はCloud Build `b628ba62-320c-4c4e-9064-8dff9885836d`で成功し、Web digest `sha256:0ba61d07ef753cba9c629f2a924b990d0f1436340422243b2fd8aafd162e3b2e`をrevision `hanamaru-pilot-web-00045-niw`へno-traffic配備後、100%切替した。
- 公開後は20/20 Routeとトップページ連続5回がHTTP 200、API healthはdatabase `ok`／providers `gcp`、Web/APIのERROR logは0件だった。API `00106-qem`、Worker `00048-mol`は変更していない。
- Identity Platformは公開ドメイン登録済み、Google provider有効、同じAPI revisionで`/api/v1/me` 200の直近実績を確認した。rollback先としてWeb `00043-yic`を保持する。
- COR-027はPoC公開HTMLを再取得して文字起こし後プロンプトを照合し、承認済みreview prompt／criteria version 2、Vertex JSON schema、provider出力検証、長文chunk統合へ反映した。Node.js `22.16.0`でmigration 48件、PoC 1,676件import、Database 19、Worker 13、API 44のPostgreSQL結合試験が成功した。Cloud Run公開と実Vertex AI音声E2Eは別Gateであり、この記録時点では未実施。
