# 買取相場（仮） 画面遷移詳細仕様

## 0. 文書情報

| 項目 | 内容 |
| --- | --- |
| 対象 | SCR-021 買取相場（仮） |
| Route | `/market-price` |
| 論理ページ | MP-01〜MP-06 |
| 対象端末 | PC 1440px／Tablet 834px／Smartphone 390px |
| 状態 | ローカル実装済み／GCP未反映／HITL待ち |
| 訪問案件連携 | 対象外 |

## 1. 遷移設計の原則

1. 利用者が認識する工程だけをブラウザ履歴へ積む。
2. Worker状態の細かな変化はURLへ積まず、同じMP-03内で更新する。
3. 自動完了時は`router.replace`を使い、戻る操作で完了済みの待機画面へ戻さない。
4. URLは`searchId`と列挙済み`view`だけを持ち、商品名、検索語、価格、画像URLを含めない。
5. 再読込時はAPIの永続状態を正本とし、URLと不一致ならcanonical viewへ補正する。
6. AI補助を使わない手入力経路を常に維持する。
7. 未確認のAI補助提案からスクレイピングを開始しない。
8. 403、429、CAPTCHA、Parser不一致を回避する遷移を作らない。
9. `partial`を`success`と同じ見た目にしない。
10. PCとSmartphoneでURLと業務状態を共通化し、表示構造だけを変える。

## 2. URL契約

### 2.1 許可するURL

| URL | 表示 |
| --- | --- |
| `/market-price` | MP-01 新規検索 |
| `/market-price?view=input` | MP-01 新規検索 |
| `/market-price?searchId=<UUID>&view=identify` | MP-02 商品候補・条件確認 |
| `/market-price?searchId=<UUID>&view=progress` | MP-03 取得状況 |
| `/market-price?searchId=<UUID>&view=candidates` | MP-04 落札候補確認 |
| `/market-price?searchId=<UUID>&view=result` | MP-05 相場結果 |
| `/market-price?view=history` | MP-06 検索履歴 |

### 2.2 Query規則

- `searchId`はUUIDだけを許可する。
- `view`は`input / identify / progress / candidates / result / history`だけを許可する。
- 不明なQueryは無視し、既知Queryだけでcanonical URLを再構成する。
- `searchId`がない`identify / progress / candidates / result`は`/market-price`へ`replace`する。
- アクセス権のない`searchId`は存在確認情報を漏らさないよう404相当とする。
- 削除済みIDはMP-05の`deleted`状態へcanonicalizeする。
- URLへ画像署名URL、Yahoo URL、AI補助の候補本文を入れない。

### 2.3 API状態からcanonical viewへの対応

| Server state | Canonical view |
| --- | --- |
| identification `draft` | `input` |
| identification `analyzing` | `identify` |
| identification `suggestion_ready` | `identify` |
| identification `confirmation_required` | `identify` |
| identification `confirmed`、search未作成 | `identify` |
| search `queued / fetching / normalizing` | `progress` |
| search `review_required / partial` | `candidates` |
| search `ready`、未確認候補あり | `candidates` |
| search `ready`、集計確定済み | `result` |
| search `blocked / failed` | `progress` |
| resource `deleted / expired` | `result`のdeleted状態 |

## 3. 正常系遷移

### 3.1 画像＋AI補助経路

| No. | From | 操作・契機 | 前提 | To | History操作 | API／副作用 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | AppShell | 「買取相場」 | `market_price:search` | MP-01 | `push` | なし |
| 2 | MP-01 | 「画像から候補を出す」 | なし | MP-01 image mode | 同一URL | なし |
| 3 | MP-01 | 画像追加 | MIME・枚数・容量有効 | MP-01 preview | 同一URL | upload session作成 |
| 4 | MP-01 | 商品状態を複数選択 | 最低1件 | MP-01 valid | 同一URL | client draftだけ更新 |
| 5 | MP-01 | 「AIで商品候補を作る」 | 画像1枚以上、商品状態1件以上 | MP-02 analyzing | `push` | identification作成・解析開始 |
| 6 | MP-02 | 解析完了 | 構造化出力有効 | MP-02 review | 同一URL | suggestion保存 |
| 7 | MP-02 | 候補選択 | 最大1候補 | MP-02 fields | 同一URL | client draftだけ更新 |
| 8 | MP-02 | 項目ごとに採用・編集・却下 | 必須項目と状態が確定 | MP-02 confirmed | 同一URL | confirm API、監査 |
| 9 | MP-02 | 「この条件で検索」 | 未確認値0件、商品状態1件以上 | MP-03 | `push` | search作成、Cloud Task投入 |
| 10 | MP-03 | 取得・正規化完了 | 候補1件以上 | MP-04 | `replace` | 状態再判定、外れ値初期判定、候補保存 |
| 11 | MP-04 | 自動外れ値候補を確認し、必要なら復帰 | 1件以上採用 | MP-04 reviewed | 同一URL | candidate decision保存 |
| 12 | MP-04 | 「相場を確定」 | 価格有効、未決定0件 | MP-05 | `push` | 再計算・結果snapshot保存 |
| 13 | MP-05 | 再読込 | scope有効 | MP-05 | 同一URL | 保存結果取得 |

### 3.2 手入力＋AI補助経路

| From | 操作 | To | 補足 |
| --- | --- | --- | --- |
| MP-01 | 「商品条件から探す」 | MP-01 manual mode | 入力欄を表示 |
| MP-01 | 商品名・ブランド等を入力 | MP-01 dirty | 入力はメモリ内draft |
| MP-01 | 商品状態を複数選択 | MP-01 valid | 初期値は3状態、最低1件 |
| MP-01 | 「AIで入力候補を作る」 | MP-02 | 既知の値を上書きしない |
| MP-02 | 提案値を確認 | MP-02 confirmed | 元入力と提案値を並べる |
| MP-02 | 「この条件で検索」 | MP-03 | 以後は画像経路と同じ |

この経路は補助的な例外ではなく、画像経路と同格の主要検索方法とする。商品名、ブランド、型番、カテゴリなど、利用者が分かる範囲を先に入力し、AI補助は次だけを支援する。

- 未入力項目の候補
- ブランド・型番・シリーズの表記揺れ補正候補
- 商品を絞り込むために追加確認すべき項目
- 厳密／標準／広めの検索キーワード
- 付属品、空箱、別世代、まとめ売りを避ける除外語

手入力済みの値は`利用者入力`として固定し、AI補助の提案は別欄に表示する。提案の採用操作なしに既存値を置換しない。

商品状態は「未使用に近い」「目立った傷や汚れなし」「やや傷や汚れあり」を初期選択とする。利用者は複数選択を変更できるが、最低1件を確定するまでMP-02から検索を開始できない。

### 3.3 AI補助を使わない経路

| From | 操作 | 前提 | To |
| --- | --- | --- | --- |
| MP-01 | 「手入力のまま進む」 | 商品名または型番、カテゴリ、商品状態1件以上が有効 | MP-02 manual confirm |
| MP-02 | 検索語、除外語、商品状態を確認 | 未確認項目なし、商品状態1件以上 | MP-03 |
| MP-03 | 取得完了 | 候補あり | MP-04 |
| MP-04 | 候補確定 | 1件以上採用 | MP-05 |

MP-02を省略しない。AI補助を使用しない場合も、外部アクセス前に最終的な検索語、除外語、商品状態を人が確認する。

### 3.4 履歴経路

| From | 操作 | To | History操作 |
| --- | --- | --- | --- |
| MP-01 | 「検索履歴」 | MP-06 | `push` |
| MP-06 | 履歴を選択 | MP-05 saved result | `push` |
| MP-05 | 「同じ条件で再検索」 | MP-03 new search | `push` |
| MP-05 | 「条件を編集して再検索」 | MP-01 prefilled | `push` |
| MP-06 | 「新しい相場を調べる」 | MP-01 | `push` |

再検索は過去結果を上書きせず、新しい`searchId`を作成する。

## 4. 戻る・キャンセル・離脱

### 4.1 Browser Back

| Current | Back先 | 復元内容 |
| --- | --- | --- |
| MP-02 | MP-01 | 画像thumbnail、手入力draft、入力方法、商品状態の複数選択 |
| MP-03 | MP-02 | 確定条件。Jobはサーバーで継続 |
| MP-04 | MP-02 | MP-03は完了後`replace`済みのため飛ばす |
| MP-05 | MP-04 | 候補採否とスクロール位置 |
| MP-06から開いたMP-05 | MP-06 | Filter、sort、scroll、選択行 |
| 直接URLの下位view | `/market-price` | 安全な親画面 |

### 4.2 明示キャンセル

- AI補助の解析中キャンセルは、可能ならprovider呼出しを停止し、できない場合は結果を破棄する。
- スクレイピング開始後の「画面を閉じる」はJobを止めない。
- Job停止は`market_price:manage`または作成者本人に許可された状態だけ表示する。
- 停止済み検索はMP-03に`cancelled`として表示し、「条件を編集」「新規検索」を提示する。

### 4.3 未保存離脱

次の場合だけ離脱確認を表示する。

- MP-01で画像、手入力、または商品状態の初期値からの変更があり、identification未作成。
- MP-02で提案値を変更し、confirm未保存。
- MP-04で候補採否を変更し、保存応答前。

Job中、保存済み結果閲覧、履歴閲覧では離脱確認を出さない。

Dialog文言：

```text
入力中の内容を破棄しますか？
この画面で追加した画像と未保存の検索条件は失われます。

[入力を続ける] [破棄して移動]
```

## 5. MP-03 非同期状態遷移

```text
queued
  → fetching
      → normalizing
          ├─ review_required → MP-04
          ├─ partial → MP-04（警告付き）
          ├─ ready → MP-04
          ├─ blocked → MP-03
          └─ failed → MP-03

queued / fetching
  → cancelled

retry可能なblocked / failed
  → queued（明示操作、最大1回）
```

### 5.1 状態別UI

| 状態 | 見出し | 説明 | 主操作 |
| --- | --- | --- | --- |
| `queued` | 検索を受け付けました | 順番に処理する | 画面を閉じる |
| `fetching` | 落札情報を確認しています | ページ数ではなく処理段階を表示 | 画面を閉じる |
| `normalizing` | 同一商品候補を整理しています | 重複・除外語・型番を確認中 | 画面を閉じる |
| `review_required` | 候補を確認できます | 人の確認が必要 | 候補を確認 |
| `partial` | 取得できた範囲を確認できます | 未取得範囲を明記 | 候補を確認 |
| `blocked` | 取得を停止しました | 403／429／CAPTCHA等の分類文 | 条件編集または後で再試行 |
| `failed` | 処理を完了できませんでした | Parser不一致等。誤価格を出さない | 条件編集または再試行 |
| `cancelled` | 検索を中止しました | 保存済み条件は残す | 条件を編集 |

数値の進捗率、残り時間、完了予定時刻を推測表示しない。

## 6. 例外・復旧遷移

### 6.1 AI補助（実装provider：Vertex AI Gemini）

| 例外 | 遷移 | 保存 | 利用者向け復旧 |
| --- | --- | --- | --- |
| 画像不正 | MP-01 failure | 画像を保存しない | 別画像を選択 |
| 低確信度 | MP-02 success＋warning | 候補とunknown | 手入力で補う |
| 複数候補 | MP-02 success | 最大3件 | 1件選ぶ／該当なし |
| schema不正 | MP-02 retry | raw responseは保存しない | 1回再生成後、手入力 |
| timeout | MP-01 manual fallback | 入力draft | 手入力のまま進む |
| provider停止 | MP-01 failure | 入力draft | AI補助なしで進む |

### 6.2 スクレイピング

| 例外 | 遷移 | 結果表示 | 再試行 |
| --- | --- | --- | --- |
| 一時的network error | MP-03 retry | なし | Worker自動1回＋明示1回 |
| 429＋Retry-After | MP-03 blocked/retry | なし | 指定時刻後のみ |
| 403 | MP-03 blocked | なし | 自動再試行なし |
| CAPTCHA | MP-03 blocked | なし | 回避しない |
| Parser不一致 | MP-03 failed | 価格を出さない | Parser修正後のみ |
| ページ上限 | MP-04 partial | 取得範囲だけ | 条件を狭める |
| 候補0件 | MP-04 empty | 統計なし | 条件を広げる |
| 価格不正 | MP-04 partial | 不正候補を除外 | 候補確認 |
| 選択した商品状態の候補0件 | MP-04 empty | 統計なし | 状態条件を広げる |

### 6.3 候補・統計

| 例外 | 遷移 | 復旧 |
| --- | --- | --- |
| 採用0件 | MP-04 validation | 1件以上選択または条件再検索 |
| 税表示混在 | MP-04 warning | 候補を確認。自動補正しない |
| 同じ状態が5件未満 | MP-04 warning | 自動除外せず、比較件数不足を表示 |
| 中央値20%超だがIQR範囲内 | MP-04 notice | 集計へ含めたまま乖離率を表示 |
| 中央値20%超かつIQR範囲外 | MP-04 auto excluded | 一覧に残し、利用者が集計へ戻せる |
| 再計算競合 | MP-04 conflict | 最新候補を再取得して再適用 |
| 保存失敗 | MP-04 retry | 採否draftを保持して再送 |

## 7. 認証・権限遷移

| 条件 | 遷移 | 情報表示 |
| --- | --- | --- |
| 未認証 | `/login?returnTo=<encoded safe path>` | 商品情報なし |
| token期限切れ | token refresh後に同じ操作を1回再送 | 二重検索を作らない |
| `market_price:read`なし | 共通forbidden | 検索有無・価格・作成者を出さない |
| scope外`searchId` | 404相当 | 存在を推測できない |
| feature flag OFF | 404相当またはナビ非表示 | 機能の存在を通常利用者へ露出しない |
| kill switch ON | MP-01 read-only | 過去結果は読める。新規検索不可 |
| system_admin | 運用メタ情報だけ | 商品名、画像、候補、価格本文を表示しない |

`returnTo`は同一originかつ許可Routeだけを受け入れる。

## 8. PC／Tablet／Smartphoneの遷移差

### 8.1 PC

- Page遷移ではなく、中央ペインの入替として感じられるようにする。
- URLはSmartphoneと同じく更新する。
- MP-04候補変更時にMP-05統計を右ペインで即時更新する。
- MP-01の条件は検索後も左ペインに残す。
- MP-06は一覧4列＋結果8列で表示する。

### 8.2 Tablet

- 条件／候補／結果のSegmented Tabを使用する。
- MP-04＋MP-05は横幅が確保できる場合だけ2ペインにする。
- Railと内部Tabのactive状態を重複させない。

### 8.3 Smartphone

- `view`ごとに1つの主見出しと1つのPrimary Actionを持つ。
- App Barに戻る、ページ名、工程番号を表示する。
- MP-03の自動完了はMP-04へ`replace`する。
- MP-04ではSticky SummaryとSticky ActionをBottom Navigationの上に置く。
- ソフトウェアキーボード表示中はSticky Actionを隠さず、入力欄を可視領域へscrollする。

## 9. Focus・Keyboard・Dialog

| 遷移 | Focus移動 |
| --- | --- |
| ページ遷移 | `main h1`または状態見出しへ移動 |
| AI補助の候補表示 | `aria-live=polite`で完了通知、focusは移動しない |
| Validation失敗 | 最初のエラー項目へ移動 |
| Candidate除外 | 操作ボタンにfocusを維持 |
| 再計算 | 結果summaryを`aria-live=polite`で更新 |
| Dialog open | Dialog見出しまたは安全側ボタンへ移動 |
| Dialog close | 起点ボタンへrestore |
| Sheet open | focus trap。背景をinert化 |

EscapeはDialog／Sheetを閉じる。処理開始、候補保存、相場確定はEscapeだけで取り消さない。

## 10. 監査イベントと遷移の対応

| 遷移 | Event |
| --- | --- |
| MP-01→MP-02 | `market_price.identification_started` |
| AI補助完了 | `market_price.identification_completed` |
| 提案採否 | `market_price.suggestion_decided` |
| MP-02→MP-03 | `market_price.search_started` |
| 取得拒否 | `market_price.scrape_blocked` |
| 候補採否変更 | `market_price.candidate_decided` |
| 商品状態確定 | `market_price.condition_filter_confirmed` |
| 外れ値判定 | `market_price.outlier_evaluated` |
| 自動除外候補の復帰 | `market_price.candidate_restored` |
| MP-04→MP-05 | `market_price.stats_calculated` |
| MP-05表示 | `market_price.result_viewed` |
| 再検索 | `market_price.search_retried` |

監査にはID、分類、件数、状態、時刻だけを記録し、画像、検索語、生HTML、署名URLを含めない。

## 11. 画面遷移E2Eシナリオ

### E2E-MP-01 画像＋AI補助＋完全取得

1. `/market-price`を開く。
2. 画像2枚を追加する。
3. AI補助の候補を生成する。
4. 2番目の商品候補を選ぶ。
5. 型番を編集して採用する。
6. 標準キーワードを選ぶ。
7. 初期3状態から「目立った傷や汚れなし」を含む複数状態を確定する。
8. 検索を開始する。
9. MP-03からMP-04へ自動補正される。
10. 空箱候補を除外する。
11. 同一状態5件以上の価格外れ値候補が自動除外される。
12. 自動除外候補を集計へ戻し、中央値が再計算される。
13. 相場を確定する。
14. 再読込後もMP-05が復元される。

### E2E-MP-02 手入力・AI補助未使用

1. 商品名、カテゴリ、型番を入力する。
2. 商品状態を2件選択する。
3. 「手入力のまま進む」を選ぶ。
4. 検索語、除外語、商品状態を確認する。
5. 検索を開始する。
6. 候補を確認して結果へ進む。
7. Gemini provider APIが呼ばれていないことを確認する。

### E2E-MP-03 部分取得

1. 90日境界到達前にページ上限へ達するfixtureで検索する。
2. MP-04に取得範囲の警告が表示される。
3. MP-05が「取得範囲内の参考中央値」と表示される。
4. 「直近90日の取得完了」が表示されない。

### E2E-MP-04 取得拒否

1. CAPTCHA fixtureで検索する。
2. MP-03 blockedへ遷移する。
3. 価格結果が生成されない。
4. 自動回避やProxy切替が起きない。

### E2E-MP-05 戻る・再読込

1. MP-05からBrowser Backする。
2. MP-04の採否とscroll位置を復元する。
3. 直接MP-05 URLを開く。
4. API状態から結果を復元する。
5. scope外IDでは404相当となる。

### E2E-MP-06 Mobile

1. 390px WebKitでMP-01からMP-05まで進む。
2. 各段階で主目的が1つだけ表示される。
3. Bottom NavigationとSticky Actionが重ならない。
4. 戻る操作がMP-05→04→02→01となる。
5. 横スクロールが発生しない。

### E2E-MP-07 商品状態・外れ値判定

1. 商品状態をすべて解除し、検索開始が拒否されることを確認する。
2. 「目立った傷や汚れなし」を選び、同状態の候補8件を取得する。
3. 状態別中央値から20%を超え、IQR範囲外の高値候補が自動除外される。
4. 別状態の安値候補が同じ分布で外れ値判定されない。
5. 自動除外候補を手動で集計へ戻し、除外前後の中央値と内訳が更新される。
6. 4件fixtureでは自動除外されず、判定不能の警告だけが表示される。

## 12. HITL確認項目

- 画像経路と手入力経路の違いが一読で分かる。
- AI補助が任意であり、落札情報を取得しないことを理解できる。
- 外部アクセス前に検索条件を確認できる。
- 商品状態を複数選択でき、0件のまま進めない。
- 取得待ちでページを閉じてよいことが分かる。
- 部分取得と完全取得を誤認しない。
- 候補を除外すると中央値が変わる理由が分かる。
- 20%単独ではなく状態別中央値・IQR・5件以上で外れ値が判定されると分かる。
- 自動除外候補を一覧から集計へ戻せる。
- Browser Backで入力や選択を失わない。
- Smartphoneで現在工程と次の操作を迷わない。
- 取得拒否時に回避を促すUIがない。
- 訪問案件へ反映する操作が存在しない。
