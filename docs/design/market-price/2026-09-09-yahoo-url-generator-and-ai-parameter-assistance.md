# Yahoo!落札相場 URL Generator／AIパラメータ補助 詳細設計

## 1. 文書の位置付け

本書はSCR-021「買取相場（仮）」のバックエンド実装契約を定義する。画面構造と操作方法は既存SCR-021設計を維持し、対象期間の表示だけを「直近90日」へ統一する。

外部取得はYahoo!オークションの公開落札相場画面を対象とする。利用規約、robots方針、HTML構造、アクセス制限は変更され得るため、本機能は既定Feature Flag OFFとし、回避技術を使わず、契約不一致時は安全停止する。

## 2. 責任分離

```text
利用者が確認した商品・検索語・状態
  -> Parameter Planner（候補選択だけ）
  -> Parameter Registry（Yahoo IDの検証）
  -> URL Generator（純粋関数）
  -> URL Parser（round trip検証）
  -> Source Provider（HTTP取得）
  -> Result Parser（構造・並び順検証）
  -> Candidate Evaluator（同一商品・状態・除外語）
  -> Outlier Evaluator（中央値偏差＋IQR）
  -> Statistics（最低・中央値・最高）
```

GeminiはURL、Yahoo ID、価格、未確認状態を生成しない。検索語と状態は利用者の確定値をそのまま使い、カテゴリ・ブランドがレジストリで一意に解決できない場合だけ、許可済み候補キーから選択する。構造化出力が2回とも不正な場合は、カテゴリ・ブランドを省略して`p + istatus`へフォールバックする。

## 3. URL契約

- origin：`https://auctions.yahoo.co.jp`
- path：`/closedsearch/closedsearch`
- パラメータ順：`p, auccat, brand_id, istatus, select, n, b`
- `select=6`：終了日時が新しい順
- `n=100`：1ページ100件
- `b=1 + (pageNumber - 1) * 100`
- 未知、重複、LEGACY、任意raw parameterは拒否する。
- 生成したURLをParserでsemantic specへ戻し、同一の場合だけHTTP取得する。
- 完全URLと検索語は通常ログ、監査metadata、DBの運用列へ保存しない。SHA-256だけを保持する。

商品状態は`unused=1`、`near_unused=3`、`good=4`、`fair=5`、`poor=6`、`very_poor=7`へ変換する。複数値は昇順とし、`unspecified`を含む場合は`istatus`を省略して取得後に判定する。

## 4. Parameter Registry

`market_price_source_mappings`は組織ごとにカテゴリ／ブランドのYahoo IDを管理する。

| 項目 | 契約 |
| --- | --- |
| `dimension` | `category` または `brand` |
| `registry_key` | 安定した内部キー。英小文字、数字、`_`、`-`のみ |
| `source_id` | 検証済みの1〜19桁の数字 |
| `canonical_name` / `aliases` | NFKC・空白整理後に完全一致で解決 |
| `status` | `CONFIRMED` / `COMPATIBLE`だけURL利用可。`DEPRECATED`は不可 |
| `verified_at` / `expires_at` | 検証日時と任意の失効日時 |
| `registry_version` | URLと検索記録へ保存する版 |

管理APIは`market_price:manage`の組織scopeを必須とする。

- `GET /api/v1/admin/market-price/source-mappings`
- `PUT /api/v1/admin/market-price/source-mappings/:key`

レジストリが未登録、複数一致、失効済みの場合は該当条件をURLへ入れない。Yahoo IDを推測しない。

## 5. API契約

### 商品確認

`POST /api/v1/market-price/identifications`

手入力または既存のAI商品特定UIで確定した商品名、カテゴリ、ブランド、検索語候補、除外語を2時間有効の確認レコードとして保存する。画像やGemini raw responseは保存しない。

### 検索開始

`POST /api/v1/market-price/searches`

```ts
interface CreateMarketPriceSearchRequest {
  identificationId: string | null;
  selectedSearchQueryId: string;
  conditions: ProductCondition[];
  outlierPolicy: MarketPriceOutlierPolicy;
}
```

`identificationId=null`の場合も、呼出利用者が参照できる有効な確認レコードから`selectedSearchQueryId`を一意に解決する。0件または複数件なら409で停止する。検索語をリクエスト本文から直接受け取らない。

同一semantic条件の`ready`結果は24時間再利用する。対象期間、並び順、ページ件数、最大ページ数は利用者入力にせず、90日／最新順／100件／20ページへ固定する。

### 結果と手動補正

- `GET /api/v1/market-price/searches`
- `GET /api/v1/market-price/searches/:id`
- `PATCH /api/v1/market-price/searches/:id/candidates/:candidateId`

候補の手動include/exclude後は、保存済み候補だけで最低・中央値・最高・採用件数を再計算する。

## 6. Worker・再開契約

`market_price_search`は次の順に処理する。

1. Feature Flagと権限済み入力を検証する。
2. `startedAt`を基準に`periodEnd`と`periodStart=periodEnd-90 days`を固定する。
3. Registry解決、必要時のみGemini候補選択、fallbackを実行する。
4. 1ページ目のcanonical specとhashを保存する。
5. 成功済み`market_price_search_pages`をcheckpointとして再利用する。
6. 未完了ページだけを5秒以上の間隔で取得する。
7. 各ページで`-END_TIME`、100件契約、ページ内降順、ページ間降順、重複ページを検証する。
8. 90日境界、最終ページ、0件、20ページのいずれかで停止する。
9. 同一商品、状態、除外語、期間、外れ値を順に評価して統計を保存する。

実行中もページごとにFeature Flagを再確認する。kill switch OFF、CAPTCHA、403、継続429、Parser drift、並び順不一致、同一ページ反復では次ページへ進まない。temporary failureは既存job retryへ渡し、成功済みcheckpointから再開する。

## 7. 候補・外れ値判定

同一商品判定は価格と分離する。検索語tokenのtitle内カバレッジを基本とし、型番token欠落と、検索語に含まれない付属品単体シグナルを減点する。`matchScore < 0.75`は`product_mismatch`として自動除外し、scoreと理由を保存する。

外れ値は状態別グループで5件以上ある場合だけ判定する。

- `abs(price - median) / median > deviationThreshold`（初期値20%）
- かつ、`Q1 - 1.5 * IQR`未満または`Q3 + 1.5 * IQR`超

両方を満たす候補だけを`price_outlier`として除外する。最低件数未満では外れ値を自動除外しない。利用者の手動include/excludeを最終判断として別列に保持する。

## 8. DB・監査・ログ

主要テーブルは次のとおり。

- `market_price_identifications`
- `market_price_searches`
- `market_price_search_pages`
- `market_price_candidates`
- `market_price_source_mappings`

全テーブルへorganization RLSを適用する。`market_price_searches`は計画・coverage・統計を、pagesはURL hashと取得件数・終了日時・response hashを、candidatesは商品URL・価格・終了日時・判定理由を保持する。生HTML、完全検索URL、Gemini raw response、画像、署名URLは保存しない。

監査eventは`parameter_plan_created`、`parameter_plan_fallback`、`search_url_generated`、`search_page_fetched`、`coverage_completed`、`search_partial`、`search_blocked`を記録する。metadataはhash、version、パラメータ名、ページ番号、件数、期間端点、処理時間、HTTP status、failure classに限定する。

## 9. Coverageと画面表示

`complete`は「90日境界へ到達」または「Yahoo検索結果末尾へ到達」の場合だけ設定する。20ページ上限、途中停止、一部解析不能は`partial`または`blocked`とし、「直近90日の全件取得」と表示しない。

UI構造は変更せず、期間文言だけ次へ統一する。

- `直近90日`
- `直近90日の取得完了`
- `直近90日の取得完了は確認できていません`

## 10. 運用監視とリリースGate

5分間隔のoperations scanは、相場検索jobのheartbeatが3分以上古い状態を`MARKET_PRICE_STALLED`、安全契約で停止した検索を`MARKET_PRICE_BLOCKED`として検出する。管理APIとCloud Monitoringの両方へ反映し、復旧後はactive alertをresolveする。

Feature Flagは既定OFFとする。固定Stageでは既知商品1件だけを低頻度で実アクセスし、HTTP 200だけでなく、100件、終了日時降順、90日境界停止、完全URL非漏えいを確認する。規約・robots・HTML契約の変更を確認できない場合はFeature Flagを有効化しない。

## 11. Trace

| 要件 | 実装 | 検証 |
| --- | --- | --- |
| 決定的URL | `@hanamaru/market-price` generator/parser | canonical URL unit、round trip |
| AI候補限定 | `AiProvider.planYahooSearch` | 架空key・状態追加の拒否 |
| 100件・最新順 | Result Parser | metadataと終了日時降順 |
| 90日 | `searchPeriod` / Worker stop | 境界内・一致・外側 |
| checkpoint | `market_price_search_pages` | 再試行時の成功ページ再利用 |
| 24時間cache | `normalized_query_hash` | 同条件で既存search IDを返す |
| 同一商品 | Candidate Evaluator | token・型番・付属品fixture |
| 外れ値 | Median deviation + Tukey IQR | 20%と最低5件fixture |
| RBAC/RLS | capability + organization RLS | Manager/Assessor/system_admin境界 |
| 停止・監視 | flag、Parser fail-closed、operations scan | blocked/stalled alert |

## 12. 未実施の外部Gate

ローカル実装・fixture検証と、固定Stageでの低頻度実アクセス、公開Feature Flag有効化は別の完了状態として扱う。Stage実アクセス、GCP設定変更、deploy、pushはそれぞれ明示承認を受けたリリース工程で行う。

精度・速度の集計器は30商品未満の入力を拒否し、Top 50 precision差、Top 100 recall差、取得ページ削減率、処理時間中央値、0件率を同時に出す。匿名contract fixtureは計算ロジックの検証にだけ用い、実商品の比較結果として報告しない。リリース判定には、別途用意する30商品以上の匿名評価集合が必要である。
