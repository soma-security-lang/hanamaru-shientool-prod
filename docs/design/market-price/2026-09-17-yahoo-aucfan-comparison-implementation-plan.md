# 買取相場: ヤフオク維持・オークファン比較導入 実装・構築計画

- 作成日: 2026-09-17
- 対象: SCR-021 `/market-price`、既存Web/API/Worker/PostgreSQL/GCP構成
- 状態: ローカルfixture版を実装済み。実オークファンAPI接続・本番反映は未実施
- 照合したローカルソース: `9f9c84f1cc6a38af5e7e6850e6787cbdfdbdf978`
- 今回の実施範囲: ローカルの取得元切替・独立集計・比較表示・API/Worker/DB/回帰テスト。デプロイは対象外
- 公開環境のRevision、契約成立、資格情報、実API疎通は今回未確認。過去のE2E結果を本計画の合格実績に流用しない
- 取扱い: ローカル検討用。受領した営業資料の料金を含むため、公開リポジトリ等への共有前に公開可否を確認する

## 0. 2026-09-17 ローカル実装結果

現行Yahooを既定値のまま維持し、`Yahoo / オークファン / 両方を比較`をMP-02から選択できるローカル実装を追加した。比較時は同一の確認済み商品・検索語・状態・外れ値基準から2件の独立検索を作り、候補・統計・確定結果を混在させない。

実装済み:

- `source_provider = yahoo_scrape | aucfan_api`を検索、候補、確定snapshotへ保存。
- Aucfanの`new`と`3`を独立checkpointとして取得し、100件単位でJSONを解析。
- Aucfanの終了日は`ended_on`と`precision=date`で保持し、架空の時刻をDBへ保存しない。
- Aucfanの`used`をYahooの細かな中古状態へ偽変換せず、取得元制約を検索・結果へ保持。
- 比較画面で取得元別の状態、件数、中央値を表示し、候補・確定結果を相互切替。
- 片側の開始・読込失敗時も、取得できた片側を確認可能。単独検索の無断fallbackはしない。
- ローカル組織だけで`market_price_aucfan`と`market_price_comparison`を有効化。production bootstrapは既定OFF。
- Fresh PostgreSQLへ0056まで適用し、DB/API/Worker統合テストと全workspace回帰を完走。

検証結果:

| 検査 | 結果 |
| --- | --- |
| TypeScript strict | PASS |
| ESLint | PASS |
| Unit / component | PASS: market-price 15、platform 45、Web 184ほか |
| Fresh DB / migration / integration | PASS: DB 21、Worker 22、API 53 |
| Next production build | PASS |

ローカルfixtureではAucfan応答を匿名JSONで再現する。実オークファンAPIのtoken発行・実疎通は、契約、資格情報、再表示条件が未確認のためfail-closedのまま残す。比較の保存は現段階では2つの独立検索IDを画面URLで対にしており、本書後半に記載する比較親レコード、費用集計、共通出品照合は次の本番化工程で実装する。

## 1. 結論と完成像

**ヤフオクを現行の標準機能として維持し、オークファンを比較可能な第2の取得元として追加する。置換・統合・自動切替は行わない。**

ユーザーが確認済みの商品情報・検索語・状態を一度入力すれば、取得元ごとに価格、件数、取得範囲、条件一致度、所要時間、費用を比較できる状態を作る。比較後もヤフオク単独の利用を継続できる。

今回比較するのは原則として「同じYahoo!オークションの落札実績を、どの経路から取得するか」である。ヤフオクとオークファンを、互いに独立した2つの市場として合算しない。

### 1.1 維持するもの

- 既存Yahooスクレイピング、決定的URL生成、最新順100件、直近90日、最大20ページの取得方針。
- 画像+AI補助、手入力+AI補助、手入力のみの3入力経路。
- 商品状態の複数選択、確認済み検索語1本、除外語、候補の手動除外・復帰。
- 状態別5件以上を前提とする、中央値から20%超かつIQR範囲外の外れ値判定。
- MP-01〜06、既存URL、保存済み検索・確定結果、履歴、権限境界。
- Google認証、既存21画面、PCとスマートフォンの業務動線。
- AIは商品・条件の補助だけを担当し、取得価格を生成しない。

### 1.2 追加するもの

- オークファン検索API v2の取得Adapter、認証更新、ページ再開、利用量管理。
- 取得元を指定した独立検索と、共通条件を固定した2取得元比較。
- 取得元別の候補・統計・取得制約・価格差の表示。
- API提供範囲の制約を隠さない比較判定と、評価レポート。
- オークファンだけを止められるFeature Flag・kill switch。

### 1.3 今回の計画に含めないもの

- ヤフオクの廃止、オークファンの標準化、失敗時の無断自動切替。
- 両取得元を混ぜた単一の中央値、正式買取価格の自動決定、訪問案件への反映。
- MCPサーバーの本番組込み、第三の相場取得元、10年相場への期間拡張。
- 契約申込み、プラン購入、実サービスへの変更、GitHub push、デプロイの実行。

## 2. 調査根拠と現行実装との差分

### 2.1 読み取った資料

| ID | 資料 | 本計画で使用した範囲 |
| --- | --- | --- |
| S1 | [オークファン検索API仕様書](/Users/riri/Downloads/【株式会社オークファン】オークファン検索API仕様書.pdf) | p.2 token、p.3期間、p.5〜6検索v2、p.7〜8詳細API |
| S2 | [オークファンAPIご提案資料](/Users/riri/Downloads/【株式会社オークファン】オークファンAPIご提案資料.pdf) | API/MCPの用途区分、p.6自社利用、p.7外部提供の料金 |
| S3 | [オークファンMCPサーバーご契約ガイド](/Users/riri/Downloads/【株式会社オークファン】オークファンMCPサーバーご契約ガイド_9月ご案内用.pdf) | p.3〜6の契約、料金、超過、キャンペーン |

受領ファイルのSHA-256:

```text
S1 cb2830e3323ed47cd4f775d68b7566f1d245f6e2d0b81b711c5ac52326af41af
S2 8a67630602a2d505cfb7a3ad9534ba54b83eded6a9eafda64e4ec60b75879d79
S3 5de889a34728b652c4615b0a658ec81b92cec7af2768f9dbf543fa1d14a691cf
```

PDFの表を文字抽出とレンダリングで確認した。資料に記載のない権利、SLA、タイムゾーン、取得漏れの扱いを推測で確定しない。受領経路・送信者について、この工程でLINE原文との再照合は行っていない。

### 2.2 比較を左右する仕様差

| 論点 | 現行Yahoo | オークファン受領API仕様 | 設計上の対応 |
| --- | --- | --- | --- |
| 取得方式 | 公開HTML取得・解析 | 契約APIのJSON | Adapterを分離 |
| 期間 | 検索開始から固定90日 | `new`は直近30日、`3`は前月までの暦月3か月 | `new`と`3`を分けて取得・重複排除。90日との差を判定 |
| 1ページ | 100件 | v2は30/50/100/200件 | 最初の比較は100件に固定 |
| 提供上限 | アプリ側20ページ・2,000件 | `new`は資料上件数上限なし、過去期間は月100件 | API側上限とアプリ側上限を別表示 |
| 並び順 | `select=6` | `sort=date_desc` | 各取得元の契約で検証 |
| 状態 | 未使用〜全体的に状態が悪い等 | `new / used` | 中古を「目立った傷や汚れなし」等へ勝手に変換しない |
| 終了時刻 | 正規化済み`endedAt` | 検索は`YYYYMMDD`の日付のみ、詳細にはISO日時 | 日付精度と時刻精度を分離 |
| カテゴリ/ブランド | 検証済みIDレジストリ | `cid`あり、ブランドID項目は仕様表にない | ID共通とは仮定せず、取得元別マッピング |
| 除外語 | 取得後に除外 | `exsearch`も指定可能 | 基準比較では両方とも取得後の同一処理 |
| 税・送料 | 税表示と不明値を保持 | 税フィルタはあるが検索応答に税込区分の記載なし | 不明を維持、税込・送料込へ推測換算しない |
| 課金 | GCP/AI/運用コスト | 契約固定費、ページ単位API利用、超過 | 件数だけでなく実リクエストを計測 |

**「APIで全ページを取り終えた」と「直近90日の全落札実績を取得できた」は別である。月100件の制約を、ページングやAIで解消できるとは扱わない。**

### 2.3 現行コードで変更が必要な接点

| 現行ファイル | 確認した状態 | 対応 |
| --- | --- | --- |
| `packages/platform/src/types.ts` | `MarketPriceSourceProvider.fetchPage(url)`と単一provider | 取得元別の型・capabilitiesを追加 |
| `packages/platform/src/gcp.ts` | Yahoo専用取得provider | Yahooを保持しAucfan clientを追加 |
| `packages/market-price/src/index.ts` | Yahoo URL/HTML解析と候補判定型 | Yahoo固有処理を保持し、共通比較モデルを追加 |
| `apps/worker/src/processor.ts` | `marketPriceSearch`内でYahoo URL生成とHTML解析 | 取得元分岐と独立ジョブ、比較集約を追加 |
| `apps/api/src/service.ts` | 検索作成・キャッシュ・候補返却にprovider区別なし | 後方互換のprovider指定と比較API |
| `packages/database/migrations/0053_market_price_search.sql`以降 | ページoffset、日時NOT NULL、Yahoo状態などを前提 | 日付精度・別ページ体系を表現できる加算migration |
| `apps/web/src/features/market-price/MarketPriceExperience.tsx` | 商品確認→単一検索→結果・履歴 | 既存導線に取得元選択・比較結果だけを追加 |

既存候補の`source_type = auction / fleamarket`は販売方式であり、取得元ではない。`aucfan`をここに追加せず、別の`source_provider`を設ける。

## 3. 接続方式の方針: REST APIを第一候補にする

本プロダクトへの組込みは、資料でリクエスト・応答・ページングを確認できるREST API v2を第一候補とする。既存Workerから制御でき、取得元比較、再試行、利用量計測を明示的に実装しやすい。

MCPは代替案として残すが、API契約と同一扱いにしない。MCPを採用するには、tools一覧、認証、応答スキーマ、件数・期間制限、コール計数、システム組込み・再表示許諾を別途確認する。ChatGPTで相場を質問できることを、そのままSCR-021に組み込める証拠にはしない。

2026-09-14の公式発表には、MCP Startプランの9月限定キャンペーンがある。これはREST APIの初期費用・月額免除を意味しない。受領ガイドの特典とも表現が異なるため、適用・併用条件は契約前に確認する。[オークファン公式発表](https://aucfan.co.jp/press/release/2026/7827/)

契約確定前でも匿名fixtureでAdapter・比較UI・DB・テストの構築を進められる。実接続だけを資格情報・利用許諾の確認に依存させる。

## 4. ユーザー動線・画面変更

### 4.1 取得元の選択

既存MP-02の条件確認の末尾に「取得元」を追加する。初期値は必ず「ヤフオク」。利用可能な組織だけに「オークファン」「両方を比較」を表示する。

- **ヤフオク**: 現行どおり。Aucfanに外部通信・課金は発生しない。
- **オークファン**: APIだけで取得。提供上限・状態の粗さを事前説明する。
- **両方を比較**: 同じ確認済み条件を固定し、2つの独立検索を開始する。オークファンのAPI利用を伴うことを明示する。

比較選択時に初めて、条件差の説明を表示する。すべての利用者に高度なAPIパラメータを入力させない。AI提案、画像入力、状態選択の既存操作は変えない。

### 4.2 MP-01〜06の仕様

| 画面 | 維持する操作 | 追加する表示・操作 |
| --- | --- | --- |
| MP-01 商品入力 | 3入力方法、画像、商品情報、状態 | 原則変更なし |
| MP-02 確認 | AI提案の採否、検索語1件、除外語 | 取得元、比較条件の制約、取得開始 |
| MP-03 取得中 | 実状態、取消、再試行 | 取得元別状態・件数・経過時間。片側だけ再試行可能 |
| MP-04 候補確認 | 手動除外・復帰、外れ値基準 | 取得元タブ、共通/片側のみの商品、日付・状態不明の理由 |
| MP-05 結果 | 最低・中央値・最高・採用件数 | 取得元別結果、比較可能範囲、価格差・件数差・費用 |
| MP-06 履歴 | 再読込、条件再検索 | 取得元・比較種別、比較レコードの復元、片側結果への遷移 |

PCは2つの結果を横並びにし、下に同一出品IDの差分表を置く。スマホは取得元をタブで切り替え、同じ項目順の要約を縦並びで比較できるようにする。既存の下部ナビ・Sticky Action・16px本文・44px操作領域を維持する。

差分表示例:

```text
ヤフオク               オークファン
中央値 ¥...            中央値 ¥...
採用 ...件             採用 ...件
取得した範囲での参考値   過去分は月100件の提供上限あり

同一条件で比較: 一部可能
理由: オークファンの中古商品の詳細状態を確認できない
共通出品 ...件 / Yahooのみ ...件 / Aucfanのみ ...件
```

数値は取得・計算できたときだけ出す。不明値を0円・0件へ置き換えない。取得完了0件は正常な空結果、取得失敗は価格未確認として区別する。

### 4.3 URL・保存・確定

- 既存`/market-price?view=...&searchId=...`は変更しない。
- 比較は`/market-price?view=progress&comparisonId=...`等の加算形式。許可するviewは既存のprogress/candidates/result/historyとする。
- `comparisonId`と`searchId`を同時指定した場合は曖昧に解釈せず、検証エラーから履歴へ復旧できるようにする。
- 商品名、検索語、token、価格、APIの完全URLはブラウザURLへ入れない。
- 比較結果から片側へ移動し、戻ると比較状態を復元する。選択タブ以外の業務データはAPIを正本とする。
- 片側の候補変更は片側だけに適用。共通出品でも無断で両方を除外しない。
- 同一の外れ値基準を両側へ適用する操作は明示的に行う。両側のlock versionを検証し、条件差分を記録する。
- 相場確定は取得元別snapshotとして保存する。比較保存は2つのsnapshotと比較条件・制約・評価を参照し、合成価格は作らない。
- 一方だけ成功した場合もその結果を確認・保存できるが、「比較完了」とは表示しない。

## 5. 公正な比較のためのデータ契約

### 5.1 比較条件を開始時点で固定

比較親レコードを作成する時刻を`T`とし、両子検索に同じ`periodEnd=T`、`periodStart=T-90*24h`を渡す。ジョブ開始順・再試行時刻によって期間をずらさない。

次を共通snapshotに保存する。

- 確認済み商品属性、検索語、除外語、状態集合、外れ値policy。
- 要求期間、比較モード、商品一致判定version、統計version。
- 取得元別に実際に適用できた条件、省略した条件と理由。

精度評価は2種類に分ける。

1. **共通条件比較**: 同じ語・期間・可能な共通条件。除外語は両側の取得後に同じ処理で適用。カテゴリ・ブランド等の片側だけの最適化は無効にする。
2. **業務利用比較**: Yahooの既存レジストリ等を維持し、各取得元で有効な条件を使用。最適化後の使いやすさを比較するが、1とは成績を混ぜない。

Yahoo単独検索の既存条件を、比較の都合で弱めない。AIに取得元ごとの別商品・別検索語を生成させて勝敗を比べない。

### 5.2 Aucfanの期間計画

暫定設計は`period=new`と`period=3`を個別に取得し、対象90日へ絞り込む。`period=3`だけでは当月分を取得できないため使用しない。

ただし`new/3`の期間説明はS1の共通期間説明に基づく。v2でも同義か、日界・タイムゾーン・更新遅延を実接続前に確認する。

- 検索順: `new`、続いて`3`。それぞれ`sort=date_desc / disp_num=100 / page=1...`。
- 1取得元あたり成功ページ合計20、取得レコード合計2,000を初期上限とする。`3`のため最大3ページ分の予算を予約し、`new`だけで全枠を消費させない。
- 同じ出品が両期間に含まれる場合は、`sitecode + auction_id`でAucfan内の重複を除く。出現した期間・ページの来歴は残す。
- 同一IDの価格等が衝突した場合は記録し、比較から隔離する。後勝ちで値を上書きして差分を消さない。
- 各期間を独立したcursor/checkpointとして保持する。片側の期間だけ再取得しないようにする。
- 再試行が日界・月界をまたぎ、相対期間の意味が変化した場合、同じsnapshotを再現できたとは扱わない。取得時点差を記録し、厳密比較は再実行対象とする。
- 31日月の境界などで`new`と前月範囲の間に未確認の時間帯が残る可能性も試験する。期間ラベルだけで90日coverageを保証しない。

### 5.3 日付のみを正確な時刻に偽装しない

Aucfan検索応答の`time=YYYYMMDD`は、確認した提供タイムゾーンの1日区間として扱う。UTC/JSTの午前0時を便宜的に`endedAt`へ格納し、正確な終了時刻と称することは禁止する。

- `endedDate`、`endedAt|null`、`timePrecision=date|timestamp`、`sourceTimezone`を区別する。
- 日付の全時間区間が90日窓内にあるものは期間内と確定できる。
- 開始日・当日など境界と交差するものは`period_boundary_unresolved`。
- 必要な境界候補だけ、上限付きの詳細APIで`endDate`を確認できる。初期上限は1検索5件、別途コール予算に含める。
- 詳細なし・上限到達・404の場合は不明のまま残し、厳密比較から外す。取得元別参考値に含める場合も日付単位であることを明示する。

### 5.4 商品状態・価格の比較可能性

Aucfanの`used`は中古全体を意味し、Yahooの中古5段階のいずれかを意味するとは限らない。

- 原文区分、粗い区分`new/used/unknown`、詳細区分`ProductCondition|null`を別に保持する。
- 「未使用に近い」「目立った傷や汚れなし」だけ選択した検索に、詳細状態不明の中古を自動採用しない。
- 詳細APIも資料上は新品/中古/空欄であり、呼べば6段階が判明するとは約束しない。
- 中古全体として比較する場合は利用者が明示的に選び、両側を同じ粗い区分へ揃えた別の参考集計とする。
- 状態不明は正常な結果状態。確認なしにAIで推測確定しない。
- 価格は正のJPY落札実績を対象とする。開催中の現在価格、0円、不正数値、通貨不明は除外/要確認。
- 詳細APIの`price`は開催中価格にもなり得る。終了状態・価格意味を検証しないまま落札価格として使用しない。
- 税・送料・まとめ売り数量が不明な場合は不明を維持し、単品税込送料込へ換算しない。
- タイトル・カテゴリ・型番・数量等からの同一商品判定と、その根拠versionを保存する。

### 5.5 coverageを分ける

```ts
interface SourceCoverage {
  retrieval: "pending" | "complete" | "partial" | "blocked";
  windowCoverage: "verified" | "partial" | "unknown";
  limitations: Array<
    "monthly_cap" | "local_page_cap" | "date_precision" |
    "condition_precision" | "provider_lag" | "parse_failure" |
    "source_period_gap" | "budget_cap"
  >;
  comparisonEligibility: "comparable" | "partially_comparable" | "not_comparable";
}
```

ここで`retrieval=complete`は「APIが提供したページを取得完了」の意味だけとする。既存UI互換の`coverage_status`は制約ありなら保守的に`partial`へ写像する。取得件数が300未満というだけでは、月100件制約に抵触しなかった証明にしない。

### 5.6 3層の結果を区別

1. **取得元別参考相場**: 各取得元で採用できた候補から計算。最低・中央値・最高、外れ値除外前後、採用件数、制約を表示。
2. **条件を揃えた比較**: 期間・状態・商品・税等の確認水準を揃えられた範囲だけで比較。不明は除外し、除外率も表示。
3. **共通出品IDの整合検査**: 同じ取引の価格・日付の差を点検。これは相場精度の優劣ではなく転記・更新・仕様差の検査。

同じ取引が両側にある場合、片方にもう片方の値を補って「一致」にしない。両中央値の平均も作らない。0件・少数・条件不一致では優劣判定を出さない。

## 6. バックエンド構成

```text
確認済み商品・検索条件
  ├─ Yahoo単独検索 ─ Yahoo既存Adapter ─ 独立候補・統計・結果
  ├─ Aucfan単独検索 ─ API v2 Adapter ─ 独立候補・統計・結果
  └─ 比較親レコード
       ├─ Yahoo子検索 ─ 既存取得処理
       └─ Aucfan子検索 ─ new/3別ページ取得
                ↓
       共通ID照合・条件差・coverage・費用比較
```

### 6.1 Domain / Provider

`packages/market-price`に取得元非依存の検索意図・比較計算を追加し、YahooのGenerator/Parserは挙動を固定したまま利用する。Adapterは副作用、Domainは純粋関数に分離する。

```ts
type MarketPriceSource = "yahoo_scrape" | "aucfan_api";
type MarketPriceSearchMode = "yahoo" | "aucfan" | "compare";

interface MarketSourceCapabilities {
  source: MarketPriceSource;
  supportsDetailedCondition: boolean;
  datePrecision: "date" | "timestamp" | "mixed";
  supportsHistoricalPaging: boolean;
  hasMonthlyResultCap: boolean;
}

interface NormalizedSourceItem {
  sourceProvider: MarketPriceSource;
  marketplace: "yahoo";
  marketplaceItemId: string;
  title: string;
  closingPrice: number;
  currency: "JPY";
  endedAt: string | null;
  endedDate: string;
  timePrecision: "date" | "timestamp";
  conditionBroad: "new" | "used" | "unknown";
  conditionDetail: ProductCondition | null;
  taxDisplay: "included" | "not_included" | "unknown";
  evidenceUrl: string | null;
  fetchedAt: string;
}
```

DTOは日時欠損と条件不明を表現できる加算型とする。Yahoo DTOの既存必須項目を黙ってnullableに変えるのではなく、provider判別unionと旧Yahoo契約の回帰試験を用意する。

### 6.2 Aucfan Adapter

- token発行: `POST https://api.aucfan.com/search/v1/token/issue`。
- 検索: `GET https://api.aucfan.com/search/v2/item/list`。
- 詳細補完: `GET https://api.aucfan.com/search/v1/aucview/yahoo`。通常は呼ばず、境界確認等に限定。
- host/pathを固定し、利用者・AIによる任意URL/任意パラメータを受け付けない。
- 初期許可項目は`search/sort/period/page/disp_num/cid/item_status`と認証項目。価格帯、出品者、配送等は比較に導入しない。
- `cid`はAucfanで検証済みのものだけ。Yahoo category IDを無検証に流用しない。ブランドは確認済み検索語から逸脱させず、架空のbrandパラメータを作らない。
- AIは検証済み候補キーの選択のみ。token・passwordをAI入力へ渡さない。
- OR記法等の検索演算子は構造化して扱う。自由入力の括弧が無断でOR検索へ変わらないようliteral/演算子契約を検証する。
- HTTP 200でもエラーオブジェクトなら失敗。日付・価格・sitecode・ID・件数・ページ数をschema検証する。
- S1の応答例にはJSON文法として不完全な箇所がある。例をそのままfixture正本にせず、仕様表と実応答で契約を確定する。
- サイトコードがYahoo以外なら混ぜない。商品URLは許可hostのHTTPSだけを表示し、サーバーで任意fetchしない。
- 商品説明HTMLは標準取得・保存対象外。将来表示する場合もsanitizeを必須にする。画像転載・プロキシ保存は許諾確定まで対象外。

### 6.3 認証・課金・再試行

APIの`token/stoken`はqueryに入る仕様のため、Webには渡さずWorkerだけで組み立てる。HTTP例外、APM、trace、reverse proxy、監査にも完全URLを残さない。hashは認証項目を除いたsemantic requestに対して計算する。

- `app_id/password`はSecret Managerに格納し、専用Workerの最小権限で参照。
- 日次tokenは期限と暗号化値を専用の非公開ストアへ保存。組織向けAPIから参照不能にし、期限後削除する。
- 同じ契約の複数Workerでは排他更新し、発行競合を防ぐ。外部通信中に長時間DB transactionを開かない。
- 資料の有効期限は「当日の24時」。発行から24時間とは解釈しない。`limit`のタイムゾーンを契約試験で確定する。
- 明確なtoken期限エラーだけ1回更新して再試行。通常の400/403を更新ループへ入れない。
- 429は`Retry-After`、一時5xx/timeoutはbackoffを使い、同一リクエストは初回+最大2回まで。外部消費が不明なtimeoutも利用量台帳へ記録する。
- 契約クォータ、拒否、schema drift、予算上限ではAucfanのみ停止。Yahooへの自動再実行はしない。
- CAPTCHA/アクセス拒否を回避するproxy・Cookie偽装・fingerprint変更は追加しない。

## 7. API・Worker・DB変更詳細

### 7.1 API

| API | 変更 |
| --- | --- |
| `POST /api/v1/market-price/searches` | `sourceProvider?`を加算。省略時は必ずYahoo。既存requestを受理 |
| `GET /api/v1/market-price/searches/:id` | 取得元、適用条件、coverage詳細、取得時点、利用量を加算 |
| `GET /api/v1/market-price/searches` | 取得元filter、比較への関連。既存履歴の表示を維持 |
| `GET /api/v1/market-price/options` | 利用可能mode、取得元capabilities、制約。秘密・契約passwordは返さない |
| `POST /api/v1/market-price/comparisons` | 共通条件snapshotと2子検索をtransaction+outboxで作成 |
| `GET /api/v1/market-price/comparisons/:id` | 両側状態、対応商品、比較指標、制約を返す |
| `POST /api/v1/market-price/comparisons/:id/retry` | 指定側だけ再試行。成功側の再課金・再取得は禁止 |
| `POST /api/v1/market-price/comparisons/:id/cancel` | 未完了の指定側/両側を取消。保存済み候補は削除しない |
| `PATCH /api/v1/market-price/comparisons/:id/outlier-policy` | 両側lock検査で基準を揃え、候補の手動判断を保持 |
| `POST /api/v1/market-price/comparisons/:id/confirm` | 取得元別結果と比較snapshotを保存。未完片側は明示 |

mutationは既存どおりIdempotency-Key、scope、監査、必要箇所のexpectedLockVersionを必須にする。画像や商品情報は共有するが、候補集合・利用量・failureは取得元ごとに分ける。

### 7.2 ジョブ

- 既存Yahooの`market_price_search`処理は残す。新規Aucfan job種別を加算し、旧Workerが未知jobを取得しないdispatch/version境界を設ける。
- 比較専用の長時間待機Workerは作らない。子の状態変更時に親の集約状態を冪等更新し、定期reconcileで取りこぼしを回復する。
- 親状態は`running / ready / partial / blocked / failed / cancelled`。両側が正常な空結果なら取得はready、比較評価はnot_comparableになり得る。
- 子の片側失敗で他方を取消さない。公開UIでは取得成功と比較成立を別ラベルにする。
- 各ページで候補・checkpoint・利用量・監査を整合保存する。commit後のjob再配信では保存済みページを使う。
- API応答受信後、DB保存前にWorkerが落ちる場合の完全なexactly-once課金は保証しない。再送可能性と推定消費を証跡へ残す。
- Aucfanの同時実行・レートは契約ごとに制御し、初期同時実行1。Yahoo側の処理待ちを増やさないqueue/実行枠に分離する。

### 7.3 加算DB migration

実装開始時に最新番号を確認し、0055より後の未使用migration番号を採番する。履歴書換え、既存結果の再計算、破壊的down migrationは行わない。

| 対象 | 追加・変更 |
| --- | --- |
| `market_price_searches` | `source_provider`既定Yahoo、適用条件、取得元制約、schema/planner version。旧行はYahooとして解釈 |
| `market_price_source_queries` 新規 | 子検索内の`new/3`等、期間意味、cursor、cap、完了状態 |
| `market_price_source_pages` 新規 | source query+page単位checkpoint、response hash、件数、時点、budget使用 |
| 既存`market_price_search_pages` | Yahoo用offset制約を維持。Aucfanのpageを偽のYahoo offsetへ変換しない |
| `market_price_candidates` | provider、marketplace、日付精度、原文/粗い/詳細状態、期間判定を加算 |
| `market_price_comparisons` 新規 | 共通条件snapshot、要求期間、比較mode、状態、lock、結果参照 |
| `market_price_comparison_sources` 新規 | 親+providerの一意関係、子検索、適用条件差 |
| `market_price_results` | 取得元・条件・制約をsnapshotへ固定。既存snapshotは不変 |
| `market_price_comparison_results` 新規 | 両側snapshot IDと統計version、評価・未確認事項をimmutable保存 |
| `market_price_source_mappings` | provider namespace追加。Yahooの既存キー/APIは既定Yahooで維持 |
| API利用量/認証ストア 新規 | 契約ごとの予約・消費推定・確定・失効。業務データのRLS境界と分離 |

候補の`ended_at NOT NULL`はAucfan日付精度と両立しないため、providerを候補側にも持ち、Yahooは日時必須、Aucfanの日付のみは日時NULL可というCHECKへ移行する。検索と候補のprovider一致を複合外部キー等で保証する。正確でない日時を埋めて既存制約を通さない。

組織・案件外scope、作成者/支店/組織scope、RLSを既存と同じ水準で適用する。system_adminは件数・状態・failure・利用量のみとし、商品名・画像・候補・価格へ権限を拡張しない。

候補の出典URLが欠けている場合も、架空URLを生成して既存NOT NULLを通さない。必要な条件付き制約を加算migrationで定義し、出典未確認として表示する。保存期間は取得元契約に従い、比較snapshotの参照先を無制限に延命させない。参照元が期限切れならその理由を残し、再現不能な比較を現行結果として表示しない。

## 8. キャッシュ・費用・運用

### 8.1 キャッシュ

- provider、契約ID、organization、条件snapshot、要求期間、Parser/Normalizer/Registry versionをキーに含める。
- Yahoo結果でAucfanキャッシュを代用しない。異なる組織へ商品検索・結果を共有しない。
- 通常利用の24時間キャッシュは、許諾が確認できた保存条件で維持/適用。実取得時点と実際の対象期間を表示する。
- 厳密比較・ベンチマークは既定cache bypass。古い片側だけを使って同時取得と称さない。
- 再試行checkpointは最初の取得時刻・期間と結びつける。retry時に期間や検索語を再生成しない。

### 8.2 費用の目安と契約境界

下表はS2/S3の受領提案値、税別。契約済み価格でも、今回購入するプランでもない。

| 方式 | 初期費用 | 最小記載月額 | 含まれる利用量 | 超過の記載 |
| --- | ---: | ---: | ---: | --- |
| REST API 自社利用 | 150,000円 | 75,000円 | 15,000 call/月 | 5円/call |
| REST API 外部提供 | 150,000円 | 90,000円 | 15,000 call/月 | 6円/call |
| MCP Start 自社利用 | 100,000円 | 10,000円 | 100 call/月 | 100円/call |

REST APIの初月は単純合算で225,000円/240,000円に、税・GCP・AI・開発費等が別途加わる。未契約のままこの費用を発生させない。MCPキャンペーンをAPIの見積りへ充当しない。

自社利用/外部提供の分類は「社内ログインだから自社」と推定せず、契約主体・利用企業・サービス提供形態で供給元に確認する。

1検索のAPI利用数は1とは限らない。

```text
検索API call数 = newの取得ページ + 3の取得ページ + 再送ページ
別途確認対象 = token発行 + 詳細照会 + 失敗応答の課金
1検索の総費用評価 = 固定月額の配賦 + 超過費用 + GCP + AI + 確認作業時間
```

月額内のcallに5円/6円を追加課金する計算はしない。「実質単価」と追加請求を区別する。低頻度なら固定費配賦が大きくなるため、速さだけでAPI優位とは判定しない。

### 8.3 予算・監視

- 契約単位の共通予算と組織別配賦を持つ。複数Worker・複数組織がそれぞれ上限いっぱい使える構成にしない。
- 外部通信前に原子的にcall枠を予約。timeout等で供給元消費不明なら保守的に消費推定へ加算する。
- 月予算80/90%で警告、100%で新規API送信停止。取消可能な予約と実消費を区別する。
- 初期評価は低頻度・既知商品1件、その後30商品以上へ拡大。テストjobにも本物と同じ予算を適用する。
- 成功20ページ上限に加えて、検索HTTP送信は再試行込み最大30回/検索、詳細は最大5回/検索を暫定安全上限とする。契約枠が小さければさらに下げる。
- `AUCFAN_AUTH_FAILED / QUOTA_EXCEEDED / RATE_LIMITED / SCHEMA_DRIFT / STALLED / BUDGET_LIMIT`等を管理画面とMonitoringへ出す。
- 通常ログはprovider、内部ID、件数、遅延、利用量、hash、failure分類のみ。検索語・title・完全URL・認証値・生JSONを出さない。
- kill switchは新規受付と各送信直前で確認し、取消後の追加課金を抑える。送信済みAPI料金が取り消されるとは扱わない。

## 9. Feature Flag・構築・段階公開

### 9.1 Flag案

- 既存`market_price_search`: 現在値を維持。今回一括OFFにしない。
- 新規`market_price_aucfan`: 既定OFF、評価組織だけON。
- 新規`market_price_comparison`: 既定OFF。両取得元の利用が許可された組織だけON。
- 運用kill switch: Aucfanだけ停止可能。Yahoo単独と既存結果閲覧を維持。

既存`market_price:read/search/manage`と上記flagの両方をAPIで検査する。UI非表示だけで保護しない。比較評価は最初managerの評価利用に限定し、合格後に必要なassessorへ展開する。

Aucfan未設定・無効の環境でも、既存Yahooと他の業務機能は起動可能にする。有効化は資格情報・予算・契約条件のpreflight後に限り、設定不足でAucfanへの新規受付を拒否する。Aucfan障害を全アプリのreadiness障害にせず、取得元別の運用ヘルスに分離する。無効時にfixtureへfallbackしない。

### 9.2 GCP構築内容

既存のWeb/API/Worker/PostgreSQLを使い、新規プロダクト・新規認証基盤は作らない。追加対象は専用Secret、Workerのsecret参照権限、Aucfan用の実行枠・予算、Monitoring、加算migrationに限定する。

- 対象は既存の専用`hanamaru-pilot-*`系統のみ。
- app_id/passwordをbrowser build-time envへ注入しない。
- 本番のprivateデータをfixtureへ持ち込まない。
- 固定Stageが本番APIを参照する構成では、テストも本番への書込み・外部課金である。評価用organization、検索ID、保持方針、予算を区切る。
- 可能な範囲でlocal fixture→local connected→固定Stage→評価組織の順に進める。

### 9.3 リリース・rollback

1. Yahoo単独の現状テスト・画像・主要DTOを基準化する。
2. 加算migrationと新旧互換API/Workerを先行。Aucfan flagはOFF。
3. 新旧Workerの混在中に新jobが旧Workerへ渡らないことを確認する。
4. 固定Stageで取得元比較を検証し、同一Web digestを本番へ昇格する。
5. 評価組織だけ有効化し、通常Yahoo利用と同時に低頻度実E2E。
6. 比較レポートを作成。Yahoo維持/Aucfan併用/採用見送りを利用者が判断する。

問題時はAucfan/comparisonの新規開始を停止し、Yahooを維持する。加算DBを巻き戻して履歴を失わせない。Aucfanデータを読めない旧Webへ戻す場合は新機能への導線を隠し、互換APIを残す。取得済み比較結果の閲覧も含めてrollback試験する。

## 10. 実装順序と成果物

以下は工数見積りではなく、検証Gate付きの作業分解である。実日程は資格情報・契約回答・現行テストの再実行結果を確認して確定する。

| 工程 | 作業 | 主な成果物 | 次工程へ進む条件 |
| --- | --- | --- | --- |
| P0 契約/現状固定 | S1〜S3の疑義一覧、稼働Revision・Yahoo基準の採取 | API契約確認表、Yahoo baseline | 未確認と確定が分離されている |
| P1 共通設計 | DTO、期間/状態精度、比較条件、費用・権限 | API/DB/Job Trace、追加SCR仕様、匿名fixture | Yahoo互換contractがPASS |
| P2 Aucfan接続 | token、v2、schema、2期間、checkpoint、budget | Providerと単体/契約/DBテスト | 外部不要の失敗ケースまでPASS |
| P3 比較処理 | 親子job、独立統計、共通ID、snapshot | API/Worker/DB結合テスト | 再試行・片側失敗・RLS・ログ検査PASS |
| P4 UI | 取得元、進捗、比較、候補修正、履歴 | MP-01〜06更新、画像 | PC/スマホの実操作E2E・axe PASS |
| P5 実接続比較 | 1商品疎通→30商品以上で評価 | 実API契約証跡、比較レポート | 下記受入条件に基づき判定 |
| P6 段階公開 | 固定Stage、評価組織、本番同一digest、rollback | release manifest、公開E2E | Yahoo維持を確認し、比較運用可能 |

P0の供給元回答待ちでもP1〜P4の匿名fixture実装は進められる。ただし未確認の提供範囲を「実接続合格」「90日全件取得」に繰り上げない。P6は別途公開承認後に実施する。

### 10.1 実装対象の配置案

- `packages/market-price/src/`: source-model、aucfan-query-plan、aucfan-response-parser、comparison、coverageの純粋関数。
- `packages/platform/src/`: aucfan-client、token-manager、usage-budget、local fixture Adapter。
- `packages/contracts/src/`: source判別DTO、比較API、精度・制約列挙値。
- `packages/database/migrations/`: provider対応、比較、ページcheckpoint、利用量の加算migration。
- `apps/api/src/`: source指定、比較CRUD/確認、scope、旧request互換。
- `apps/worker/src/`: Aucfan job、比較状態reconcile、再試行/取消、監視。
- `apps/web/src/features/market-price/`: 取得元選択、比較進捗・候補・結果・履歴。
- `docs/design/market-price/`: 本書、供給元回答、比較仕様、受入結果。

実装完了時には既存の詳細画面設計、画面遷移仕様、SCR-021、API/DB/監査Trace、デモHTMLを同期する。2026-09-09の過去検証結果は履歴として保持し、新しい試験結果と混ぜない。

## 11. 試験・受入基準

### 11.1 自動試験

| 層 | 必須ケース |
| --- | --- |
| Yahoo回帰 | 既存URL決定性、100件/90日/20ページ、状態選択、Parser、再開、候補操作、統計・履歴が不変 |
| API認証 | token期限前後、同時更新、401相当の供給元エラー、403非再試行、秘密の非露出 |
| Aucfan検索 | new/3、日/月境界、閏年、100/月制約、ページ末尾、200の無断使用なし、HTTP200エラーJSON |
| Normalizer | 日付のみ、境界不明、時差、new/used、開催中価格、税不明、数量、ID衝突、異なるsitecode |
| 統計 | 奇数/偶数中央値、5件未満、20%+IQR、手動override、状態不明、片側0件、0除算防止 |
| Job | 片側のみ失敗、取消、重複配信、受信後crash、checkpoint再開、月跨ぎ、budget競合 |
| DB/API | RLS、scope外ID、system_admin本文非表示、冪等性、lock、旧DTO、immutable snapshot |
| Security | token/stoken/password/query/生応答のlog・APM・監査漏えい0、SSRF、HTML/script、悪意あるsource URL |
| UI | 3入力経路、Yahoo単独、Aucfan単独、比較、未確認条件、戻る、再読込、片側再試行、履歴 |
| 運用 | source別kill switch、クォータ停止、警告/復旧、migration新旧混在、rollback |

Chromium/WebKit、keyboard、focus/ダイアログ、200%拡大、360/390/430/768/834/1024/1440pxで確認する。axe serious/critical 0、横スクロールと固定操作重なりなしを確認する。既存21画面の代表画像63枚に比較状態・失敗状態を追加し、画面差分をレビューする。

### 11.2 実API・公開E2E

最初は既知商品1件で、ログイン→商品入力→確認→比較→両側取得→候補修正→確定→再読込→履歴までGUIで通す。AI利用は3入力経路のうち別シナリオで確認する。token注入で画面に到達した試験と実Googleログイン試験を区別する。

実通信で以下を確認する。

- Aucfanのv2期間意味、最新順、date精度、月100件、JSON実型、エラー契約。
- 両側に同じ意味の条件・同じ要求期間が渡る。
- Aucfan失敗でもYahooが表示・確定・再読込できる。
- Aucfan単独停止でもYahoo単独が動く。
- API利用回数がUI操作数ではなく外部送信回数と整合する。
- 既存Yahoo履歴・統計が導入前と一致する。
- 取得元を切り替えてもAI価格や匿名fixtureへすり替わらない。

資格情報なし、供給元拒否、quota等は`BLOCKED`。未実行は`NOT TESTED`。安全停止が仕様どおりであることと、相場取得成功は別項目にする。

### 11.3 比較評価: 30商品以上

カメラ、時計、ブランド品、家電、低件数商品等から30商品以上を選び、型番・状態・セット品の難易度を事前分類する。対象条件を結果を見る前に固定し、成功商品だけへ差し替えない。

| 評価指標 | 方法・注意 |
| --- | --- |
| 同一商品精度 | Top50を人が正解/誤り/判定不能に分類。判定可能数と判定不能率も報告 |
| 候補網羅性 | 両取得元の和集合等から作った検証済み参照集合への再現率。市場全体のRecallとは呼ばない |
| 同一ID一致 | 共通出品の価格・日付・状態整合。未知項目を一致として数えない |
| 件数/期間 | 重複前、正規化後、条件一致後、外れ値除外後、月別上限の影響を分離 |
| 中央値差 | 同条件で比較可能なときだけ差額・差率。Yahoo中央値を真値とは扱わない |
| 速度 | 待機込み完了時間とAPI/取得処理時間、p50/p95。cache有無を分離 |
| 費用 | call、詳細照会、失敗再送、固定費配賦、GCP/AI、手動確認時間 |
| 安定性 | 取得成功、部分取得、安全停止、再開成功、長期運用で必要な保守量 |

この段階で「必ずAucfanの方が良い」という合格条件は置かない。実装合格と採用判断を分け、30商品は初期評価であり全カテゴリの保証ではないと明記する。

### 11.4 実装完了条件

1. Yahoo単独の既存自動/GUI回帰がすべて成功し、既存結果が失われていない。
2. Aucfanの実応答から候補・統計・制約を表示し、確定・再読込できる。
3. 片側だけの失敗、再試行、予算停止、kill switchが他方へ波及しない。
4. 期間・状態の差を隠さず、比較できない箇所を判定不能として出せる。
5. 権限、秘密情報、契約上の利用条件、監視、rollbackが検証済み。
6. 比較評価で未確認があれば再現条件付きで残し、データ取得成功と誤表記しない。
7. 同一commit/build/digest/revisionと試験証跡を対応付ける。

最終報告の区分は「設計完了」「ローカルfixture」「実API接続」「固定Stage」「本番評価組織」「採用判断」。それぞれを別々にPASS/FAIL/BLOCKED/NOT TESTEDで記録する。

## 12. 実接続前に確定する質問

問い合わせ案を作るところまでは本計画に含めるが、実送信・契約は行わない。

| ID | 確認事項 | 確認先 | 未確定時の扱い |
| --- | --- | --- | --- |
| Q1 | API契約の自社利用/外部提供区分、評価用資格情報・試用枠 | Aucfan・契約責任者 | fixture開発のみ。無断契約しない |
| Q2 | v2のnew/3期間、timezone、更新遅延、日付境界 | Aucfan | 90日厳密比較は未確認 |
| Q3 | 月100件の選抜順、hit_count/max_page_numberの意味、上限緩和の可否 | Aucfan | 全件coverageを主張しない |
| Q4 | 詳細状態・税込区分・送料・数量・落札成立を判別できる項目 | Aucfan | 不明値を保持、同条件比較から分離 |
| Q5 | cid体系、ブランド指定、検索構文、v2の現行version | Aucfan | 検証済み項目だけ送信 |
| Q6 | tokenの期限timezone、失効コード、上限時発行拒否と超過料金の関係 | Aucfan | 本番自動更新・予算運用を有効化しない |
| Q7 | page/詳細/token/失敗の課金、レート/同時接続制限、利用量照会 | Aucfan | 保守的な予算計数、低頻度試験のみ |
| Q8 | 取得結果・統計の保存、24h cache、社内/顧客への再表示、比較・画像表示の許諾 | Aucfan・契約責任者 | 不明な保存・再配信を行わない |
| Q9 | 評価予算、月上限、評価利用者、採用判断の担当 | ユーザー/運用責任者 | 新機能は非公開・既定OFF |
| Q10 | MCPも評価する場合のtools/schema/商用組込み、キャンペーン適用条件 | Aucfan | API方式と別の検証計画にする |

## 13. この計画の判断点

最初に作るのは「乗り換えた製品」ではなく、**現行Yahooを残したまま、Aucfanを実データで評価できる製品**である。

比較の結果は、次のいずれでもよい。

- Yahooを標準維持し、Aucfanは補助として併用する。
- 特定カテゴリだけAucfanが有効なので、用途を限定して併用する。
- APIの提供制約・費用が要件に合わず、採用を見送る。
- 十分な比較結果を得た後、別の意思決定として標準取得元の変更を検討する。

現時点ではその結論を先取りしない。実装上は最初からどちらも独立して動かせる構造とし、Yahooの既存機能・データ・利用者動線を守る。
