# 買取支援ツール「買取相場（仮）」機能企画書

## 0. 文書情報

| 項目 | 内容 |
| --- | --- |
| 文書種別 | 新機能企画書・ローカル実装同期設計 |
| 対象プロダクト | 買取支援ツール GCP版 |
| 対象機能 | 買取相場（仮） |
| 新規画面 | SCR-021 |
| Route | `/market-price` |
| 作成日 | 2026-09-09 |
| 現在状態 | SCR-021のローカルフル実装済み・検証中。GCPは未反映 |
| 価格取得方式 | Yahoo!オークション公開ページの専用Workerによるスクレイピング |
| AI利用 | Vertex AI Geminiによる任意の商品特定・検索条件作成支援 |
| 利用者向けAI表示名 | `AI補助`。画面上に`Gemini`を表示しない |
| 訪問案件連携 | 今回は対象外 |
| 正式な買取価格決定 | 今回は対象外 |

本書は実装企画とユーザー動線を定義する。URL Generator、AIパラメータ補助、API、DB migration、Worker、監視、Next.js画面はローカル実装へ反映済みである。GCPと公開環境には反映していない。

利用者向け画面では、provider固有名の`Gemini`ではなく`AI補助`と表示する。`Gemini`は技術設計、設定、監視など実装内部の名称に限定する。

---

## 1. 企画概要

査定員が商品名、型番、商品画像などを入力し、Yahoo!オークションの直近90日の落札情報から、同一商品候補の最低価格・中央値・最高価格を確認できる独立機能を追加する。

商品特定と検索条件作成にはVertex AI Geminiを任意で利用できる。ただし、GeminiはYahoo!オークションへアクセスせず、相場価格も生成しない。実際の落札情報は専用スクレイピングWorkerが公開ページから取得し、決定的なバックエンド処理で集計する。

利用者はGeminiが提案した商品候補、商品属性、検索キーワードを項目単位で採用・編集・却下する。未確認の推定値をスクレイピング条件へ自動投入しない。

### 1.1 機能コンセプト

> 写真または分かる範囲の商品情報から、同一商品の落札実績を安全に絞り込み、根拠を確認しながら相場の分布を把握する。

### 1.2 主要な設計原則

- Geminiは商品特定と入力補助に限定する。
- Yahoo!オークションの取得は専用Workerだけが行う。
- Geminiの推定値を利用者確認なしに確定しない。
- 価格根拠は実際に取得した落札商品だけに限定する。
- 同一商品候補の採否を利用者が変更できる。
- 直近90日分を取得できなかった場合は、その事実を結果へ明示する。
- 403、429、CAPTCHA、アクセス拒否を回避しない。
- 訪問案件、顧客情報、録音、文字起こしとは接続しない。
- 既存の金券価格表は変更しない。

---

## 2. 背景と解決する課題

### 2.1 現在の課題

- 査定員が外部サイトを個別に検索し、複数の落札情報を目視で比較している。
- 表記揺れ、型番差、付属品のみ、ジャンク、まとめ売りが混在しやすい。
- 最高値だけ、または目についた数件だけで相場を判断する可能性がある。
- 同一商品を特定するための商品知識が利用者ごとに異なる。
- 商品画像はあるが、正式名称や型番が分からないケースがある。
- 取得対象期間と実際に取得できた期間が混同されやすい。

### 2.2 解決方針

- 商品検索条件を構造化する。
- 画像または部分入力からGeminiが商品候補を提案する。
- 検索キーワードを厳密・標準・広めの3段階で提案する。
- スクレイピング結果を同一商品候補として整理する。
- 利用者が候補を確認してから統計値を確定する。
- 中央値を主要指標とし、最低値・最高値・件数・期間も併記する。
- 元商品URLと計算時点を保持し、数字の根拠を追跡可能にする。

---

## 3. ゴールと対象外

### 3.1 ゴール

- 査定員がPC・スマートフォンのどちらからでも単独で利用できる。
- 画像しかない場合でも商品候補と検索条件を作成できる。
- 手入力中にもGeminiの予測サポートを任意で利用できる。
- Geminiを利用せず、手入力だけでも検索を完了できる。
- 同一商品候補を確認・除外して統計値を再計算できる。
- 直近90日の取得完全性を機械判定できる。
- 検索履歴と候補採否を再読込後も復元できる。
- 組織・所属範囲に基づくRBACと監査を適用する。

### 3.2 対象外

- 訪問案件への検索結果反映
- 顧客情報との紐付け
- 推奨買取価格の自動決定
- 粗利率、在庫回転、販売手数料、送料を含む買取上限計算
- Aucfan API・画面の利用
- GeminiによるYahoo検索、Google検索、Grounding検索
- Geminiが記憶または推測した価格の利用
- Yahooアカウントでのログイン
- 非公開ページ、個人ページ、出品者情報の取得
- CAPTCHA回避、Proxy rotation、stealth plugin、IP分散
- Yahooへ商品画像を送信する逆画像検索
- 定期的な全件クロール、データ販売、外部提供

---

## 4. プロダクト内の位置付け

既存の全20画面へ、独立画面`SCR-021 買取相場（仮）`を追加する。

| 項目 | 方針 |
| --- | --- |
| PC Sidebar | 「買取支援AI」の次に「買取相場」を追加 |
| Mobile Bottom Navigation | ホーム／相場／訪問／振り返り／その他 |
| 既存「現場の知識」 | Mobileでは「その他」へ移動、PCでは従来どおり表示 |
| 既存金券価格表 | `/knowledge/reference`に維持 |
| 新機能 | `/market-price`に独立配置 |
| 通常導線 | 査定員・管理者が利用可能 |
| Feature Flag | `market_price_search`。初期値OFF |

---

## 5. ユーザー動線

### 5.1 全体フロー

```text
買取相場を開く
  ↓
入力方法を選択
  ├─ 商品画像を追加
  └─ 商品条件を手入力
          ↓
AI補助を任意実行
          ↓
商品候補・項目・検索キーワードを個別確認
          ↓
利用者が採用・編集・却下し、商品状態を複数選択
          ↓
確認済み条件でスクレイピング開始
          ↓
直近90日の落札候補を取得
          ↓
同一商品候補と価格外れ値候補を確認・除外／復帰
          ↓
除外前後の中央値、最低値、最高値を再計算
          ↓
検索履歴へ保存
```

### 5.2 画像から探す

1. 「画像から候補を出す」を選択する。
2. カメラ撮影または写真ライブラリから商品画像を最大5枚追加する。
3. 正面、背面、ブランドロゴ、型番ラベル、付属品などを確認する。
4. 分かる範囲の補足情報を入力する。
5. 「AIで商品候補を作る」を押す。
6. 最大3件の商品候補を確認する。
7. 商品候補を1件選択するか、「該当なし」を選ぶ。
8. AI補助が提案した商品属性と検索語を個別に確認する。
9. 「この条件で検索」を押す。
10. スクレイピング結果を確認する。

### 5.3 手入力から探す

1. 「商品条件から探す」を選択する。
2. 商品名、ブランド、型番など、分かる項目だけ入力する。
3. 次のどちらかを選ぶ。
   - 「AIで入力候補を作る」
   - 「手入力のまま進む」
4. AI補助を利用した場合は、提案された各項目を採用・編集・却下する。
5. 検索キーワードを選択または編集する。
6. 「この条件で検索」を押す。
7. スクレイピング結果を確認する。

### 5.4 検索履歴から再開する

1. `/market-price`内の「検索履歴」を開く。
2. 過去の検索条件、取得日時、状態、中央値を確認する。
3. 履歴を開き、採用候補と除外候補を復元する。
4. 次のどちらかを選択する。
   - 保存済み結果を確認
   - 現在時点で再検索

商品名や価格はURLへ直接含めず、検索IDだけを使用する。

```text
/market-price
/market-price?searchId=<UUID>&view=identify
/market-price?searchId=<UUID>&view=candidates
/market-price?searchId=<UUID>&view=result
```

---

## 6. PC・Tablet・Mobile UI

### 6.1 PC 1440px

3ペイン構成とする。

| 左3列 | 中央5列 | 右4列 |
| --- | --- | --- |
| 画像・検索条件・履歴 | AI補助候補または落札候補 | 確定条件または相場結果 |

- 条件と結果を同時に比較できる。
- AI補助候補の確認後は、中央ペインを落札候補一覧へ切り替える。
- 右ペインの中央値、最低値、最高値は候補採否に応じて即時更新する。

### 6.2 Tablet 834px

- 条件／候補／結果を上部タブで切り替える。
- 候補一覧と相場結果は2ペイン表示も可能とする。
- SidebarはNavigation Railへ縮退する。

### 6.3 Smartphone 360〜430px

4ステップ構成とする。

1. 入力方法
2. 画像・商品条件
3. AI補助候補・検索条件確認
4. 落札候補・相場結果

- Bottom Navigationの「相場」から1タップで到達する。
- 主要操作はSticky Actionとする。
- 画像は横スクロール可能なサムネイル列にする。
- AI補助候補は1件ずつカード表示する。
- 落札候補はTableではなくlabel-valueカードにする。
- 候補採否を切り替えると、Sticky Summaryの中央値と件数を更新する。
- ブラウザの戻る操作では、結果→候補→商品確認→入力の順に戻る。

---

## 7. 商品検索条件

### 7.1 入力項目

| 項目 | 必須 | AI補助提案 | 備考 |
| --- | --- | --- | --- |
| 商品名または型番 | 条件付き必須 | 可 | どちらかが必要 |
| カテゴリ | 必須 | 可 | 確定前に利用者確認 |
| ブランド・メーカー | 任意 | 可 | 表記揺れ正規化 |
| 型番 | 任意 | 可 | 画像推定だけで確定しない |
| シリーズ | 任意 | 可 | 型番が不明な場合に利用 |
| 色 | 任意 | 可 | 価格差が大きいカテゴリで利用 |
| サイズ・容量 | 任意 | 可 | バッグ、機器など |
| バリエーション | 任意 | 可 | 世代、限定版など |
| 商品状態 | 必須 | 可 | 複数選択。最低1件を利用者が確定する |
| 付属品 | 任意 | 可 | 本体と付属品のみを分離 |
| 含めるキーワード | 任意 | 可 | 複数指定 |
| 除外キーワード | 任意 | 可 | 複数指定 |
| 対象期間 | 固定 | 不可 | 初期版は直近90日 |

### 7.2 商品状態の複数選択

検索入口で、Yahoo!オークションの状態区分に合わせた次の選択肢を複数選択できるようにする。

```ts
type ProductCondition =
  | "unused"
  | "near_unused"
  | "good"
  | "fair"
  | "poor"
  | "very_poor"
  | "unspecified";
```

| 値 | 表示名 | 初期選択 |
| --- | --- | --- |
| `unused` | 未使用 | なし |
| `near_unused` | 未使用に近い | あり |
| `good` | 目立った傷や汚れなし | あり |
| `fair` | やや傷や汚れあり | あり |
| `poor` | 傷や汚れあり | なし |
| `very_poor` | 全体的に状態が悪い | なし |
| `unspecified` | 状態の記載なし | なし |

- 初期値は実務上比較対象にしやすい3状態とし、「状態の記載なし」は既定で除外する。
- 最低1件を必須とし、0件のまま検索を開始できない。
- 「すべて選択」「選択を解除」を提供する。全解除後はエラーと復旧方法を選択欄の直下へ表示する。
- AI補助は画像と手入力から状態候補を提案できるが、自動確定しない。利用者が追加・削除して確定する。
- 取得元が状態絞り込みを提供する場合は検索条件へ反映し、取得後も正規化済み状態で再判定する。
- 取得元の状態ラベルを上記列挙値へ対応付けられない場合は`unspecified`とし、利用者が選択していない限り集計対象へ入れない。
- 状態条件は検索履歴と再検索条件へ保存し、URLには直接含めない。

### 7.3 初期除外候補

- ジャンク
- 部品取り
- 箱のみ
- 空箱
- ケースのみ
- 説明書のみ
- 互換品
- まとめ売り
- 大量
- セット
- 修理用

除外語はカテゴリ別に調整し、利用者が削除・追加できる。

---

## 8. AI補助設計

### 8.1 AI補助の役割

- 商品画像の視覚的特徴を抽出する。
- ブランド、商品名、型番、シリーズ、仕様の候補を生成する。
- 不足している確認項目を提示する。
- Yahoo検索向けキーワード候補を生成する。
- 付属品のみ、別世代、類似モデルを区別するための除外語を提案する。
- 複数の商品候補を最大3件まで提示する。

### 8.2 AI補助が行わないこと

- Yahoo!オークションの閲覧
- Web検索・Groundingによる価格取得
- 相場価格、買取価格、落札価格の生成
- 商品候補の自動確定
- 真贋判定の確定
- 型番や状態の不明部分の捏造
- 未確認値によるスクレイピング開始

### 8.3 検索キーワード提案

商品候補ごとに次の3種を提案する。

| 種類 | 目的 | 例 |
| --- | --- | --- |
| 厳密 | 同一商品精度を優先 | `Canon EOS R6 ボディ` |
| 標準 | 表記揺れを吸収 | `Canon EOS R6 ミラーレス` |
| 広め | 候補不足時の再検索 | `Canon EOS Rシリーズ カメラ` |

利用者は1件を選択するか、自由編集できる。広めの検索を利用した場合は、落札候補の人手確認を必須とする。

### 8.4 項目単位の確認

各提案値に次を表示する。

- 現在値
- AI補助の提案値
- 観察できた根拠
- 確信度：高／中／低
- 採用
- 編集して採用
- 却下
- 未確認

詳細な思考過程は要求・保存しない。画像上で確認できるロゴ、ラベル、形状などの観察事実だけを保持する。

### 8.5 失敗時のフォールバック

| 状態 | 利用者動線 |
| --- | --- |
| 商品を特定できない | 手入力へ戻る |
| 複数候補 | 利用者が1件を選択 |
| 型番不鮮明 | 空欄または要確認 |
| AI補助タイムアウト | 入力内容を保持して手入力検索 |
| 構造化出力不正 | 1回だけ再生成し、その後は手入力 |
| 安全性フィルタで応答なし | 画像変更または手入力 |
| AI補助停止中 | 機能を隠さず「現在利用不可」と表示し手入力を提供 |

---

## 9. 画像アップロード

### 9.1 受付条件

- MIME：`image/jpeg`、`image/png`、`image/webp`
- 最大5枚
- 1枚10MBまで
- 画像全体の上限50MB
- 破損画像、実行ファイル偽装、対応外MIMEを拒否

### 9.2 保存とプライバシー

- private GCSへ直接アップロードする。
- 短時間の署名URLを使用する。
- サーバー側でEXIF・GPSを除去する。
- ブラウザのlocalStorageへ保存しない。
- Base64画像や署名URLをログへ出さない。
- 一時画像は24時間以内に自動削除する。
- 解析完了後は画像の再利用を行わない。
- 顔、住所、本人確認書類、顧客情報が写っている可能性をアップロード前に警告する。
- シリアル番号を検索キーワードへ自動追加しない。
- Yahoo側へ画像を送信しない。

---

## 10. スクレイピングと価格取得

### 10.1 責任分離

| 処理 | 実行主体 |
| --- | --- |
| 商品特定・入力候補 | Gemini |
| 候補と条件の確定 | 利用者 |
| 商品状態の提案 | AI補助 |
| 商品状態の確定 | 利用者 |
| Yahooアクセス | 専用スクレイピングWorker |
| HTML解析・ページング | 専用スクレイピングWorker |
| 同一商品・商品状態ルール判定 | バックエンド |
| 外れ値候補判定 | 決定的なバックエンド計算 |
| 候補採否の最終判断 | 利用者 |
| 最低値・中央値・最高値 | 決定的なバックエンド計算 |

### 10.2 初期取得制御

- グローバル同時実行：1
- 組織単位の同時検索：1
- 1ページごとの最低間隔：5秒
- 1検索の最大取得ページ数：20
- 同一正規化クエリのキャッシュ：24時間
- `Retry-After`を尊重する。
- 403、継続する429、CAPTCHAで停止する。
- HTML構造がParser契約と異なる場合は結果を生成しない。
- エラー時にProxyや別アカウントへ切り替えない。

数値は初期値であり、固定Stageでの計測と取得元の許可条件に基づいて変更する。

### 10.3 取得する最小データ

- Yahoo商品ID
- 正規化した元URL
- 商品タイトル
- 落札価格
- 落札日時
- 画面上の商品状態
- 税表示状態
- 同一商品判定に必要な最小属性
- 取得日時
- Parser version
- Content hash

出品者情報、入札者情報、画像、説明本文、生HTMLは永続保存しない。

### 10.4 処理状態

```ts
type MarketPriceSearchStatus =
  | "queued"
  | "fetching"
  | "normalizing"
  | "review_required"
  | "ready"
  | "partial"
  | "blocked"
  | "failed";
```

---

## 11. 同一商品判定

### 11.1 決定的判定

1. Unicode NFKC正規化を行う。
2. 大文字小文字、空白、ハイフンの差を吸収する。
3. ブランド・メーカーを照合する。
4. 型番を照合する。
5. 世代、シリーズ、容量、サイズ、色を照合する。
6. 取得元の商品状態を`ProductCondition`へ正規化し、選択状態との一致を判定する。
7. 本体と付属品のみを分離する。
8. 単品とまとめ売りを分離する。
9. ジャンク、部品取りなどの除外語を判定する。
10. Yahoo商品IDとContent hashで重複を排除する。

### 11.2 候補表示

候補ごとに次を表示する。

- 商品タイトル
- 落札価格
- 落札日
- 商品状態
- 一致度
- 一致理由
- 除外理由
- 状態別中央値からの乖離率
- IQR判定
- 自動外れ値候補／手動変更の状態
- 元ページリンク
- 集計に含める／除外する

AIスコアだけで集計対象を確定しない。利用者が採否を変更した場合は、変更後の集合で即時再計算する。

---

## 12. 統計値

### 12.1 集計対象

- 落札済み
- 日本円
- 対象期間内
- 重複商品IDではない
- 価格解析が成功している
- 同一商品候補である
- 利用者が選択した商品状態に一致する
- 利用者が除外していない

### 12.2 計算

- 最低値：採用候補の最小落札価格
- 最高値：採用候補の最大落札価格
- 中央値：昇順に並べ、奇数件は中央1件、偶数件は中央2件の平均
- 送料：合算しない
- 税：表示状態を候補ごとに保持し、混在時は警告
- 外れ値の基準値：同じ商品状態の候補群ごとの中央値
- 乖離率：`abs(落札価格 - 状態別中央値) / 状態別中央値`

### 12.3 価格外れ値の判定と除外

20%は外れ値の一次検知閾値とし、それだけで自動除外しない。次のすべてを満たす場合だけ、自動外れ値候補として集計対象から除外する。

1. キーワード、同一商品、重複、商品状態による除外後の同一状態グループが5件以上ある。
2. 状態別中央値からの乖離率が設定値を超える。初期値は`20%`とする。
3. 落札価格がTukey法の範囲`Q1 - 1.5 × IQR`未満、または`Q3 + 1.5 × IQR`を超える。
4. 「明らかな価格外れ値を自動除外」が有効である。

四分位数は、価格を昇順に並べ、奇数件では全体中央値を上下の群から除いたうえで各群の中央値を`Q1`、`Q3`とする。偶数件では下半分・上半分の中央値を使用する。計算法はバックエンドと画面デモで共通fixtureにより固定する。

- 5件未満の状態グループでは自動除外せず、「比較件数が少ないため判定できません」と表示する。
- 異なる商品状態を同じ分布へ混ぜない。状態差による正当な価格差を外れ値と誤判定しないためである。
- 自動除外された候補は一覧から消さず、理由、状態別中央値、乖離率、IQR範囲を表示する。
- 利用者は自動除外候補を集計へ戻せる。また、非外れ値候補を手動除外できる。
- 利用者の手動判断は自動判定より優先し、再計算後も保持する。「自動判定に戻す」を選んだ場合だけ手動上書きを解除する。
- 閾値を変更した場合、自動判定対象だけを再評価し、手動上書きは変更しない。
- 除外順序は、キーワード／同一商品／重複→商品状態→価格外れ値→利用者判断とする。

### 12.4 結果表示

中央値を主要指標とする。

```text
落札価格の参考中央値　¥84,500
外れ値除外前の中央値　¥85,500
最低値　　　　　　　¥72,000
最高値　　　　　　　¥103,000
集計対象　　　　　　18件
除外　　　　　　　　7件
除外内訳　　　　　　キーワード3／状態1／価格外れ値2／手動1
取得期間　　　　　　2026-03-09〜2026-09-09
取得完全性　　　　　直近90日の取得完了
```

「推奨買取価格」「買取保証額」とは表示しない。

外れ値除外前後の中央値を併記し、統計値がどの候補集合から計算されたかを明示する。自動除外候補を利用者が戻した場合は、結果へ「手動で集計へ復帰」の件数を表示する。

---

## 13. 直近90日の取得完全性

次のどちらかを確認できた場合だけ`complete`とする。

- 取得した最古の商品が期間開始日より前まで到達した。
- ページ末尾まで到達し、それ以上の落札結果が存在しないことを確認した。

途中でページ上限、403、429、CAPTCHA、構造変更が発生した場合は`partial`または`blocked`とする。

```text
取得範囲内の参考中央値
取得期間：2026-06-12〜2026-09-09
直近90日の取得完了は確認できていません
```

部分取得を「直近90日の相場」と表示しない。

---

## 14. API契約

### 14.1 商品特定

| Method | Endpoint | 用途 |
| --- | --- | --- |
| POST | `/api/v1/market-price/identifications` | 商品特定セッション作成 |
| POST | `/api/v1/market-price/identifications/:id/uploads` | 画像アップロード受付 |
| POST | `/api/v1/market-price/identifications/:id/analyze` | Gemini解析開始 |
| GET | `/api/v1/market-price/identifications/:id` | 候補・状態取得 |
| PATCH | `/api/v1/market-price/identifications/:id/confirm` | 候補・項目・検索語の確定 |

### 14.2 相場検索

| Method | Endpoint | 用途 |
| --- | --- | --- |
| POST | `/api/v1/market-price/searches` | 検索開始 |
| GET | `/api/v1/market-price/searches` | 検索履歴 |
| GET | `/api/v1/market-price/searches/:id` | 状態・候補・結果 |
| PATCH | `/api/v1/market-price/searches/:id/candidates/:candidateId` | 候補採否変更 |
| POST | `/api/v1/market-price/searches/:id/recalculate` | 再計算 |
| POST | `/api/v1/market-price/searches/:id/retry` | 明示的な再取得 |

### 14.3 主要DTO

```ts
interface ProductIdentificationSuggestion {
  identificationId: string;
  status:
    | "analyzing"
    | "suggestion_ready"
    | "confirmation_required"
    | "confirmed"
    | "failed";
  candidates: ProductCandidate[];
  suggestedFields: SuggestedField[];
  searchQueries: SearchQuerySuggestion[];
  excludeKeywords: string[];
  unknownFields: string[];
  warnings: string[];
  model: string;
  generatedAt: string;
}

interface MarketPriceConditionFilter {
  conditions: ProductCondition[];
}

interface MarketPriceOutlierPolicy {
  enabled: boolean;
  basis: "median";
  thresholdRate: number;
  method: "median_and_iqr";
  minimumGroupSize: 5;
  groupBy: "condition";
}

interface MarketPriceExclusionCounts {
  keyword: number;
  condition: number;
  priceOutlier: number;
  manual: number;
  restored: number;
}

interface MarketPriceCandidate {
  id: string;
  title: string;
  closingPrice: number;
  sourceConditionLabel: string | null;
  normalizedCondition: ProductCondition;
  conditionMatched: boolean;
  conditionGroupCount: number;
  conditionMedianPrice: number | null;
  deviationRate: number | null;
  iqrLowerBound: number | null;
  iqrUpperBound: number | null;
  autoOutlier: boolean;
  inclusionOverride: "include" | "exclude" | null;
  included: boolean;
  exclusionReasons: string[];
}

interface MarketPriceResult {
  searchId: string;
  status: MarketPriceSearchStatus;
  minimumPrice: number | null;
  medianPriceBeforeOutlierExclusion: number | null;
  medianPrice: number | null;
  maximumPrice: number | null;
  includedCount: number;
  excludedCount: number;
  exclusions: MarketPriceExclusionCounts;
  conditionFilter: MarketPriceConditionFilter;
  outlierPolicy: MarketPriceOutlierPolicy;
  periodStart: string;
  periodEnd: string;
  coverage: "complete" | "partial" | "blocked";
  candidates: MarketPriceCandidate[];
  calculatedAt: string | null;
}
```

---

## 15. DB設計

### 15.1 `market_price_identifications`

- `id`
- `organization_id`
- `branch_id`
- `created_by_membership_id`
- `status`
- `input_redacted`
- `suggestion_json`
- `confirmed_fields_json`
- `model_name`
- `prompt_version`
- `expires_at`
- `created_at`
- `updated_at`

### 15.2 `market_price_searches`

- `id`
- `organization_id`
- `branch_id`
- `identification_id`
- `created_by_membership_id`
- `status`
- `query_json`
- `condition_filters_json`
- `outlier_policy_json`
- `normalized_query_hash`
- `period_start`
- `period_end`
- `coverage_status`
- `coverage_oldest_at`
- `candidate_count`
- `included_count`
- `minimum_price`
- `median_price_before_outlier_exclusion`
- `median_price`
- `maximum_price`
- `exclusion_counts_json`
- `parser_version`
- `failure_class`
- `started_at`
- `completed_at`
- `created_at`

### 15.3 `market_price_candidates`

- `id`
- `organization_id`
- `search_id`
- `source_item_id`
- `canonical_url`
- `title`
- `closing_price`
- `ended_at`
- `condition_label`
- `normalized_condition`
- `condition_matched`
- `tax_display`
- `match_score`
- `match_reasons`
- `exclusion_reasons`
- `condition_group_count`
- `condition_median_price`
- `price_deviation_rate`
- `iqr_lower_bound`
- `iqr_upper_bound`
- `auto_outlier`
- `inclusion_override`
- `included`
- `decision_source`
- `content_hash`
- `created_at`
- `updated_at`

既存のappend-only監査ログを利用し、同じ情報を別監査テーブルへ重複保存しない。

---

## 16. RBAC・監査

### 16.1 Capability

- `market_price:search`
- `market_price:read`
- `market_price:manage`

### 16.2 権限

| Role | 検索 | 自分の履歴 | 組織履歴 | 設定・停止 |
| --- | --- | --- | --- | --- |
| assessor | 可 | 可 | 不可 | 不可 |
| manager | 可 | 可 | 可 | 一部可 |
| educator | 原則不可 | 不可 | 不可 | 不可 |
| content_approver | 不可 | 不可 | 不可 | 不可 |
| system_admin | 本文不可 | 運用メタ情報のみ | 運用メタ情報のみ | kill switchのみ |

### 16.3 監査イベント

- `market_price.identification_started`
- `market_price.identification_completed`
- `market_price.identification_failed`
- `market_price.suggestion_decided`
- `market_price.search_started`
- `market_price.scrape_blocked`
- `market_price.candidate_decided`
- `market_price.condition_filter_confirmed`
- `market_price.outlier_policy_changed`
- `market_price.outlier_evaluated`
- `market_price.candidate_restored`
- `market_price.stats_calculated`
- `market_price.result_viewed`
- `market_price.search_retried`

画像、商品説明、生HTML、署名URL、Gemini raw responseは監査ログへ記録しない。

---

## 17. GCP構成

```text
Next.js Web
  ├─ 商品条件・画像入力
  ├─ Gemini候補確認
  └─ 落札候補・相場結果
        ↓ Bearer ID token
Fastify API
  ├─ RBAC・scope
  ├─ upload session
  ├─ identification
  └─ search API
        ↓ Cloud Tasks
Worker
  ├─ GeminiProductIdentificationProvider
  ├─ YahooAuctionScrapeProvider
  ├─ ProductMatchingService
  └─ MarketPriceCalculationService
        ↓
Vertex AI Gemini / private GCS / PostgreSQL / Yahoo公開ページ
```

- Geminiは既存のVertex AI provider境界を拡張する。
- モデルは初期候補として既存の`gemini-2.5-flash`を利用する。
- 画像とテキストを同時入力する。
- `response_schema`で構造化JSONを要求する。
- WorkerはCloud Tasksからのみ起動する。
- productionでlocal providerへfallbackしない。
- スクレイパーには即時kill switchを設ける。

---

## 18. 非機能要件

### 18.1 セキュリティ

- Identity Platformの既存Google認証を利用する。
- APIでmembership、role、organization scopeを確認する。
- 画像アップロードは短命・単用途URLとする。
- SSRF防止のため、利用者指定URLから画像を取得しない。
- HTMLはParserへ渡す前にサイズ上限を設ける。
- 外部HTMLを画面へ直接描画しない。
- URLを許可されたYahoo originへ限定する。
- state-changing APIへ冪等性キーと楽観ロックを適用する。

### 18.2 可用性

- Gemini停止中も手入力検索を可能にする。
- スクレイパー停止中は過去結果の閲覧を可能にする。
- Worker retryは一時障害だけに限定する。
- 永続的な取得拒否を無限再試行しない。

### 18.3 性能

- Gemini商品候補は非同期状態として扱う。
- Yahoo検索はCloud Tasksで非同期実行する。
- 同一条件は24時間キャッシュを優先する。
- ページ離脱後もサーバー側で状態を保持する。
- 数値進捗が取得できない処理で偽の進捗率を表示しない。

### 18.4 アクセシビリティ

- 44px以上の操作領域
- keyboardだけで画像追加以外の全操作が可能
- 画像には利用者が確認できるファイル名と削除ボタンを表示
- 状態を色だけで表現しない
- Dialog／Sheetのfocus trapとrestore
- reduced motion／contrastへ対応
- axe serious／critical 0

---

## 19. 運用監視

### 19.1 監視指標

- Gemini成功率
- Gemini構造化出力不正率
- Gemini低確信度率
- 手入力フォールバック率
- スクレイピング成功率
- 403／429／CAPTCHA発生率
- Parser構造不一致率
- 直近90日完全取得率
- 検索あたり取得ページ数
- 検索あたり候補件数
- 利用者による候補除外率
- 商品状態別の候補件数と状態不明率
- 価格外れ値の自動除外率
- 5件未満による外れ値判定不能率
- 自動除外候補の手動復帰率
- Gemini提案の利用者修正率
- 検索完了時間

### 19.2 自動停止

次の場合は`market_price_search`またはスクレイパーkill switchを停止する。

- CAPTCHA検知
- 403が継続
- 429が設定閾値を超過
- Parser契約不一致が継続
- 価格解析失敗率が閾値を超過
- 同一ページから異常件数を取得
- 元サイトの利用条件・構造が変更

---

## 20. テスト計画

### 20.1 Unit

- 画像MIME・サイズ検証
- EXIF除去
- Gemini response schema
- null／unknownの許容
- 商品属性正規化
- 型番・世代判定
- 除外語判定
- Yahoo価格・日付解析
- 重複商品ID排除
- 商品状態ラベルの正規化と未定義値の`unspecified`化
- 状態複数選択と0件拒否
- 奇数件・偶数件の中央値
- 状態グループ別中央値
- 四分位数とTukey fence
- 中央値乖離率20%の境界値
- 5件未満では自動除外しない
- 異なる商品状態を同じ分布へ混ぜない
- 自動除外候補の手動復帰と手動上書き保持
- 税表記混在
- 取得完全性
- Parser version drift

### 20.2 Integration

- signed upload→private GCS→Gemini→候補保存
- 手入力→Gemini→候補保存
- Gemini不正出力→1回再生成→手入力フォールバック
- confirmed identification→Cloud Tasks→Worker
- 匿名HTML fixture→Parser→候補→統計
- 商品状態絞り込み→取得後再判定→状態別外れ値判定
- 外れ値ポリシー変更→再計算→手動上書き保持
- organization RLS
- assessor／manager／system_adminの本文境界
- 監査イベントのredaction
- 一時画像の期限削除

### 20.3 E2E

1. 画像から型番付き商品を特定して相場結果へ到達する。
2. 画像と補足テキストを組み合わせる。
3. 手入力途中でGemini補完を使う。
4. Geminiを使わず手入力だけで検索する。
5. 複数候補から1件を選択する。
6. Gemini候補を項目単位で却下・編集する。
7. 本体、付属品、ジャンク、まとめ売りを除外する。
8. 商品状態を複数選択し、0件では検索を開始できない。
9. 同じ商品状態の5件以上を母集団として中央値20%超かつIQR範囲外を自動除外する。
10. 5件未満では警告だけを表示し、自動除外しない。
11. 自動除外候補を手動で集計へ戻すと統計値が再計算される。
12. 候補採否変更後に中央値が再計算される。
13. 90日境界未達を部分取得として表示する。
14. Gemini停止中も手入力検索できる。
15. 403／429／CAPTCHAで停止する。
16. 再読込後も検索条件、外れ値ポリシー、手動上書きが復元される。
17. 別組織の検索結果へアクセスできない。

### 20.4 画面検証

- Chromium／WebKit
- 360／390／430／768／834／1024／1440px
- 21画面×390／834／1440pxの63画像
- SCR-021はinitial／analyzing／confirmation／partial／blocked／resultを追加撮影
- 横スクロールなし
- 長い日本語タイトル、型番、URLの折返し
- 200% zoom
- keyboard表示時のSticky Action

### 20.5 実アクセス試験

通常CIではYahooへアクセスせず、匿名化した保存HTML fixtureを使用する。固定Stageでの実アクセスは、利用条件・許可判断後に、既知の商品1件、低頻度、ページ上限付きで実施する。

---

## 21. 実装工程

### Stage 0：利用条件・取得経路Gate

- 対象URL、robots.txt、利用規約の記録
- 取得元への利用可否確認
- 商用・業務利用に関する社内判断
- スクレイピング停止条件
- Parser契約
- feature flagとkill switch

### Stage 1：詳細設計

- SCR-021作成
- 画面状態、フォーム制約、エラー、権限、モーション、HITL条件
- Route manifest更新
- DLV／Trace／coverage更新
- 20画面から21画面への成果物グラフ更新

### Stage 2：Contracts・DB

- ProductIdentification DTO
- MarketPrice DTO
- capability追加
- DB migration
- RLS・grant
- audit event
- retention・期限削除

### Stage 3：Gemini商品特定

- upload session
- private GCS
- EXIF除去
- Gemini prompt／response schema
- 候補最大3件
- 項目単位の採用・編集・却下
- 手入力フォールバック

### Stage 4：スクレイピングWorker

- YahooAuctionScrapeProvider
- ページング
- 取得間隔・上限・キャッシュ
- HTML Parser
- 重複排除
- 完全性判定
- 403／429／CAPTCHA／DOM drift停止

### Stage 5：同一商品・統計

- 商品正規化
- 型番・シリーズ判定
- 付属品・ジャンク・まとめ売り除外
- 候補採否
- 商品状態の取得後再判定
- 状態グループ別中央値・IQR・20%乖離判定
- 自動除外、手動復帰、除外前後の比較
- 最低値・中央値・最高値
- 税混在・少数グループ警告

### Stage 6：Web UI

- AppShell／Mobile Bottom Navigation
- PC 3ペイン
- Tablet 2ペイン
- Mobile 4ステップ
- URL状態復元
- 検索履歴
- loading／partial／blocked／failure

### Stage 7：ローカル・固定Stage検証

- lint→typecheck→unit→DB integration→build→Playwright→axe
- 匿名HTML fixtureのParser回帰
- Gemini実画像E2E
- 許可後の限定スクレイピングE2E
- 63画像＋SCR-021追加状態

### Stage 8：限定公開

- feature flag OFFでデプロイ
- 固定StageでGoogleログイン、Gemini、検索、RBACを確認
- 同一digestを本番へ反映
- 内部利用者だけfeature flag ON
- 監視後に対象組織を拡大

---

## 22. リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| Yahoo利用条件・robotsとの不整合 | 公開不能、停止要求 | Stage 0 Gate、許可確認、feature flag OFF |
| 403／429／CAPTCHA | 取得不能 | 回避せず停止、低頻度、キャッシュ |
| HTML構造変更 | 誤価格 | Parser契約、version、canary、kill switch |
| 90日境界未達 | 不完全な相場 | `partial`表示、取得期間明示 |
| Gemini誤認識 | 誤検索 | 候補最大3件、人の確定、unknown許容 |
| 型番違い混入 | 中央値の歪み | 厳密照合、一致理由、候補除外 |
| 付属品・空箱混入 | 最低値の歪み | 除外語、商品種別判定、人手確認 |
| まとめ売り混入 | 最高値の歪み | lot検知、単価換算せず除外 |
| 外れ値・不正出品 | 最大・最小の歪み | 状態別中央値20%超とIQRを併用し、自動除外候補を復帰可能にする |
| 状態グループの件数不足 | 外れ値の誤判定 | 5件未満は自動除外せず判定不能を表示 |
| 状態ラベルの誤正規化 | 比較母集団の混在 | 列挙値化、取得後再判定、未定義は`unspecified` |
| 商品画像の個人情報 | PII漏えい | EXIF除去、private GCS、24時間削除 |
| Gemini停止 | 商品特定不可 | 手入力を常時提供 |
| コスト増加 | 予算超過 | 画像上限、結果キャッシュ、利用回数監視 |

---

## 23. 受入条件

- SCR-021が通常ナビゲーションから利用できる。
- PC・Tablet・Mobileで機能欠落なく利用できる。
- 画像と手入力のどちらからでも開始できる。
- 手入力中にGemini予測サポートを任意実行できる。
- Geminiを使わず検索できる。
- GeminiがYahoo検索や価格生成を行わない。
- Geminiの提案を項目単位で採用・編集・却下できる。
- 商品状態を複数選択でき、最低1件の確認なしに検索を開始できない。
- AI補助の状態候補が自動確定されない。
- 未確認のGemini値でスクレイピングを開始できない。
- 実際のYahoo取得値だけが価格根拠になる。
- 同一商品候補を人が確認できる。
- 状態ごとの比較母集団を混ぜずに外れ値を判定できる。
- 初期20%閾値だけで自動除外せず、5件以上かつIQR範囲外の場合だけ自動除外される。
- 5件未満は判定不能として候補を残す。
- 自動除外候補を一覧で確認し、集計へ戻せる。
- 外れ値除外前後の中央値と除外内訳を確認できる。
- 候補採否変更後に統計値が正しく再計算される。
- 最低値・中央値・最高値・件数・期間・取得完全性が表示される。
- 90日境界未達を完全相場と表示しない。
- 403／429／CAPTCHAを回避しない。
- HTML構造変更時に誤価格を表示しない。
- 検索履歴と候補採否を再読込できる。
- 組織・権限境界が成立する。
- 生HTML、認証情報、署名URL、個人情報を保存・出力しない。
- 訪問案件へ結果を反映しない。
- 既存金券価格表を変更しない。
- 全21画面の自動検証と63画像が完了する。

---

## 24. 初期対象商品の推奨

初期リリースは、画像と型番で同一性を確認しやすい商品に限定する。

- カメラ
- オーディオ
- デジタル機器
- 型番付き家電
- 型番付き腕時計

バッグ、骨董、宝飾品などは、画像・タイトルだけでは素材、サイズ、付属品、真贋、状態差を十分に判定できないため、第2段階とする。

---

## 25. 現段階で必要な意思決定

| ID | 論点 | 推奨案 | 状態 |
| --- | --- | --- | --- |
| MP-Q01 | 初期対象カテゴリ | 型番付き商品から開始 | 未確定 |
| MP-Q02 | Yahoo利用許可・法務判断 | 本番ON前に確認 | 未確定 |
| MP-Q03 | 一時画像保持 | 最大24時間 | 仮決定 |
| MP-Q04 | 1検索のページ上限 | 20ページ | 決定 |
| MP-Q05 | キャッシュ | 24時間 | 決定 |
| MP-Q06 | Gemini候補数 | 最大3件 | 仮決定 |
| MP-Q07 | Geminiモデル | `gemini-2.5-flash` | 決定 |
| MP-Q08 | feature flag初期対象 | Manager／Assessor、既定OFF | 決定 |
| MP-Q09 | 商品状態の初期選択 | 未使用に近い／目立った傷や汚れなし／やや傷や汚れあり | 決定 |
| MP-Q10 | 価格外れ値ポリシー | 状態別中央値20%超かつIQR範囲外、5件以上、自動除外は復帰可能 | 決定 |

---

## 26. 利用条件に関する注意

2026-09-09時点で、Yahoo!オークションの`robots.txt`では対象になり得る`/closedsearch/`が`Disallow`に指定されている。

- Yahoo!オークション robots.txt：<https://auctions.yahoo.co.jp/robots.txt>
- LINEヤフー共通利用規約：<https://www.lycorp.co.jp/ja/company/terms/changes/20250203/>
- Yahoo!オークション利用規約：<https://auctions.yahoo.co.jp/special/html/guidelines.html>
- Yahoo!デベロッパーネットワーク：<https://developer.yahoo.co.jp/webapi/shopping/v3/>

技術設計はスクレイピング前提とするが、取得拒否を回避する実装は行わない。本番での実アクセスは、利用許可または社内の明示的な法務・リスク判断後にfeature flagを有効化する。

---

## 27. 関連成果物

- Gemini任意支援付き商品検索フロー：`/Users/riri/.codex/visualizations/2026/08/11/019ff068-ed80-73e2-8207-ccda42ba2718/market-price-gemini-assisted-search-workflow.html`
- スクレイピング処理フロー：`/Users/riri/.codex/visualizations/2026/08/11/019ff068-ed80-73e2-8207-ccda42ba2718/market-price-scraping-workflow.html`
- モバイル再設計：`docs/design/2026-08-25-mobile-responsive-redesign-plan.md`
- 必要ページ一覧・成果物グラフ：`docs/design/market-price/README.md`
- 画面遷移詳細仕様：`docs/design/market-price/2026-09-09-market-price-screen-transition-spec.md`
- 各ページ詳細画面設計：`docs/design/market-price/2026-09-09-market-price-detailed-screen-design.md`
- 操作デモHTML：`docs/design/market-price/prototypes/market-price-demo.html`
- URL Generator／AIパラメータ補助詳細設計：`docs/design/market-price/2026-09-09-yahoo-url-generator-and-ai-parameter-assistance.md`

---

## 28. 現在の完了判定

| 項目 | 状態 |
| --- | --- |
| 機能コンセプト | 作成済み |
| Gemini／スクレイパー責任分離 | 作成済み |
| PC／Mobileユーザー動線 | 作成済み |
| API・DB初期案 | 作成済み |
| リスク・停止条件 | 作成済み |
| 必要ページ一覧 | 作成済み |
| 画面遷移詳細仕様 | 作成済み |
| MP-01〜MP-06詳細画面設計 | 作成済み |
| 商品状態・外れ値追加仕様 | 企画・遷移・詳細設計へ同期済み |
| 操作デモHTML | 作成済み・状態複数選択、外れ値判定、手動復帰を実装・外部接続なし |
| バックエンド実装 | URL Generator、Parser、Registry、API、DB migration、Worker、監視を実装済み |
| Next.js実装 | MP-01〜MP-06、PC Sidebar、Mobile Bottom Navigation、実API接続を実装済み |
| ローカルテスト | Lint、TypeScript、Unit、DB/API/Worker integration、production buildを合格。ブラウザE2Eを最終実行中 |
| GCPデプロイ | 未実施 |
| 実スクレイピング | ローカル実接続Gateで別判定。fixture合格と混同しない |
| HITL | 未実施 |

次の外部工程はMP-Q02の法務・リスク判断、固定Stageの低頻度取得Gate、GCPリリースである。ローカル実装の詳細はURL Generator／AIパラメータ補助詳細設計とローカル実装記録を正本とする。
