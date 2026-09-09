# SCR-021「買取相場（仮）」ローカル・フル実装記録

## 1. 完了境界

本書は、SCR-021をデモHTMLではなく、買取支援ツールのNext.js、API、Worker、PostgreSQLへ接続したローカル実装の正本である。

| 境界 | 判定 |
| --- | --- |
| ローカルfixture | PASS。production build、Web、API、Worker、PostgreSQL、21画面を通し検証済み |
| ローカル外部provider | PASS。匿名1件でVertex AI商品特定とYahoo最新100件の取得・構造解析を実行済み |
| ローカル実接続UI | BLOCKED。コードは実装済みだが、ルート`.env.local`と分離したManager／Assessor受入アカウント設定が未配置 |
| GCP | 未反映 |
| GitHub | push未実施 |
| 本番Feature Flag | 既定OFFを維持 |
| 訪問案件連携 | 対象外 |

## 2. 利用者動線

```text
PC Sidebar／Mobile Bottom Navigation
  → MP-01 商品入力
     ├─ 画像＋AI補助
     ├─ 手入力＋AI補助
     └─ 手入力のみ
  → MP-02 利用者入力とAI提案を確認
  → MP-03 実Job状態を確認
  → MP-04 落札候補・外れ値・採否を確認
  → MP-05 immutableな相場結果を確認

MP-06 履歴
  → 未完了検索を再開
  → 確定結果を再表示
  → 同条件または編集後の条件で再検索
```

- PC Sidebarは`買取支援AI → 訪問前チェック → 買取相場 → 振り返りチェックシート → 現場の知識 → 研修`とする。
- Smartphoneは`ホーム／訪問／買取相場／振り返り／その他`とする。
- `market_price_search`がOFF、または`market_price:read`がない場合、通常Navigationへ表示しない。APIも404／403相当で拒否する。
- URLには`view`とUUIDだけを持たせ、商品名、検索語、価格、画像URL、Yahoo URLを含めない。
- 画像previewと未保存draftはReact stateだけに保持し、localStorageへ保存しない。

## 3. MP-01〜MP-06実装対応

| Page | Next.js実装 | API正本 | 主な状態・操作 |
| --- | --- | --- | --- |
| MP-01 | `MarketPriceExperience / InputView` | Identification／Image Upload | 3経路、最大5画像、状態複数選択、除外語 |
| MP-02 | `IdentificationView` | Identification GET/PATCH/confirm | AI候補の採用・編集・却下、検索語1件確定 |
| MP-03 | `ProgressView` | Search／Job | queued、planning、fetching、normalizing、partial、blocked、failed、cancelled |
| MP-04 | `CandidatesView` | Candidate override／Outlier policy | PC 3ペイン、Mobile段階表示、手動除外・復帰、即時preview |
| MP-05 | `ResultView` | immutable Market Price Result | 最低、除外前中央値、中央値、最高、件数、期間、完全性、除外内訳 |
| MP-06 | `HistoryView` | Search list／repeat | 保存結果、未完了再開、同条件再検索 |

検索中の画面表示は、可視中2秒、バックグラウンド中10秒のpollingとし、終端状態で停止する。件数から算出した偽の進捗率は表示しない。

## 4. 公開API

### 4.1 商品特定・画像

| Method | Path | 責任 |
| --- | --- | --- |
| POST | `/api/v1/market-price/identifications` | 入力modeと利用者入力からdraftを作成 |
| GET | `/api/v1/market-price/identifications/:id` | scope内の入力、提案、状態だけを返す |
| POST | `/api/v1/market-price/identifications/:id/image-uploads` | MIME、1枚10MB、最大5枚、合計50MBを検証 |
| PUT | 返却されたlocal upload URL | fixture／local専用のbinary upload |
| POST | `/api/v1/market-price/image-uploads/:uploadId/complete` | magic bytes、size、SHA-256、重複を検証 |
| POST | `/api/v1/market-price/identifications/:id/analyze` | 商品特定Jobを作成 |
| PATCH | `/api/v1/market-price/identifications/:id` | lock version付きで入力と提案判断を保存 |
| POST | `/api/v1/market-price/identifications/:id/confirm` | 検索語1件、状態、未確認項目を検証して確定 |

画像はWorkerでEXIF orientationを反映し、最大辺2048px、WebP quality 90へ正規化する。private storageに保存し、24時間の削除期限を持つ。元画像、生AI応答、署名URLをDB、監査、通常logへ複製しない。

### 4.2 相場検索

| Method | Path | 責任 |
| --- | --- | --- |
| GET | `/api/v1/market-price/options` | 状態、検証済みカテゴリ・ブランド、画像上限 |
| GET/POST | `/api/v1/market-price/searches` | 履歴取得／検索作成 |
| GET | `/api/v1/market-price/searches/:id` | 状態、候補、統計、coverageを取得 |
| PATCH | `/api/v1/market-price/searches/:id/candidates/:candidateId` | include／exclude／automaticと再集計 |
| PATCH | `/api/v1/market-price/searches/:id/outlier-policy` | 手動判断を保持して外れ値を再評価 |
| POST | `/api/v1/market-price/searches/:id/confirm` | 1件以上を検証してimmutable snapshotを確定 |
| POST | `/api/v1/market-price/searches/:id/retry` | 再試行可能な失敗をcheckpointから再開 |
| POST | `/api/v1/market-price/searches/:id/cancel` | queued取消または実行中の取消要求 |
| POST | `/api/v1/market-price/searches/:id/repeat` | cacheを使わず同条件の新規検索を作成 |

すべての書込みはidempotency keyを要求する。Identification PATCHとResult confirmはoptimistic lockを使用する。`assessor`と`manager`は案件scope内で利用でき、`system_admin`は商品名、画像、候補、価格へアクセスできない。

## 5. Worker・外部接続

### 5.1 商品特定Job

1. Feature Flag、Identification状態、画像完了を検証する。
2. private storageから画像を上限付きで読む。
3. 正規化画像を保存し、元画像を削除する。
4. `AiProvider.identifyMarketProduct`へ利用者入力と画像だけを渡す。
5. 最大3商品候補、検索語、除外語、状態候補をschema検証する。
6. 提案を`pending`で保存し、利用者の採用操作を待つ。

### 5.2 相場検索Job

1. 確定済み検索語1件と利用者確定状態を読む。
2. 検証済みRegistry候補だけをAIパラメータ補助へ渡す。
3. 決定的URL Generatorで`select=6 / n=100 / b=1,101,201...`を生成する。
4. URLをParserでsemantic specへ戻し、round trip一致後だけ取得する。
5. 各成功ページをcheckpointとして保存する。
6. 直近90日境界、最終ページ、0件、最大20ページのいずれかで停止する。
7. 同一商品、状態、除外語、期間、価格外れ値の順で判定する。
8. coverageと統計を保存し、候補確認状態へ移す。

CAPTCHA、継続403／429、Parser drift、並び順異常、同一ページ反復、kill switchはfail-closedで停止する。回避用proxy、cookie偽装、fingerprint変更は実装しない。

## 6. PostgreSQL

| Table | 保存内容 |
| --- | --- |
| `market_price_identifications` | 入力mode、入力、提案、確認者、lock version、期限 |
| `market_price_image_upload_sessions` | upload session、digest、完了状態、有効期限 |
| `market_price_images` | private object参照、正規化状態、寸法、24時間削除期限 |
| `market_price_searches` | query、90日窓、Job、coverage、統計、version |
| `market_price_search_pages` | page、offset、URL hash、response hash、件数、終了日時、checkpoint |
| `market_price_candidates` | 正規化候補、価格、終了日時、判定理由、手動判断 |
| `market_price_results` | 確定時の条件、統計、coverage、採用候補ID集合のimmutable snapshot |
| `market_price_source_mappings` | 検証済みYahooカテゴリ／ブランドID Registry |

全テーブルへorganization RLSを強制し、API／Worker DB roleへ必要な操作だけをgrantする。`market_price_results`はUPDATE／DELETE triggerで拒否する。

既存migrationはチェックサム互換を維持する。商品提案DTOの空配列default補正は適用済み`0053`／`0054`を書き換えず、追補migration`0055_market_price_suggestion_contract.sql`で行う。

## 7. 統計契約

- 外れ値は商品状態ごとに計算する。
- 同一状態が5件以上、状態別中央値から設定閾値超、かつTukey IQR範囲外のすべてを満たす場合だけ自動除外する。
- 初期閾値は20%。利用者は5〜100%で再適用できる。
- 手動include／excludeは再計算後も優先して保持する。
- UIは候補判断と閾値変更を同じ規則で即時previewし、API応答で最終補正する。
- 確定結果には最低価格、外れ値除外前中央値、中央値、最高価格、候補数、採用数、除外内訳、period、coverageを保存する。
- `partial`を直近90日の完全な相場とは表示しない。

## 8. ローカル実行

```bash
pnpm local:up:fixture
pnpm local:down

pnpm local:up
pnpm local:down
```

- `local:up:fixture`はproduction build、ローカルPostgreSQL、dev auth、匿名AI／Yahoo fixtureで動く。
- `local:up`はproduction build、Google認証、Vertex AI、Yahoo公開画面を使用する。
- どちらもWeb、API、Worker、PostgreSQLを`127.0.0.1`だけで待受する。
- ローカルdevelopment organizationだけ`market_price_search`をONにする。本番bootstrapの既定OFFは変更しない。

## 9. Traceと受入

| 要件 | 実装証跡 | 検証 |
| --- | --- | --- |
| 3入力経路 | `MarketPriceExperience` | Component／Playwright |
| AI提案の明示採否 | Identification suggestion decision | Component／DB integration |
| 画像制約・24時間削除 | Upload API、Worker normalization、retention scan | API／DB／Worker |
| Yahoo決定的URL | `@hanamaru/market-price` | Unit round trip |
| 100件・最新順・90日 | Worker／Page checkpoint | Unit／DB integration |
| 手動除外・復帰 | Candidate override API | UI／DB integration／Playwright |
| 外れ値再適用 | Outlier policy API | Unit／DB integration／Playwright |
| immutable確定結果 | `market_price_results` | DB trigger／API integration |
| retry／cancel／repeat | Search operation API | API／Worker／Playwright |
| RBAC／RLS | capability、scope、forced RLS | API／DB role／Playwright |
| 21画面・responsive | route manifest、offline E2E | Chromium／WebKit／axe／63+14 images |

最終報告では、`ローカルfixture`、`ローカル実接続`、`GCP`を別々にPASS／FAIL／BLOCKED／NOT TESTEDで記録する。外部資格情報、Yahoo側停止、契約未確認などで実接続できない場合、fixture合格から実接続PASSを推定しない。

## 10. 2026-09-09 検証結果

- fixture E2E：19 PASS、1 SKIP。SKIPはWebKitでChromiumと同じ77画像を重複生成しないための意図的制御である。
- 21画面、Chromium／WebKit、axe serious／critical 0、320／360／390／430／768／834／1024／1440pxの横幅検査を完了した。
- 画像証跡：21画面×390／834／1440pxの63枚と中核7画面×360／430pxの14枚、合計77枚。
- SCR-021は画像＋AI補助、手入力＋AI補助、手入力のみの3経路を、候補確認・確定・履歴までAPI／Worker／PostgreSQL経由で完走した。
- 外部provider smoke：Vertex AI `gemini-2.5-flash`の商品候補1件・検索語3件、Yahoo HTTP 200・最新順100件・Parser v1.0.0一致を確認した。
- Googleログインを含む`pnpm local:up`の受入E2Eは、追跡対象外の`.env.local`と分離した2受入アカウントが未配置のためBLOCKEDである。未実行をPASSとは扱わない。
- GCPデプロイ、GitHub push、本番Feature Flag変更は実施していない。
