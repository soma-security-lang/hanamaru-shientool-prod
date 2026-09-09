# SCR-021「買取相場（仮）」 各ページ詳細画面設計書

## 0. 文書情報

| 項目 | 内容 |
| --- | --- |
| 対象SCR | SCR-021 |
| 対象Route | `/market-price` |
| 論理ページ | MP-01〜MP-06 |
| Design master | 本書 |
| 状態 | ローカル実装済み／GCP未反映／HITL待ち |
| デモ | `prototypes/market-price-demo.html` |

## 1. Apple Webデザイン意図

Apple製品やiOS画面を複製せず、Mac向け業務Webの静かな階層、即時反応、可逆な判断を適用する。

- 第一目的は「価格を見せる」ことではなく、「どの商品を、どの条件で、どの落札候補から集計したか」を短時間で判断できること。
- 白い作業面、淡いニュートラル背景、最小限の境界線で、条件・候補・結果を区別する。
- Primary Actionは各論理ページ1つに限定する。
- AI補助の提案と取得事実を視覚的に混ぜない。
- 中央値を主要指標とし、最低・最高は分布の端として従属表示する。
- 画面遷移にバウンスや偽の進捗を使用しない。
- 警告は色だけに依存せず、見出し、アイコン、説明、復旧操作を持つ。
- PCは比較密度、Smartphoneは段階的な判断を優先する。

## 2. 共通寸法付きレイアウト

| Viewport | Navigation | Content | Grid | Gutter | Gap |
| ---: | --- | --- | --- | ---: | ---: |
| 360〜767px | Bottom Navigation | 1ペイン | 1 column | 16px | 12〜16px |
| 768〜1023px | 72px Rail | 1〜2ペイン | 8 columns | 24px | 20px |
| 1024〜1279px | 240px Sidebar | 2ペイン | 12 columns | 24px | 20px |
| 1280px以上 | 240px Sidebar | 3ペイン | 12 columns | 32px | 24px |

### 2.1 高さ・固定領域

- PC Header：64px。
- Smartphone App Bar：56px。
- Smartphone Bottom Navigation：68px＋safe area。
- Smartphone Sticky Action：64〜80px。Bottom Navigation直上。
- Input／Button／Select：44px以上。Primary Buttonは48px以上。
- 結果候補行：PC 56〜72px。Smartphoneは内容に応じて伸長。
- `100vh`固定を避け、`100dvh`と`min-height`を使い分ける。

## 3. Semantic structure

```text
body
  header            AppShell Top Bar / Mobile App Bar
  aside             PC Sidebar
  main#main-content
    header          SCR-021 Page Header
    nav             Market Price Stepper / view tabs
    section         Current logical page
      form          MP-01 / MP-02
      status        MP-03 status banner
      section       MP-04 candidate list
      output        MP-05 statistics
      section       MP-06 history
  nav               Mobile Bottom Navigation
  dialog            confirmation / warning / detail
```

- 画面全体の`h1`は「買取相場」。
- 論理ページ名は`h2`。
- ペイン内セクションは`h3`。
- 集計値は`output`または`dl`で構造化する。
- 候補一覧はPCではsemantic table、Smartphoneではarticle＋description list。
- 非同期完了は`aria-live="polite"`、失敗は`role="alert"`を使用する。

## 4. 共通コンポーネントツリー

```text
MarketPriceShell
  MarketPriceHeader
  MarketPriceStepper
  ResponsiveMarketWorkspace
    ProductInputPane
      InputMethodSelector
      ImageUploader
      ProductConditionForm
      AiAssistAction
    IdentificationReviewPane
      ProductCandidateList
      SuggestedFieldReview
      SearchQuerySelector
      ExclusionKeywordEditor
    ScrapeJobStatus
    AuctionCandidateReview
      CandidateFilterBar
      CandidateTable | CandidateCards
      CandidateDecisionControl
    MarketPriceSummary
      CoverageBanner
      PriceStatisticGroup
      DistributionSummary
    MarketPriceHistory
  MobileStickySummary
  MobileStickyAction
  UnsavedChangesDialog
  CandidateDetailDialog
```

## 5. MP-01 検索開始・商品入力

### 5.1 画面定義

| 項目 | 内容 |
| --- | --- |
| Page ID | MP-01 |
| URL | `/market-price` |
| 目的 | 商品画像または既知の商品条件から検索準備を始める |
| 最初に認識する情報 | 画像＋AI補助、手入力＋AI補助、手入力のみの3つの開始方法 |
| Primary Action | `AIで商品候補を作る`または`検索条件を確認` |
| Entry | Sidebar、Bottom Navigation、履歴から条件編集 |
| Exit | MP-02、MP-06、他の業務領域 |

### 5.2 レイアウト

#### PC 1440px

- 画面Header：全幅、高さ72px。
- 左ペイン4列：3つの検索方法、画像、商品条件、商品状態。
- 中央ペイン5列：入力のヒント、カテゴリ別確認項目、最近の検索。
- 右ペイン3列：現在の確定条件summary。入力前は使い方を簡潔に表示。
- Heroや説明だけの大型カードを置かない。

#### Tablet 834px

- 入力6列＋summary2列。
- 3つの検索方法をSegmented Controlで切り替える。
- 最近の検索は入力下へ配置する。

#### Smartphone 390px

- App Bar：「買取相場」「1 / 5」。
- 検索方法カード3件。画像AI支援、手入力AI支援、手入力のみを横幅いっぱいの1列で表示する。タイトルを途中改行せず、説明は自然な2行以内を基本とする。
- 選択後に画像または手入力フォームだけを表示。
- 商品状態は共通の複数選択として入力方法の下に表示する。
- AI補助の説明は1行＋詳細Disclosure。
- Primary Actionを下部固定。

### 5.3 表示・入力・操作

#### 検索方法

| Value | Label | 説明 | AI補助 |
| --- | --- | --- | --- |
| `image_assisted` | 写真から候補を作る | 写真と補足情報から商品候補と検索語を提案 | 使用 |
| `manual_assisted` | 手入力をAIで補助 | 分かる商品情報を入力し、不足項目と検索語を提案 | 使用 |
| `manual_direct` | 自分で検索条件を入力 | AI補助を使わず、入力内容のまま確認へ進む | 不使用 |

3つのカードは、最初のviewportで同時に認識できるようにする。`manual_assisted`を「その他」や詳細Disclosureへ隠さない。

#### 画像入力

| 項目 | 制約 | Error |
| --- | --- | --- |
| 商品画像 | JPEG／PNG／WebP、最大5枚 | `対応している画像を選択してください` |
| 1枚の容量 | 10MB以下 | `1枚あたり10MB以下にしてください` |
| 合計容量 | 50MB以下 | `画像の合計を50MB以下にしてください` |
| 補足 | 500文字以下 | `500文字以内で入力してください` |

- 追加時にfile name、容量、thumbnail、削除を表示する。
- 同一ファイルhashの重複を拒否する。
- 顔、住所、本人確認書類が写っていないかの注意を表示する。
- カメラ撮影とファイル選択を同じinputで受け付ける。

#### 手入力

| 項目 | 型 | 必須 | 初期値 |
| --- | --- | --- | --- |
| 商品名 | text 100文字 | 型番が空なら必須 | 空 |
| カテゴリ | enum | 必須 | 未選択 |
| ブランド | text 80文字 | 任意 | 空 |
| 型番 | text 80文字 | 商品名が空なら必須 | 空 |
| シリーズ | text 80文字 | 任意 | 空 |
| 色 | text 40文字 | 任意 | 空 |
| サイズ・容量 | text 60文字 | 任意 | 空 |
| 付属品 | multi text | 任意 | 空 |
| 商品状態 | `ProductCondition[]` | 必須・1件以上 | `near_unused`、`good`、`fair` |

IME composition中は候補生成、validation、Enter submitを実行しない。

#### 商品状態

| Value | Label | 初期選択 |
| --- | --- | --- |
| `unused` | 未使用 | なし |
| `near_unused` | 未使用に近い | あり |
| `good` | 目立った傷や汚れなし | あり |
| `fair` | やや傷や汚れあり | あり |
| `poor` | 傷や汚れあり | なし |
| `very_poor` | 全体的に状態が悪い | なし |
| `unspecified` | 状態の記載なし | なし |

- Checkboxによる複数選択とし、「すべて選択」「選択を解除」を提供する。
- 0件ではPrimary Actionを無効にし、fieldset直下へ`商品状態を1件以上選択してください`と表示する。
- AI補助の提案は候補として表示し、自動選択しない。利用者の選択が正本となる。
- `unspecified`は利用者の明示選択がない限り検索・集計対象へ含めない。

#### 手入力＋AI補助の範囲

`manual_assisted`では、既知の商品情報を先に利用者が入力する。AI補助は入力値を正本として扱い、次を別の提案欄へ返す。

| 対象 | AI補助 | 自動反映 |
| --- | --- | --- |
| ブランド | 正式表記・別表記候補 | しない |
| 型番 | 入力との整合候補、区切り文字の違い | しない |
| シリーズ | 型番・商品名から候補提示 | しない |
| カテゴリ | 最大3候補と理由 | しない |
| 追加確認項目 | 容量、世代、サイズ等の質問 | しない |
| 検索語 | 厳密／標準／広め | しない |
| 除外語 | 付属品のみ、空箱、ジャンク等 | しない |
| 商品状態 | 画像から推測できる範囲の候補 | しない |

手入力値とAI補助の提案値は同じinputへ即時mergeせず、MP-02で左右比較して採用する。

#### Action

| Action | Enabled | Result |
| --- | --- | --- |
| AIで候補を作る | 画像1枚以上、または既知条件1項目以上、かつ商品状態1件以上 | MP-02 analyzing |
| AIで入力を補助 | `manual_assisted`かつ既知条件1項目以上、商品状態1件以上 | MP-02 analyzing |
| 手入力のまま進む | 商品名または型番＋カテゴリ＋商品状態1件以上 | MP-02 manual confirm |
| 検索履歴 | `market_price:read` | MP-06 |
| 入力をクリア | dirty | 確認Dialog後に初期化 |

### 5.4 状態

- `initial`：入力方法を選ぶ。
- `loading`：履歴summaryまたはupload session取得中。
- `empty`：最近の検索が0件。入力機能は利用可能。
- `success`：入力有効、次へ進める。
- `partial`：一部画像だけupload成功。失敗画像を明示。
- `failure`：upload、AI補助利用可否取得、初期データ失敗。
- `retry`：失敗画像だけ再送可能。
- `forbidden`：入力欄や過去条件を表示しない。
- `deleted`：適用なし。削除済み履歴から来た場合は新規検索へ戻す。

### 5.5 API・監査

- `POST /api/v1/market-price/identifications`
- `POST /api/v1/market-price/identifications/:id/uploads`
- AI補助利用時だけ`POST .../:id/analyze`を呼び、内部providerとしてGeminiを使用する。
- 監査：`market_price.identification_started`

### 5.6 Motion / accessibility

- 入力方法切替は220ms opacity。高さアニメーションを長くしない。
- reduced motionでは即時切替。
- File inputへ可視labelを付ける。
- thumbnail削除は画像名を含むaccessible nameを持つ。
- validation summaryと各field errorを`aria-describedby`で接続する。

### 5.7 テスト・HITL受入条件

- 画像＋AI補助、手入力＋AI補助、手入力のみの違いを説明なしに判断できる。
- 手入力＋AI補助が主要経路として見つかる。
- AI補助を使わない経路も同じ画面で見つかる。
- 5枚、10MB、50MB、MIME制約が成立する。
- 390pxでPrimary ActionとBottom Navigationが重ならない。
- 360／390／430pxで3つの入力方法が縦1列になり、各Card幅が利用可能幅いっぱい、タイトルが1行になる。
- PCでも入力方法Panelが720px未満の場合は縦1列とし、画面ViewportではなくPanelの実幅で列数を決める。
- 未入力で外部取得を開始できない。
- 商品状態を複数選択でき、0件では次へ進めない。
- 「状態の記載なし」が初期選択されない。

## 6. MP-02 商品候補・検索条件確認

### 6.1 画面定義

| 項目 | 内容 |
| --- | --- |
| Page ID | MP-02 |
| URL | `/market-price?searchId=<UUID>&view=identify` |
| 目的 | AI補助の提案または手入力条件を、外部検索前に人が確定する |
| 最初に認識する情報 | 現在値と提案値の違い、未確認件数 |
| Primary Action | `この条件で検索` |

### 6.2 レイアウト

- PC：左に入力、中央に商品候補と項目差分、右に検索条件summary。
- Tablet：候補5列＋確定条件3列。
- Smartphone：商品候補→項目確認→検索語の順にAccordion表示。未確認項目を上部に集約。

### 6.3 商品候補

最大3件。各候補に次を表示する。

- 候補商品名
- ブランド、シリーズ、型番候補
- 確信度：高／中／低
- 画像から観察できた根拠
- 不明項目
- 選択する／該当なし

確信度を百分率で出さない。真贋や状態を確定表現にしない。

### 6.4 項目単位の判断

| Decision | 表示 | 結果 |
| --- | --- | --- |
| 採用 | `提案を採用` | confirmed valueへ反映 |
| 編集して採用 | input表示 | 編集値をconfirmedへ反映 |
| 却下 | `提案を使わない` | 元入力または空欄 |
| 未確認 | 状態Badge | 検索開始を抑止 |

- 既存の手入力値をAI補助の提案で自動上書きしない。
- 型番、カテゴリ、商品名は検索開始前に必ず人が確認する。
- 不明は空欄として確定できる。ただし必須組合せは満たす。

### 6.5 検索条件

#### Keyword strategy

| Value | Label | 初期選択 |
| --- | --- | --- |
| `strict` | 厳密 | 型番がある場合 |
| `standard` | 標準 | 型番がない場合 |
| `broad` | 広め | 利用者明示選択のみ |

#### Fields

- 検索キーワード：1〜120文字。
- 含める語：最大10件、1件40文字。
- 除外語：最大20件、1件40文字。
- 対象期間：直近90日固定、read-only。
- カテゴリ：必須。
- 商品状態：1件以上、複数選択。MP-01の値を復元し、ここでも編集可能。

広めを選択した場合、「類似商品が混ざるため候補確認が必要」と表示する。

### 6.6 Action

| Action | Enabled | Result |
| --- | --- | --- |
| この条件で検索 | 未確認0、必須有効、商品状態1件以上、送信中でない | MP-03 |
| AI補助を再実行 | 解析失敗または画像追加後、最大1回 | analyzing |
| 手入力へ切替 | 常時 | MP-02 manual edit |
| 入力へ戻る | 常時 | MP-01 |

二重押下はidempotency keyで同一searchを返す。

### 6.7 状態

- `initial`：manual confirm。
- `loading`：AI補助解析中。数値進捗なし。
- `empty`：候補なし。手入力欄を主表示。
- `success`：候補または手入力条件を確認可能。
- `partial`：一部項目だけ提案。unknownを明示。
- `failure`：AI補助失敗。手入力へ移行可能。
- `retry`：構造化出力不正後の1回再生成。
- `forbidden`：内容を表示しない。
- `deleted`：画像期限切れ。MP-01から再開。

### 6.8 API・監査

- `GET /api/v1/market-price/identifications/:id`
- `PATCH /api/v1/market-price/identifications/:id/confirm`
- `POST /api/v1/market-price/searches`
- 監査：`identification_completed`、`suggestion_decided`、`condition_filter_confirmed`、`search_started`

### 6.9 Motion / accessibility

- 候補切替時に差分領域の`h3`を更新するがfocusを奪わない。
- 未確認件数は`aria-live=polite`。
- 採否はbutton groupで表現し、選択状態を`aria-pressed`で通知する。
- 横スワイプ限定にせず、前後ボタンと候補一覧を提供する。

### 6.10 テスト・HITL受入条件

- AI補助が価格を取得していると誤解しない。
- 元入力と提案値の違いが分かる。
- 未確認項目があると検索開始できない。
- 広めの検索のリスクを理解できる。
- Keyboardだけで全提案を採否できる。
- AI補助の状態候補と利用者の確定状態を区別できる。

## 7. MP-03 取得状況

### 7.1 画面定義

| 項目 | 内容 |
| --- | --- |
| Page ID | MP-03 |
| URL | `/market-price?searchId=<UUID>&view=progress` |
| 目的 | 実取得の状態、継続可否、停止理由を確認する |
| 最初に認識する情報 | 現在の処理段階と、画面を閉じてもよいこと |
| Primary Action | 状態に応じて`候補を確認`、`再試行`、`条件を編集` |

### 7.2 レイアウト

- PC：中央ペイン上部に状態Card、下に確定条件と処理timeline。右は結果placeholder。
- Tablet：状態とtimelineを1カラム、条件summaryを右側。
- Smartphone：状態見出し、段階timeline、処理条件、復旧操作。Bottom Navigationは利用可能。

### 7.3 表示項目

- 検索受付時刻
- 現在段階：受付／取得／正規化／確認待ち
- 対象期間
- 確定検索キーワード
- 取得済みページ数は実数がある場合だけ表示
- 最古・最新の取得日
- retry可能時刻
- failure classを変換した利用者向け文言

Provider raw error、HTML、URL query detailを表示しない。

### 7.4 Action

| Status | Primary | Secondary |
| --- | --- | --- |
| queued/fetching/normalizing | 画面を閉じる | 検索条件を見る |
| review_required/ready | 候補を確認 | なし |
| partial | 取得範囲を確認 | 条件を狭める |
| blocked | 条件を編集 | 許可時刻後に再試行 |
| failed | 条件を編集 | retryable時のみ再試行 |
| cancelled | 条件を編集 | 新しい検索 |

### 7.5 状態

- 9共通状態に加え、`queued / fetching / normalizing / blocked / cancelled`を画面固有状態として持つ。
- pollingは5秒開始、30秒までbackoffし、visibility hidden中は頻度を落とす。
- 完了時はMP-04へ`replace`する。

### 7.6 API・監査

- `GET /api/v1/market-price/searches/:id`
- `POST /api/v1/market-price/searches/:id/retry`
- cancel endpointは正式設計時に確定する。
- 監査：`scrape_blocked`、`search_retried`

### 7.7 Motion / accessibility

- TimelineはCSS animationで自動回転させない。
- 状態変化を`aria-live=polite`で通知する。
- failureは`role=alert`だが、pollingのたびに読み上げ直さない。

### 7.8 テスト・HITL受入条件

- 数値の偽進捗がない。
- 画面を閉じても処理が続くことが分かる。
- 403／429／CAPTCHA時に回避操作がない。
- 完了後Backで待機画面へ戻らない。

## 8. MP-04 落札候補確認

### 8.1 画面定義

| 項目 | 内容 |
| --- | --- |
| Page ID | MP-04 |
| URL | `/market-price?searchId=<UUID>&view=candidates` |
| 目的 | 落札候補の同一商品・状態・価格外れ値判定を確認し、集計集合を確定する |
| 最初に認識する情報 | 採用件数、除外内訳、外れ値除外前後の中央値、取得完全性 |
| Primary Action | `相場を確定` |

### 8.2 レイアウト

- PC：中央5列に外れ値設定と候補Table、右4列にSticky統計、左3列に検索条件。
- Tablet：候補5列＋統計3列。
- Smartphone：Filter、Sticky Summary、候補Card、Sticky Action。1Cardずつ判断できる。

### 8.3 Filter・sort

| Control | Options |
| --- | --- |
| 表示 | すべて／採用／除外／要確認 |
| 一致度 | 高／中／低 |
| 状態 | 未使用／未使用に近い／目立った傷や汚れなし／やや傷や汚れあり／傷や汚れあり／全体的に状態が悪い／状態の記載なし |
| 判定 | 通常／外れ値候補／判定不能／手動変更 |
| sort | 落札日新しい順／価格安い順／価格高い順／一致度順 |

Filterは候補表示だけを変え、集計集合を変更しない。

### 8.4 Candidate表示

- 採用／除外toggle
- 商品タイトル
- 落札価格
- 落札日時
- 商品状態
- 状態グループの候補数と中央値
- 状態別中央値からの乖離率
- IQR範囲
- 一致度と一致理由
- 除外理由候補
- 自動外れ値候補／手動で復帰／手動除外のBadge
- 税表示
- 元ページを新しいTabで開くLink

外部Linkには`rel="noopener noreferrer"`を付け、離脱で候補判断を失わない。

### 8.5 外れ値設定

| Control | 初期値 | 制約 |
| --- | --- | --- |
| 明らかな価格外れ値を自動除外 | ON | OFF時は警告だけを表示 |
| 基準 | 状態別中央値 | 変更不可 |
| 乖離率 | 20% | 1〜100%、整数 |
| 補助判定 | Tukey IQR 1.5倍 | 変更不可 |
| 最低比較件数 | 5件 | 変更不可 |

自動除外は、同じ`normalizedCondition`の有効候補が5件以上、中央値からの乖離率が設定値を超え、かつIQR範囲外の場合だけ行う。異なる状態を同じ母集団へ混ぜない。

### 8.6 判断規則

- 初期採用は決定的ルールで高一致となった候補だけ。
- AIスコアだけで初期採用しない。
- 低一致、外れ値、税表示混在、まとめ売り候補は要確認。
- 自動外れ値候補は初期除外するが一覧から消さない。
- 「集計へ戻す」で自動判定を手動上書きできる。非外れ値候補は「除外する」で手動除外できる。
- 手動上書きは再計算や閾値変更後も保持し、「自動判定に戻す」でだけ解除する。
- 同じ状態の候補が5件未満なら自動除外せず、判定不能を表示する。
- 除外時に理由を選択可能。必須ではないが監査可能にする。
- すべて除外した場合は相場確定を無効にする。

### 8.7 即時計算

採否変更時に次をclientで仮計算し、保存後にAPI結果で確定する。

- included count
- minimum
- median before outlier exclusion
- median
- maximum
- exclusions by keyword／condition／price outlier／manual
- restored count

clientとserverの計算差があればserverを正本とし、更新理由を表示する。

### 8.8 状態

- `initial`：候補読込前。
- `loading`：候補page読込。
- `empty`：候補0件。条件変更へ戻る。
- `success`：候補確認可能。
- `partial`：90日境界未達、一部価格不正、または外れ値判定不能グループあり。
- `failure`：候補保存・再計算失敗。
- `retry`：採否draftを保持して再送。
- `forbidden`：候補、価格、件数を表示しない。
- `deleted`：検索データ削除済み。

### 8.9 API・監査

- `GET /api/v1/market-price/searches/:id`
- `PATCH /api/v1/market-price/searches/:id/candidates/:candidateId`
- `POST /api/v1/market-price/searches/:id/recalculate`
- 監査：`outlier_policy_changed`、`outlier_evaluated`、`candidate_decided`、`candidate_restored`、`stats_calculated`

### 8.10 Motion / accessibility

- 採否変更は120ms press＋220ms summary update。
- 価格更新は色やcount-up animationに依存しない。
- Toggle accessible nameに商品タイトルを含める。
- Table row全体をclick targetにせず、明示buttonを使う。

### 8.11 テスト・HITL受入条件

- 空箱、付属品、まとめ売りを候補から除外できる。
- 除外直後に件数と中央値が変わる。
- 同じ状態の5件以上に対してだけ20%＋IQRの自動除外が動く。
- 異なる状態の正当な価格差を外れ値にしない。
- 自動除外候補を集計へ戻し、除外前後の中央値と内訳が更新される。
- 5件未満は自動除外せず判定不能と表示する。
- 税・送料の扱いを誤解しない。
- 390pxで横スクロールなし。
- 1件以上採用しないと確定できない。

## 9. MP-05 相場結果

### 9.1 画面定義

| 項目 | 内容 |
| --- | --- |
| Page ID | MP-05 |
| URL | `/market-price?searchId=<UUID>&view=result` |
| 目的 | 取得範囲と根拠集合を伴う落札価格統計を確認する |
| 最初に認識する情報 | 外れ値除外後の参考中央値、除外前との差、件数、完全取得／部分取得 |
| Primary Action | `新しい相場を調べる` |

### 9.2 レイアウト

- PC：右4列に統計、中央5列に採用候補、左3列に確定条件。
- Tablet：統計を上、候補を下の2領域。
- Smartphone：完全性Banner、中央値、min/max、件数、採用候補の順。

### 9.3 統計表示

| Label | 表示規則 |
| --- | --- |
| 落札価格の参考中央値 | 最も大きく表示 |
| 外れ値除外前の中央値 | 比較値として常時表示 |
| 最低値 | 中央値より小さく表示 |
| 最高値 | 中央値より小さく表示 |
| 集計対象 | 件数を常時表示 |
| 除外 | 0件でも表示 |
| 除外内訳 | キーワード／状態／価格外れ値／手動を表示 |
| 手動復帰 | 自動外れ値候補を戻した件数を表示 |
| 取得期間 | 実際の最古・最新日 |
| 取得完全性 | 完全／部分／取得停止 |
| 計算日時 | 絶対日時 |

部分取得時の主見出しは「取得範囲内の参考中央値」とする。

### 9.4 補助情報

- 送料は合算していない。
- 税表示が混在する場合は警告。
- 推奨買取価格ではない。
- 商品状態、付属品、相場変動を考慮して人が判断する。
- 外れ値は同一状態の5件以上を母集団とし、中央値20%超とIQR範囲外を併用していることを表示する。
- 採用候補一覧と元ページLink。

### 9.5 Action

| Action | Result |
| --- | --- |
| 候補を見直す | MP-04 |
| 同じ条件で再検索 | 新searchIdでMP-03 |
| 条件を編集して再検索 | MP-01 prefilled |
| 新しい相場を調べる | MP-01 blank |
| 検索履歴を見る | MP-06 |

訪問へ反映、見積へ反映、顧客へ送信する操作は置かない。

### 9.6 状態

- `initial`：canonicalize中。
- `loading`：結果取得中。
- `empty`：採用候補なしで結果未生成。
- `success`：完全取得結果。
- `partial`：部分取得結果。
- `failure`：計算結果不整合。価格を隠す。
- `retry`：結果再取得。
- `forbidden`：統計を表示しない。
- `deleted`：保存期限切れ。新規検索を提示。

### 9.7 API・監査

- `GET /api/v1/market-price/searches/:id`
- `POST /api/v1/market-price/searches/:id/retry`
- 監査：`result_viewed`、`search_retried`

### 9.8 Motion / accessibility

- 初回表示で金額count-upを行わない。
- 通貨は`Intl.NumberFormat("ja-JP", {currency:"JPY"})`で表示する。
- `dl`でラベルと値を対応させる。
- 読み上げ順は中央値→件数→完全性→min/max。

### 9.9 テスト・HITL受入条件

- 中央値を推奨買取価格と誤解しない。
- 実際の取得期間が一読で分かる。
- 部分取得を直近90日の完全取得と誤認しない。
- 採用候補へ戻って計算根拠を確認できる。
- 外れ値除外前後の中央値と除外内訳を確認できる。
- 自動除外から手動復帰した候補を識別できる。

## 10. MP-06 検索履歴

### 10.1 画面定義

| 項目 | 内容 |
| --- | --- |
| Page ID | MP-06 |
| URL | `/market-price?view=history` |
| 目的 | 過去検索を探し、結果確認または再検索を行う |
| 最初に認識する情報 | 検索日時、商品ラベル、状態、中央値、完全性 |
| Primary Action | 選択した結果を見る |

### 10.2 レイアウト

- PC：履歴一覧4列＋選択結果8列。
- Tablet：一覧3列＋詳細5列。
- Smartphone：Filter→履歴Card→保存済みMP-05へ遷移。

### 10.3 Filter・sort

| 項目 | 値 |
| --- | --- |
| 期間 | 7日／30日／90日／全期間 |
| 状態 | 完了／部分取得／取得停止／失敗 |
| 入力方法 | 画像／手入力 |
| 検索語 | 商品ラベル・ブランド・型番 |
| sort | 新しい順／古い順／中央値高い順／低い順 |

検索語はURLの`q`へ保存してよいが、個人情報や画像情報は含めない。

### 10.4 履歴行

- 商品ラベル
- 検索日時
- 入力方法
- 参考中央値
- 集計件数
- 取得完全性
- 状態
- 作成者はmanagerの組織履歴だけ表示

失敗・停止した履歴は価格を表示せず、条件と停止理由分類だけを表示する。

### 10.5 Action

| Action | Enabled | Result |
| --- | --- | --- |
| 結果を見る | resultあり | MP-05 |
| 現在時点で再検索 | read＋search | 新searchIdでMP-03 |
| 条件を編集 | search | MP-01 prefilled |
| 新しい相場を調べる | search | MP-01 blank |

### 10.6 状態

- `initial`：既定Filter。
- `loading`：履歴読込。
- `empty`：条件に一致する履歴0件。
- `success`：一覧表示。
- `partial`：一部履歴の詳細取得失敗。行単位に表示。
- `failure`：一覧取得失敗。
- `retry`：Filterを保持して再試行。
- `forbidden`：履歴件数も表示しない。
- `deleted`：選択履歴だけ削除済み。一覧は維持。

### 10.7 API・監査

- `GET /api/v1/market-price/searches`
- `GET /api/v1/market-price/searches/:id`
- 監査：`result_viewed`、`search_retried`

### 10.8 Motion / accessibility

- Filter Sheetはfocus trap／restore。
- PC一覧はarrow key専用UIにせず、Tabで各結果Linkへ到達可能。
- sort変更時に結果件数を`aria-live=polite`で通知する。

### 10.9 テスト・HITL受入条件

- 保存済み結果と現在時点の再検索を区別できる。
- 失敗履歴を成功結果と誤認しない。
- managerとassessorの閲覧scopeが成立する。
- BackでFilterとscroll位置を復元する。

## 11. 9共通状態マトリクス

| State | MP-01 | MP-02 | MP-03 | MP-04 | MP-05 | MP-06 |
| --- | --- | --- | --- | --- | --- | --- |
| initial | 入力方法 | 手動条件 | 受付直前 | 候補読込前 | canonicalize | 既定Filter |
| loading | upload準備 | AI補助解析 | Job中 | 候補取得 | 結果取得 | 履歴取得 |
| empty | 最近履歴なし | 候補なし | 該当なし | 落札候補0 | 結果なし | 履歴0 |
| success | 入力有効 | 条件確定可能 | 完了 | 候補確認 | 完全結果 | 一覧表示 |
| partial | 一部upload | 一部提案 | 部分取得 | 未達警告 | 範囲内結果 | 行単位欠損 |
| failure | 初期化失敗 | AI補助失敗 | 取得失敗 | 保存失敗 | 計算不整合 | 一覧失敗 |
| retry | 失敗画像再送 | 1回再生成 | 明示再取得 | draft再送 | 再読込 | 条件保持再読込 |
| forbidden | 内容非表示 | 内容非表示 | 条件非表示 | 候補非表示 | 価格非表示 | 件数非表示 |
| deleted | 新規へ | 画像期限切れ | 停止済み | 検索削除 | 期限切れ | 選択行削除 |

## 12. Role / capability / feature flag

| Role | `search` | `read` | `manage` | Scope |
| --- | --- | --- | --- | --- |
| assessor | 可 | 自分 | 不可 | branch＋self |
| manager | 可 | 組織 | 一部可 | organization |
| educator | 原則不可 | 不可 | 不可 | なし |
| content_approver | 不可 | 不可 | 不可 | なし |
| system_admin | 不可 | 運用メタだけ | kill switch | 本文なし |

- Feature flag：`market_price_search`、初期OFF。
- Flag OFF時はNavigationを表示しない。
- 直接URLは404相当。
- Kill switch ON時は過去結果read-only、新規検索を拒否。

## 13. Data / adapter boundary

### 13.1 UIが信用する正本

- 商品候補：`ProductIdentificationSuggestion`
- 商品状態：`MarketPriceConditionFilter`
- 検索状態：`MarketPriceSearchStatus`
- 候補：`MarketPriceCandidate`
- 外れ値設定：`MarketPriceOutlierPolicy`
- 統計：`MarketPriceResult`
- 権限：APIが返すcapability。query roleを使用しない。

### 13.2 Adapter

```text
UI
  → MarketPriceApiClient
      → /api/v1/market-price/*
          → GCP provider

Test
  → MarketPriceApiClient
      → deterministic fixture adapter
```

- productionでfixtureへfallbackしない。
- デモHTMLは独立fixtureであり、実装コードへimportしない。
- AI provider raw responseとYahoo raw HTMLをUI DTOへ含めない。

## 14. 共通Motion / accessibility

- Press：120ms。
- Pane／Tab：220ms。
- Dialog／Sheet：220〜320ms。
- reduced motion：移動量0、opacity 100ms以下。
- reduced transparency：App Bar、Bottom Navigation、Sheetを不透明化。
- contrast more：border、focus、state labelを強調。
- 全操作44×44px以上。
- Focus ringは2px以上。
- Statusを色だけで表現しない。
- 200% zoom、320px幅、画面回転で機能欠落させない。

## 15. テストシナリオ

### 15.1 Component

- 画像file validation。
- IME composition中のsubmit抑止。
- AI補助提案の採用・編集・却下。
- 未確認値の検索開始拒否。
- Keyword strategy切替。
- 商品状態の複数選択、全選択、全解除、0件validation。
- 候補採否と中央値再計算。
- 偶数件中央値。
- 状態グループ別中央値、四分位数、IQR範囲。
- 中央値20%超かつIQR範囲外の自動除外。
- 5件未満の判定不能。
- 自動除外候補の手動復帰と上書き保持。
- 完全／部分取得表示。
- Back復元。
- Dialog focus trap／restore。

### 15.2 API／Integration

- idempotency keyで二重検索を作らない。
- scope外IDを404相当にする。
- system_adminに本文を返さない。
- raw HTML／署名URLをDTOとlogへ含めない。
- 403／429／CAPTCHAでblocked。
- Parser不一致で価格を返さない。
- 90日境界到達判定。
- client/server統計一致。
- 取得元状態ラベルの正規化と取得後再判定。
- 除外順序と除外内訳の一致。

### 15.3 Playwright

- 画像＋AI補助。
- 手入力＋AI補助。
- 手入力のみ。
- AI補助失敗fallback。
- 完全取得。
- 部分取得。
- 候補0件。
- 状態0件validation。
- 状態別外れ値自動除外と手動復帰。
- 少数状態グループの警告。
- 取得拒否。
- 履歴再読込。
- assessor／manager／system_admin。
- Chromium／WebKit。
- 390／834／1440px。
- axe serious／critical 0。

## 16. HITL受入条件

- 6論理ページの目的とPrimary Actionが一意である。
- PCは条件・候補・結果を比較できる。
- Smartphoneは1画面1目的で完結する。
- AI補助とYahoo取得の担当を誤認しない。
- 未確認提案が外部検索へ使われない。
- 商品状態を複数選択でき、0件では検索を開始できない。
- 同一商品候補を人が修正できる。
- 価格外れ値を同じ状態の5件以上、中央値20%超、IQR範囲外で判定する。
- 自動除外候補が一覧から消えず、利用者が集計へ戻せる。
- 除外前後の中央値と除外内訳が一致する。
- 中央値、最低、最高、件数、期間、完全性が読める。
- 部分取得を完全取得と誤認しない。
- 戻る・再読込で入力や判断を失わない。
- 訪問案件反映、推奨買取価格、顧客送信が存在しない。
- デモHTMLと本書の画面名、操作、順序にdriftがない。

## 17. PoC対応

PoCには本機能と同等の過去落札相場検索は存在しない。既存の「金券買取価格表」は静的・管理対象コンテンツであり、本機能へ統合しない。

| PoC／既存機能 | SCR-021との関係 |
| --- | --- |
| 金券買取価格表 | 別機能として維持 |
| 買取支援AI | Navigation上の隣接機能。価格根拠には使わない |
| 訪問前チェック | 今回は連携しない |
| コンテンツ管理 | 相場結果の編集には使わない |
| 監査・運用 | Job異常とkill switchだけ既存管理へ追加 |

## 18. UI実装時の禁止事項

- AI補助がYahooを検索したように表示する。
- AI生成価格を相場へ混ぜる。
- 未確認の型番やカテゴリを自動確定する。
- 部分取得を「直近90日」と断定する。
- 候補採否をAIスコアだけで確定する。
- AI補助が提案した商品状態を利用者確認なしで確定する。
- 商品状態が0件のまま検索を開始する。
- 異なる商品状態を同じ価格分布として外れ値判定する。
- 中央値から20%離れたという理由だけで候補を自動除外する。
- 自動除外候補を一覧から隠す、または手動復帰できなくする。
- 送料や税を推測加算する。
- 結果を「推奨買取価格」「買取保証額」と表示する。
- CAPTCHA回避やProxy切替を利用者へ提案する。
- 訪問案件へ反映するボタンを置く。
- 開発用role、fixture、API切替、SCR IDを通常画面へ表示する。
