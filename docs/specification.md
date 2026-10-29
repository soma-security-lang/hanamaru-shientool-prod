# 買取支援ツール｜華丸 業務・実装仕様書



## 1. 製品概要・対象版・確認日

確認日：2026-10-29（日本時間）。Webの基準コミット：`09d6fb1432e85a8bebd5342df078c2baba18e6ad`。

APIの基準コミット：`9a70aba8e2e9c8292609e553c874e222586a5ae3`。WebとAPIが別コミットで配信されているため、別の作業領域・ビルドとして維持します。

本番リビジョンはGCPの配信トラフィック・image digestから照合しました。以下はコードから確認した仕様です。稼働DBの全スキーマ・全業務の顧客受入を確認したものではありません。公開後の結果は検証記録で追記します。

訪問に紐付くPDF・録音・文字起こし・振り返りと、ナレッジ・教材・相場検索・経費・買取実績を扱います。認証されたmembershipとauthorization scopeでデータ範囲を決めます。状態変更は既存の冪等性・楽観ロック・監査の契約に従います。非同期処理の受付・実行中・完了・失敗を区別し、画面表示を処理完了の証拠にしません。相場の出品価格・成約候補・買取判断を区別します。

## 2. 利用者・ロール・権限

| ロール | 利用範囲 |
|---|---|
| assessor | 担当する訪問・録音・振り返り・相場・経費など |
| manager | 管理対象範囲の業務・コンテンツ・運用 |
| educator | ナレッジ・教材・担当する教育機能 |
| content_approver | 有効化されているコンテンツ承認 |
| system_admin | 利用者・システム運用の専用画面 |


ヘルプはログイン必須です。参照できる記事と画面リンクをサーバーで絞り、既存の業務認可・所属・スコープ判定は変更しません。質問APIの利用者ID・ロール・有効機能はサーバーで解決します。

## 3. 画面一覧・導線・機能仕様

| 画面パス | 表示名・用途 | 掲載手順・仕様章 | 根拠ファイル |
|---|---|---|---|
| /expense-settlement | 経費・車両金精算 | expense | apps/web/src/features/expense/screens.ts |
| /login | ログイン | start | apps/web/src/features/lane-a/screens.ts |
| / | 買取支援AI | start | apps/web/src/features/lane-a/screens.ts |
| /visits | 訪問支援 | visits | apps/web/src/features/lane-a/screens.ts |
| /visits/:id/import | PDFから訪問を登録 | visits | apps/web/src/features/lane-a/screens.ts |
| /visits/:id/preparation | 訪問前チェック | visits | apps/web/src/features/lane-a/screens.ts |
| /visits/:id/transcription | 録音・文字起こし | recording | apps/web/src/features/lane-a/screens.ts |
| /visits/:id/review/input | 振り返りを作成 | reviews | apps/web/src/features/lane-a/screens.ts |
| /visits/:id/review | AI振り返り結果 | reviews | apps/web/src/features/lane-b/screens.ts |
| /reviews | 振り返り履歴 | reviews | apps/web/src/features/lane-b/screens.ts |
| /knowledge/talks | 切り返しトーク集 | knowledge | apps/web/src/features/lane-b/screens.ts |
| /knowledge/flows | 困ったときのフロー集 | knowledge | apps/web/src/features/lane-b/screens.ts |
| /knowledge/reference | 用語集・金券買取価格表 | knowledge | apps/web/src/features/lane-b/screens.ts |
| /knowledge/manuals | 接客マニュアル・法務 | knowledge | apps/web/src/features/lane-b/screens.ts |
| /training/videos | 動画ライブラリ | training | apps/web/src/features/lane-b/screens.ts |
| /training/roleplay | AIロープレ | training | apps/web/src/features/lane-b/screens.ts |
| /admin/contents | コンテンツ管理 | contents-admin | apps/web/src/features/lane-c/screens.ts |
| /admin/users | 利用者・権限 | system-admin | apps/web/src/features/lane-c/screens.ts |
| /admin/operations | システム運用 | system-admin | apps/web/src/features/lane-c/screens.ts |
| /admin/approvals | コンテンツ承認 | approvals | apps/web/src/features/lane-c/screens.ts |
| /admin/analytics | チーム分析 | start | apps/web/src/features/lane-c/screens.ts |
| /market-price | 買取相場（仮） | market-price | apps/web/src/features/market-price/screens.ts |
| /purchase-results | 買取実績 | purchase-results | apps/web/src/features/performance/screens.ts |
| /performance | 実績・ランキング | performance | apps/web/src/features/performance/screens.ts |
| /help | /help | ヘルプ自身：本仕様書 第3・5章 | apps/web/src/app/help/page.tsx |
| /help/[slug] | /help/[slug] | ヘルプ自身：本仕様書 第3・5章 | apps/web/src/app/help/[slug]/page.tsx |
| /sso/start | /sso/start | start | apps/web/src/app/sso/start/page.tsx |
| /sso/callback | /sso/callback | start | apps/web/src/app/sso/callback/page.tsx |


掲載手順のslugは `docs/help/<slug>.md` に対応します。ヘルプ自体・認証コールバック等はこの仕様書で扱い、業務の操作手順とは区別します。

### 操作手順・入力・完了条件

#### コンテンツ承認の確認

対象：承認担当。対象ロール：content_approver。必要な機能設定：content_approval。

##### 誰が・いつ使うか

管理者・承認担当が「コンテンツ承認の確認」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「管理」の承認画面で対象と版を確認します。
2. 内容と差分を確認し、画面で許可される承認・差戻しを行います。

##### 完了の確認

対象版の承認結果を確認します。

##### 間違えた場合・困ったとき

対象版が変わった場合は内容を再確認してください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### コンテンツの編集・承認

対象：管理者・教育担当。対象ロール：manager, educator。必要な機能設定：なし。

##### 誰が・いつ使うか

管理者・教育担当が「コンテンツの編集・承認」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 管理画面で対象コンテンツと公開状態を確認します。
2. 編集権限がある場合は内容を更新し、確認・承認に進めます。
3. 承認担当者は対象版と内容を確認して承認・差戻しを行います。

##### 完了の確認

対象版・公開状態・承認状態を確認します。

##### 間違えた場合・困ったとき

承認前の内容を公開済みと扱わず、表示される版と対象を確認してください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 経費・車両金精算の確認

対象：査定員・管理者。対象ロール：assessor, manager。必要な機能設定：expense_settlement。

##### 誰が・いつ使うか

査定員・管理者が「経費・車両金精算の確認」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「経費・車両金精算」で対象日・対象者を確認します。
2. 支出記録や証憑を登録し、取込候補がある場合は内容を確認します。
3. 金額・費目・日付・証憑と重複を確認し、画面で許可される確定操作を行います。
4. 拠点での取りまとめや締めは、利用できる権限と対象日の状態を確認して行います。

##### 完了の確認

明細・対象日・取りまとめの状態を確認します。

##### 間違えた場合・困ったとき

誤りは画面で許可される訂正方法を使用します。精算済み・締め済みなどで編集できない場合は管理担当者へ連絡してください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 用語とよくある質問

対象：この機能を利用する方。対象ロール：全ログイン利用者。必要な機能設定：なし。

##### 誰が・いつ使うか

この機能を利用する方が「用語とよくある質問」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「申請」は確認・承認を依頼することです。送信しただけで承認済みとは限りません。
2. 「権限」は利用できる画面・操作の範囲です。画面に操作がない場合は所属管理者へ確認します。
3. 「保存」は変更を記録する操作です。保存後は一覧や詳細で結果を確認します。
4. ヘルプへ質問しても、業務上の登録・変更は実行されません。案内された画面で操作してください。

##### 完了の確認

対象の画面に表示される状態と用語を確認します。

##### 間違えた場合・困ったとき

用語が分からない場合は、その語句と利用している画面名を入力してください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 現場の知識・接客マニュアル

対象：査定員・管理者・教育担当。対象ロール：assessor, manager, educator。必要な機能設定：なし。

##### 誰が・いつ使うか

査定員・管理者・教育担当が「現場の知識・接客マニュアル」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「現場の知識」で、切り返しトーク・困ったときのフロー・用語・価格表・接客マニュアルを選びます。
2. キーワードや分類で必要な記事を探します。
3. 記事の内容と更新情報を確認します。

##### 完了の確認

利用する場面に合う記事か確認します。システムの操作方法は「ヘルプ・使い方」を参照してください。

##### 間違えた場合・困ったとき

記事が見つからない場合は別の言葉や分類で検索します。内容の訂正は管理担当者へ依頼してください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 買取相場の検索・候補確認

対象：査定員・管理者。対象ロール：assessor, manager。必要な機能設定：market_price_search。

##### 誰が・いつ使うか

査定員・管理者が「買取相場の検索・候補確認」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「買取相場」で商品名・型番などの識別情報を入力します。
2. 表示される検索条件・商品状態・対象サービスを確認します。
3. 検索結果の候補について、商品が同じか、送料・通貨・状態が合っているか確認します。
4. 候補の採否や集計の確認は、画面に表示される操作から行います。

##### 完了の確認

検索条件と採用した候補を確認し、画面に出る集計を査定の参考にします。売価・成約価格・買取価格を混同しないでください。

##### 間違えた場合・困ったとき

結果が少ない場合は型番や除外条件を確認します。処理中・エラーの場合は表示される再試行案内に従います。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

##### 画面の見本

実顧客情報を含まない検証環境の表示です。利用権限・設定によって表示が異なります。

![PCの操作画面（検証用データ）](/help-assets/market-price-1100.png)

![スマートフォンの操作画面（検証用データ）](/help-assets/market-price-390.png)

#### 実績・ランキングの確認

対象：査定員・管理者。対象ロール：assessor, manager。必要な機能設定：purchase_performance。

##### 誰が・いつ使うか

査定員・管理者が「実績・ランキングの確認」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「実績・ランキング」で対象期間と集計範囲を確認します。
2. 全拠点・個人など、表示される単位で結果を確認します。
3. 元となる取引や集計条件に疑問がある場合は管理担当者へ確認します。

##### 完了の確認

対象期間・集計範囲・表示単位を確認します。

##### 間違えた場合・困ったとき

登録した直後に反映されない場合は、集計条件と状態を確認してください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 買取実績の登録・確認

対象：査定員・管理者。対象ロール：assessor, manager。必要な機能設定：purchase_results。

##### 誰が・いつ使うか

査定員・管理者が「買取実績の登録・確認」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「買取実績」で対象の取引を確認します。
2. 新規登録または対象取引を開き、商品・金額・担当などの入力内容を確認します。
3. 画面で許可される登録・確定・変更操作を行います。

##### 完了の確認

対象取引の内容と状態が更新されたことを確認します。

##### 間違えた場合・困ったとき

確定後や締め後の変更は、表示される操作と権限に従い、必要に応じて管理担当者へ相談します。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 録音・文字起こし・手入力

対象：査定員・管理者。対象ロール：assessor, manager。必要な機能設定：なし。

##### 誰が・いつ使うか

査定員・管理者が「録音・文字起こし・手入力」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 対象訪問を開き、録音・文字起こしの機能へ進みます。
2. 録音の同意と対象訪問を確認し、画面が対応する方法で録音またはファイルを登録します。
3. 文字起こしの処理状態を確認します。
4. 結果が表示されたら内容を確認し、利用可能な修正・確定操作を行います。

##### 完了の確認

対象訪問の文字起こし結果と処理状態を確認します。

##### 間違えた場合・困ったとき

処理が失敗した場合はエラー表示を確認して再試行します。手入力が利用できる場合は、画面の案内から入力・確認します。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 振り返りの作成・結果確認

対象：査定員・管理者。対象ロール：assessor, manager。必要な機能設定：なし。

##### 誰が・いつ使うか

査定員・管理者が「振り返りの作成・結果確認」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 対象訪問の内容と文字起こしを確認します。
2. 振り返りの入力画面で必要な内容を入力し、確認して実行します。
3. 振り返りチェックシートから対象の結果を開きます。

##### 完了の確認

対象訪問・実行状態・結果と根拠を確認します。

##### 間違えた場合・困ったとき

結果に疑問がある場合は、元の記録と照合して管理者へ確認してください。AIの結果だけで事実と判断しないでください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### ログイン・画面の使い方

対象：この機能を利用する方。対象ロール：全ログイン利用者。必要な機能設定：なし。

##### 誰が・いつ使うか

この機能を利用する方が「ログイン・画面の使い方」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 通常のログイン画面から、業務用Googleアカウントまたは有効な共通IDでログインします。
2. ホームと所属・役割を確認します。
3. PCのメニュー、スマホの「その他」から利用する機能を選びます。

##### 完了の確認

自分に許可された画面が表示されることを確認します。

##### 間違えた場合・困ったとき

アカウントや所属が正しくない場合は管理者へ連絡します。ログインを繰り返しても直らない場合は表示メッセージを伝えます。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 利用者・運用管理

対象：システム管理者。対象ロール：system_admin。必要な機能設定：なし。

##### 誰が・いつ使うか

システム管理者が「利用者・運用管理」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 管理画面から利用者または運用対象を選びます。
2. 所属・ロール・処理状態などを確認します。
3. 画面で許可される管理操作を行い、結果を確認します。

##### 完了の確認

対象者・対象処理と更新結果を確認します。

##### 間違えた場合・困ったとき

障害や権限不足の場合は、表示メッセージとリクエストIDを管理担当者へ伝えます。認証情報を送らないでください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### AIロープレ・動画研修

対象：査定員・管理者・教育担当。対象ロール：assessor, manager, educator。必要な機能設定：なし。

##### 誰が・いつ使うか

査定員・管理者・教育担当が「AIロープレ・動画研修」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「研修」でAIロープレまたは動画ライブラリを選びます。
2. 学習するテーマやシナリオを選びます。
3. 画面の案内に従って練習し、表示された振り返りを確認します。

##### 完了の確認

選択したテーマと実施結果を確認します。

##### 間違えた場合・困ったとき

利用できる教材がない場合や再生できない場合は、管理担当者へ対象教材を伝えてください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### ログイン・権限・保存エラーの対処

対象：この機能を利用する方。対象ロール：全ログイン利用者。必要な機能設定：なし。

##### 誰が・いつ使うか

この機能を利用する方が「ログイン・権限・保存エラーの対処」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 画面のエラーメッセージと対象の操作を確認します。
2. 通信状態とログイン状態を確認し、必要ならログインし直します。
3. 保存の成否が不明な場合は一覧・詳細を開き直して、対象の記録を確認します。
4. 解消しない場合は、操作した画面・日時・メッセージを管理担当者へ伝えます。

##### 完了の確認

再表示した状態を確認します。通信の失敗と業務処理の完了を区別します。

##### 間違えた場合・困ったとき

同じ操作を連続で実行せず、記録の重複がないか確認します。パスワード・認証コード・顧客情報は質問欄へ入力しないでください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

#### 訪問一覧・訪問前チェック

対象：査定員・管理者。対象ロール：assessor, manager。必要な機能設定：なし。

##### 誰が・いつ使うか

査定員・管理者が「訪問一覧・訪問前チェック」を利用するときの手順です。

##### 操作前の確認

ログインし、対象の画面を利用できる権限があることを確認してください。

##### 操作手順

1. 「訪問前チェック」で対象の訪問を選びます。
2. 訪問先と対象日を確認し、事前情報・準備内容を確認します。
3. PDF取込や準備情報の確認は、対象訪問内の操作から進めます。

##### 完了の確認

対象訪問と準備情報の状態が一致することを確認します。

##### 間違えた場合・困ったとき

違う訪問へ登録しないよう、操作前に対象名と日付を確認してください。

##### 関連ヘルプ

[困ったとき](/help/troubleshooting)・[用語とよくある質問](/help/glossary)

## 4. 入力項目・検証・状態遷移・業務ルール

訪問に紐付くPDF・録音・文字起こし・振り返りと、ナレッジ・教材・相場検索・経費・買取実績を扱います。認証されたmembershipとauthorization scopeでデータ範囲を決めます。状態変更は既存の冪等性・楽観ロック・監査の契約に従います。非同期処理の受付・実行中・完了・失敗を区別し、画面表示を処理完了の証拠にしません。相場の出品価格・成約候補・買取判断を区別します。

利用者向けの入力・操作条件・完了確認は前章の各手順に記載しています。実装上の厳密な入力型・上限・必須条件は次章の契約とハンドラに対応します。クライアント表示に加えサーバー側の検証を通します。

### 質問の契約

質問は1〜1000文字。会話は直近6往復まで、履歴中の質問も1000文字以内。参照slugは各履歴3つ以内、英数字とハイフンの登録済みslugだけを採用します。本文は32KiBまで、同一利用者は1インスタンスあたり1分10回・同時実行1件、上流AI処理は認証取得を含め12秒で打ち切ります。

返却のkindは answer / clarify / not_found / restricted / unavailable / cross_app。message、sections、sources、screensを返します。手順本文は選択された原稿の節を引用し、生成した任意の文章・URLを操作手順として採用しません。別アプリは固定ヘルプURLへ案内します。実データ照会・操作代行・外部Web検索を行いません。

## 5. APIの入出力・認可・エラー

APIの正本は本番API基準コミットです。成功はエンドポイント固有DTO、エラーは `{error:{code,message,fieldErrors,retryable},requestId}`。更新系は既存のidempotency-key・expectedVersion等の契約に従います。

| メソッド | パス | 入力・処理 | 認可・検証 | 根拠 |
|---|---|---|---|---|
| GET | /api/v1/purchase-results | purchase.list | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/purchase-results | purchase.create | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/purchase-results/:id | purchase.get | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/purchase-performance | purchase.performance | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/market-price/ebay/operations/:key | ebay.operationResult | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/market-price/ebay/searches | ebay.list | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/ebay/searches | ebay.create | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/market-price/ebay/searches/:id | ebay.get | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/ebay/searches/:id/next-page | ebay.nextPage | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/ebay/searches/:id/confirm | ebay.confirm | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/ebay/searches/:id/cancel | ebay.cancel | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/ebay/searches/:id/retry | ebay.retry | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/ebay/searches/:id/resume | ebay.resume | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/ebay/searches/:id/repeat | ebay.repeat | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/market-price/ebay/searches/:id/outlier-policy | ebay.outlierPolicy | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/expense-branch-options | expenseCash.options | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/expense-branch-days | expenseCash.list | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/expense-branch-days | expenseCash.create | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/expense-branch-days/:id | expenseCash.read | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/expense-branch-days/:id/logs | expenseCash.logs | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/expense-branch-operations/:key | expenseCash.result | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /health/live | 専用ハンドラ | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /health/ready | service.repository | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/openapi.json | 専用ハンドラ | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/sessions | 専用ハンドラ | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/sessions/current | 専用ハンドラ | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| DELETE | /api/v1/sessions/current | 専用ハンドラ | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/me | service.me | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/dashboard | service.dashboard | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/expense-days | expense.list | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/expense-operations/:key | expense.operationResult | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/expense-days | expense.createDay | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/expense-days/:id | expense.getDay | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/expense-days/:id | expense.updateDay | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/expense-days/:id/items | expense.addItem | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/expense-days/:id/followups | expense.addFollowup | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/expense-days/:id/cash-transfers | expense.unavailable | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/expense-days/:id/reconcile | expense.unavailable | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/expense-days/:id/close | expense.unavailable | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/assist/answers | service.assist | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/visits | service.listVisits | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits | service.createVisit | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visit-imports | service.startVisitImport | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/visits/:id | service.getVisit | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/visits/:id/workspace | service.getVisitWorkspace | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/visits/:id/retention-bindings | service.retentionBindings | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/visits/:id/preparation | service.getPreparation | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits/:id/preparation | service.createPreparation | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits/:id/preparation/confirm | service.confirmPreparation | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/visits/:id | service.updateVisit | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits/:id/deletion-requests | service.requestDeletion | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits/:id/documents/uploads | service.startUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits/:id/recordings/uploads | service.startUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PUT | /api/v1/local-uploads/* | service.acceptLocalUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/document-uploads/:uploadId/complete | service.completeUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/recording-uploads/:uploadId/complete | service.completeUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/documents/:id/extractions | service.createJob | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/documents/:id/file | service.getDocumentFile | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/documents/:id/file-access | service.getDocumentFile | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/recordings/:id/file | service.getRecordingFile | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/recordings/:id/file-access | service.getRecordingFile | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/extractions/:id | service.getExtraction | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/extractions/:id | service.updateExtraction | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/extractions/:id/confirm | service.confirmExtraction | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits/:id/recording-consents | service.createConsent | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits/:id/drive-imports | service.createDriveImport | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/drive-connections | service.createDriveConnection | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/drive-connections/picker-token | service.drivePickerToken | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/drive-files/inspect | service.inspectDriveFile | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| DELETE | /api/v1/drive-connections | service.revokeDriveConnection | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/recordings/:id/transcriptions | service.createJob | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/jobs/:id | service.getJob | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/transcripts/:id | service.getTranscript | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/transcripts/:id | service.updateTranscript | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/transcripts/:id/confirm | service.confirmTranscript | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/transcripts/:id/quality-assessment/acknowledgements | service.acknowledgeTranscriptQuality | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/transcripts/:id/reviews | service.createJob | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/visits/:id/manual-transcripts | service.createManualTranscript | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/reviews/:id | service.getReview | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/reviews/:id/acknowledgements | service.acknowledgeReview | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/history | service.history | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/identifications | service.createMarketPriceIdentification | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/market-price/identifications/:id | service.getMarketPriceIdentification | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/identifications/:id/image-uploads | service.startMarketPriceImageUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/image-uploads/:uploadId/complete | service.completeMarketPriceImageUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/identifications/:id/analyze | service.analyzeMarketPriceIdentification | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/market-price/identifications/:id | service.updateMarketPriceIdentification | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/identifications/:id/confirm | service.confirmMarketPriceIdentification | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/market-price/options | service.marketPriceOptions | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/market-price/searches | service.listMarketPriceSearches | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/searches | service.createMarketPriceSearch | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/market-price/searches/:id | service.getMarketPriceSearch | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/market-price/searches/:id/outlier-policy | service.updateMarketPriceOutlierPolicy | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/searches/:id/confirm | service.confirmMarketPriceSearch | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/searches/:id/retry | service.retryMarketPriceSearch | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/searches/:id/cancel | service.cancelMarketPriceSearch | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/market-price/searches/:id/repeat | service.repeatMarketPriceSearch | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/market-price/source-mappings | service.listMarketPriceSourceMappings | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PUT | /api/v1/admin/market-price/source-mappings/:key | service.upsertMarketPriceSourceMapping | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/contents | service.listContents | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/contents/:id | service.getContent | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/contents | service.createContent | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/contents/:id | service.updateContent | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/contents/:id/publish | service.publishContent | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/contents/:id/video-uploads | service.startVideoUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/video-uploads/:uploadId/complete | service.completeVideoUpload | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/training/videos/:id/file | service.getTrainingVideoFile | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/training/videos/:id/file-access | service.getTrainingVideoFile | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/training/scenarios | service.listContents | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/training/roleplay-turns | service.roleplayTurn | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/training/roleplay-sessions | service.listRoleplaySessions | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/training/roleplay-sessions/:id | service.getRoleplaySession | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/training/roleplay-sessions/:id/complete | service.completeRoleplaySession | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PUT | /api/v1/training/progress/:id | service.learningProgress | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/users | service.listUsers | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/admin/users | service.inviteUser | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/admin/users/:id | service.updateUser | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PUT | /api/v1/admin/users/:id/roles | service.replaceRoles | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/jobs | service.listJobs | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/operations/health | service.operationsHealth | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/admin/jobs/:id/retry | service.retryJob | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/admin/jobs/:id/cancel | service.cancelJob | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/retention-policies | service.retentionPolicies | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/admin/retention-policies | service.createRetentionPolicy | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/deletion-requests | service.deletionRequests | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/admin/legal-holds/:id | service.createLegalHold | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| DELETE | /api/v1/admin/legal-holds/:id | service.releaseLegalHold | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/audit-events | service.auditEvents | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/feature-flags | service.featureFlags | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| PATCH | /api/v1/admin/feature-flags/:key | service.updateFeatureFlag | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/content-approvals | service.approvals | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/admin/content-approvals | service.decideApproval | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/content-approval-batches | service.approvalBatches | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/admin/content-approval-batches | service.createApprovalBatch | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/admin/content-approval-batches/:id/decisions | service.decideApprovalBatch | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| GET | /api/v1/admin/analytics | service.analytics | Bearer ID token / membership / capability / scope | apps/api/src/routes.ts |
| POST | /api/v1/help/questions | question, history[{question,sourceSlugs}] | ログイン・同一Origin（cookie認証）・上限・ロール・機能設定 | help/engine.ts と質問ハンドラ |
| GET | /api/v1/help | なし | 既存Bearer認証、公開可能な記事だけ返す | apps/api/src/help/routes.ts |


質問APIの共通エラー：400（形式・文字数）、401（未ログイン）、403（不正Origin／認可）、413（本文上限）、429（利用制限）、503（処理不可）。AI障害は回答kind=unavailableと関連手順書を返し、プロバイダーの生エラーを表示しません。

### 入力スキーマの正本

根拠：`packages/contracts/src/index.ts`。

定義済みスキーマ：。各ルートでparse/safeParseして適用する。

## 6. データ構造・保存処理・関連

以下はマイグレーション・ORM定義からの抽出であり、稼働DBの直接確認結果ではありません。今回のヘルプ追加では業務テーブルを追加・変更せず、質問本文・回答本文を保存しません。

手順書はMarkdown、ビルド時の検索データは生成JSON、会話はブラウザ画面内のReact state、制限カウンターはサーバープロセス内で管理します。制限は複数インスタンスをまたぐ全体上限ではありません。

列の初期定義を以下に示します。後続のALTER TABLEによる変更も含めた最終構造は各マイグレーションを順に適用した結果です。型・制約の修正履歴は後述のマイグレーション一覧を参照してください。

| モデル／テーブル | フィールド・型／初期定義 | 根拠 |
|---|---|---|
| organizations | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_key varchar(100) NOT NULL UNIQUE; name varchar(200) NOT NULL; status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')); timezone varchar(50) NOT NULL DEFAULT 'Asia/Tokyo'; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0002_org_users_rbac.sql |
| branches | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; branch_key varchar(100) NOT NULL, name varchar(200) NOT NULL; status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')); created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0002_org_users_rbac.sql |
| users | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_provider varchar(30) NOT NULL DEFAULT 'google'; provider_subject_hash char(64) NOT NULL UNIQUE, email_hash char(64) NOT NULL; email_masked varchar(320) NOT NULL, display_name varchar(200) NOT NULL; status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','closed')); last_login_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0002_org_users_rbac.sql |
| memberships | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, branch_id uuid NOT NULL; status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','closed')); lock_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0002_org_users_rbac.sql |
| roles | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_code varchar(50) NOT NULL UNIQUE; description text NOT NULL, capabilities text[] NOT NULL DEFAULT '{}' | packages/database/migrations/0002_org_users_rbac.sql |
| role_assignments | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; membership_id uuid NOT NULL, role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT; scope_type varchar(20) NOT NULL DEFAULT 'organization' CHECK(scope_type IN ('self','branch','organization')); scope_id uuid NULL, valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NULL; assigned_by_membership_id uuid NULL, created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0002_org_users_rbac.sql |
| sessions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; membership_id uuid NOT NULL, token_hash char(64) NOT NULL UNIQUE, csrf_hash char(64) NOT NULL; created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(); idle_expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL, revoked_at timestamptz NULL | packages/database/migrations/0002_org_users_rbac.sql |
| visits | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; branch_id uuid NOT NULL, assigned_membership_id uuid NOT NULL, case_number varchar(100) NOT NULL; status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','visited','reviewed','closed','cancelled','deleting','deleted')); scheduled_at timestamptz NULL, visited_at timestamptz NULL, closed_at timestamptz NULL; customer_label varchar(200) NULL, notes_redacted text NULL CHECK(length(notes_redacted)<=4000); lock_version bigint NOT NULL DEFAULT 1, deleted_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0003_visits_dynamic_forms.sql |
| form_schema_versions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; schema_key varchar(100) NOT NULL, version int NOT NULL CHECK(version>0), json_schema jsonb NOT NULL; ui_schema jsonb NOT NULL DEFAULT '{}', status varchar(20) NOT NULL CHECK(status IN ('draft','active','retired')); effective_from timestamptz NULL, approved_by_membership_id uuid NULL, approved_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,schema_key,version) | packages/database/migrations/0003_visits_dynamic_forms.sql |
| storage_objects | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; bucket_name varchar(222) NOT NULL, object_name text NOT NULL CHECK(object_name !~* '@／customer／email／phone'); object_generation bigint NOT NULL CHECK(object_generation>0), purpose varchar(30) NOT NULL CHECK(purpose IN ('visit_pdf','recording','transcript_raw','review_artifact','quarantine','export')); status varchar(20) NOT NULL CHECK(status IN ('pending','available','quarantined','deleting','deleted','failed')); mime_type varchar(255) NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>=0), sha256 char(64) NOT NULL; retention_until timestamptz NULL, deleted_at timestamptz NULL, kms_key_version_hash char(64) NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bucket_name,object_name,object_generation), UNIQUE(organization_id,id) | packages/database/migrations/0003_visits_dynamic_forms.sql |
| visit_documents | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL, storage_object_id uuid NOT NULL UNIQUE, document_type varchar(30) NOT NULL DEFAULT 'visit_info'; original_name_redacted varchar(255) NULL, page_count int NULL CHECK(page_count>0); status varchar(20) NOT NULL CHECK(status IN ('uploading','ready','extracting','extracted','failed','deleted')); uploaded_by_membership_id uuid NOT NULL, deleted_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0003_visits_dynamic_forms.sql |
| document_extractions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_document_id uuid NOT NULL REFERENCES visit_documents(id) ON DELETE RESTRICT; form_schema_version_id uuid NOT NULL REFERENCES form_schema_versions(id) ON DELETE RESTRICT, job_id uuid NULL; version int NOT NULL CHECK(version>0), status varchar(20) NOT NULL CHECK(status IN ('generated','editing','confirmed','superseded','failed')); provider varchar(100) NOT NULL, model_name varchar(100) NOT NULL, raw_result_storage_object_id uuid NULL; confirmed_by_membership_id uuid NULL, confirmed_at timestamptz NULL, lock_version bigint NOT NULL DEFAULT 1; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(visit_document_id,version) | packages/database/migrations/0003_visits_dynamic_forms.sql |
| visit_field_values | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; document_extraction_id uuid NOT NULL REFERENCES document_extractions(id) ON DELETE RESTRICT; field_key varchar(150) NOT NULL, value_type varchar(20) NOT NULL CHECK(value_type IN ('text','number','date','boolean','json')); text_value text NULL, number_value numeric(20,6) NULL, date_value date NULL, boolean_value boolean NULL, json_value jsonb NULL; source_page int NULL CHECK(source_page>0), source_excerpt text NULL CHECK(length(source_excerpt)<=1000), confidence numeric(5,4) NULL CHECK(confidence BETWEEN 0 AND 1); verification_status varchar(20) NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','confirmed','corrected','rejected')); verified_by_membership_id uuid NULL, verified_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0003_visits_dynamic_forms.sql |
| upload_sessions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL, upload_type varchar(20) NOT NULL CHECK(upload_type IN ('document','recording')); object_name text NOT NULL, mime_type varchar(255) NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>=0), sha256 char(64) NOT NULL; consent_id uuid NULL, requested_by_membership_id uuid NOT NULL, expires_at timestamptz NOT NULL; completed_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id) | packages/database/migrations/0004_storage_drive_recordings.sql |
| external_connections | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; membership_id uuid NOT NULL, provider varchar(20) NOT NULL CHECK(provider='google_drive'), provider_account_id_hash char(64) NOT NULL; refresh_token_ciphertext bytea NOT NULL, token_key_version varchar(100) NOT NULL, scopes text[] NOT NULL; expires_at timestamptz NULL, revoked_at timestamptz NULL, last_verified_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0004_storage_drive_recordings.sql |
| recording_consents | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL, status varchar(20) NOT NULL CHECK(status IN ('granted','declined','withdrawn')); method varchar(20) NOT NULL DEFAULT 'verbal' CHECK(method IN ('verbal','written','other')); notice_version varchar(50) NOT NULL, explained_by_membership_id uuid NOT NULL, recorded_by_membership_id uuid NOT NULL; occurred_at timestamptz NOT NULL, withdrawn_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0004_storage_drive_recordings.sql |
| recordings | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL, consent_id uuid NOT NULL, storage_object_id uuid NOT NULL UNIQUE; source_type varchar(20) NOT NULL CHECK(source_type IN ('upload','drive','browser')), captured_at timestamptz NULL; duration_ms bigint NULL CHECK(duration_ms>=0), status varchar(30) NOT NULL CHECK(status IN ('uploading','ready','transcribing','transcribed','failed','deleting','deleted')); retention_until timestamptz NOT NULL, uploaded_by_membership_id uuid NOT NULL, deleted_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0004_storage_drive_recordings.sql |
| drive_imports | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL, requested_by_membership_id uuid NOT NULL, external_connection_id uuid NOT NULL REFERENCES external_connections(id) ON DELETE RESTRICT; drive_file_id_ciphertext bytea NOT NULL, drive_file_version_hash char(64) NOT NULL, drive_file_name_redacted varchar(255) NULL; source_modified_at timestamptz NULL, source_size_bytes bigint NULL CHECK(source_size_bytes>=0), destination_storage_object_id uuid NULL; status varchar(20) NOT NULL CHECK(status IN ('queued','copying','succeeded','failed','cancelled')), job_id uuid NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,visit_id,drive_file_version_hash) | packages/database/migrations/0004_storage_drive_recordings.sql |
| jobs | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; job_type varchar(40) NOT NULL CHECK(job_type IN ('pdf_extract','drive_import','transcribe','review','delete','retention_scan')); entity_type varchar(40) NOT NULL, entity_id uuid NOT NULL, status varchar(20) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','retry_wait','succeeded','failed','cancelled')); idempotency_key varchar(200) NOT NULL, input_hash char(64) NOT NULL, input_redacted jsonb NOT NULL DEFAULT '{}'; attempt_count int NOT NULL DEFAULT 0 CHECK(attempt_count>=0), max_attempts int NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20); cloud_task_name text NULL UNIQUE, available_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz NULL, finished_at timestamptz NULL; error_code varchar(100) NULL, error_detail_redacted text NULL, requested_by_membership_id uuid NOT NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,job_type,idempotency_key), UNIQUE(organization_id,id) | packages/database/migrations/0005_jobs_outbox_idempotency.sql |
| job_attempts | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT, attempt_no int NOT NULL CHECK(attempt_no>0), worker_revision varchar(128) NOT NULL; started_at timestamptz NOT NULL, finished_at timestamptz NULL, result_status varchar(20) NOT NULL CHECK(result_status IN ('running','succeeded','retryable','failed','cancelled')); provider_operation_id_hash char(64) NULL, error_code varchar(100) NULL, error_detail_redacted text NULL, trace_id varchar(64) NOT NULL | packages/database/migrations/0005_jobs_outbox_idempotency.sql |
| outbox_events | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; event_type varchar(100) NOT NULL, aggregate_type varchar(40) NOT NULL, aggregate_id uuid NOT NULL; payload_redacted jsonb NOT NULL CHECK(pg_column_size(payload_redacted)<=32768), deduplication_key varchar(200) NOT NULL; available_at timestamptz NOT NULL DEFAULT now(), leased_until timestamptz NULL, published_at timestamptz NULL, publish_attempts int NOT NULL DEFAULT 0; created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,deduplication_key) | packages/database/migrations/0005_jobs_outbox_idempotency.sql |
| idempotency_records | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; membership_id uuid NOT NULL, endpoint_key varchar(100) NOT NULL, idempotency_key varchar(200) NOT NULL; request_hash char(64) NOT NULL, response_status int NOT NULL, response_body_redacted jsonb NOT NULL, resource_id uuid NULL; expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0005_jobs_outbox_idempotency.sql |
| transcripts | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; recording_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT, version int NOT NULL CHECK(version>0); status varchar(20) NOT NULL CHECK(status IN ('generated','editing','confirmed','superseded','deleting','deleted')); provider varchar(100) NOT NULL, model_name varchar(100) NOT NULL, language_code varchar(20) NOT NULL DEFAULT 'ja-JP'; full_text text NOT NULL, raw_result_storage_object_id uuid NULL, confirmed_by_membership_id uuid NULL, confirmed_at timestamptz NULL; retention_until timestamptz NOT NULL, lock_version bigint NOT NULL DEFAULT 1; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0006_transcripts_reviews.sql |
| transcript_segments | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; transcript_id uuid NOT NULL, sequence_no int NOT NULL CHECK(sequence_no>=0), start_ms bigint NOT NULL CHECK(start_ms>=0); end_ms bigint NOT NULL CHECK(end_ms>=start_ms), speaker_label varchar(50) NULL; speaker_role varchar(30) NOT NULL DEFAULT 'unknown' CHECK(speaker_role IN ('staff','customer','unknown')); text text NOT NULL, confidence numeric(5,4) NULL CHECK(confidence BETWEEN 0 AND 1), edited_text text NULL; edited_by_membership_id uuid NULL, edited_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0006_transcripts_reviews.sql |
| prompt_versions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; purpose varchar(40) NOT NULL CHECK(purpose IN ('pdf_extract','review')), version int NOT NULL CHECK(version>0); system_instruction text NOT NULL, output_json_schema jsonb NOT NULL, model_name varchar(100) NOT NULL, model_parameters jsonb NOT NULL DEFAULT '{}'; status varchar(20) NOT NULL CHECK(status IN ('draft','provisional','approved','retired')), approved_by_membership_id uuid NULL; approved_at timestamptz NULL, effective_from timestamptz NULL, source_commit_sha char(40) NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,purpose,version) | packages/database/migrations/0006_transcripts_reviews.sql |
| review_criteria_versions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; criteria_key varchar(100) NOT NULL, version int NOT NULL CHECK(version>0), criteria_json jsonb NOT NULL; status varchar(20) NOT NULL CHECK(status IN ('draft','provisional','approved','retired')); approved_by_membership_id uuid NULL, approved_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,criteria_key,version) | packages/database/migrations/0006_transcripts_reviews.sql |
| reviews | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; transcript_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT, version int NOT NULL CHECK(version>0); prompt_version_id uuid NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT; criteria_version_id uuid NOT NULL REFERENCES review_criteria_versions(id) ON DELETE RESTRICT; model_name varchar(100) NOT NULL, input_hash char(64) NOT NULL, summary text NOT NULL, structured_result jsonb NOT NULL; status varchar(20) NOT NULL CHECK(status IN ('generated','acknowledged','superseded','withdrawn','deleting','deleted')); acknowledged_by_membership_id uuid NULL, acknowledged_at timestamptz NULL, retention_until timestamptz NOT NULL; lock_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0006_transcripts_reviews.sql |
| review_findings | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; review_id uuid NOT NULL, sequence_no int NOT NULL CHECK(sequence_no>=0); category varchar(60) NOT NULL CHECK(category IN ('strength','improvement','talk','compliance','next_action','revisit')); finding_type varchar(30) NOT NULL CHECK(finding_type IN ('strength','improvement','warning','unknown')); severity varchar(20) NOT NULL CHECK(severity IN ('info','low','medium','high')), title varchar(200) NOT NULL; description text NOT NULL, recommended_action text NULL, confidence numeric(5,4) NULL CHECK(confidence BETWEEN 0 AND 1); created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0006_transcripts_reviews.sql |
| review_evidence | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; review_finding_id uuid NOT NULL, transcript_segment_id uuid NOT NULL, excerpt text NOT NULL CHECK(length(excerpt)<=1000); excerpt_hash char(64) NOT NULL, start_ms bigint NULL, end_ms bigint NULL; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0006_transcripts_reviews.sql |
| review_comments | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; review_id uuid NOT NULL, author_membership_id uuid NOT NULL, comment_type varchar(20) NOT NULL CHECK(comment_type IN ('note','correction','question')); body text NOT NULL CHECK(length(body)<=4000), edited_at timestamptz NULL, deleted_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0006_transcripts_reviews.sql |
| content_items | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; content_type varchar(30) NOT NULL CHECK(content_type IN ('talk','flow','glossary','price','manual','legal','video','roleplay')); stable_key varchar(150) NOT NULL, title varchar(300) NOT NULL, category varchar(200) NOT NULL DEFAULT ''; status varchar(20) NOT NULL CHECK(status IN ('draft','published','retired')), current_version_id uuid NULL; display_order int NOT NULL DEFAULT 0, search_text text NOT NULL DEFAULT '', deleted_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,content_type,stable_key), UNIQUE(organization_id,id) | packages/database/migrations/0007_content_learning.sql |
| content_versions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; content_item_id uuid NOT NULL, version int NOT NULL CHECK(version>0), body_json jsonb NOT NULL CHECK(pg_column_size(body_json)<=524288); source_type varchar(30) NOT NULL CHECK(source_type IN ('poc','migration','manual','import')), source_reference varchar(500) NULL; source_hash char(64) NOT NULL, review_status varchar(20) NOT NULL CHECK(review_status IN ('draft','in_review','approved','rejected')); change_summary text NULL, approved_by_membership_id uuid NULL, approved_at timestamptz NULL, published_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0007_content_learning.sql |
| tags | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; name varchar(100) NOT NULL, name_normalized varchar(100) NOT NULL, UNIQUE(organization_id,name_normalized), UNIQUE(organization_id,id) | packages/database/migrations/0007_content_learning.sql |
| content_tags | organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, content_item_id uuid NOT NULL; tag_id uuid NOT NULL, PRIMARY KEY(content_item_id,tag_id) | packages/database/migrations/0007_content_learning.sql |
| learning_progress | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; membership_id uuid NOT NULL, content_item_id uuid NOT NULL; status varchar(20) NOT NULL CHECK(status IN ('not_started','in_progress','completed')); started_at timestamptz NULL, completed_at timestamptz NULL, self_note text NULL CHECK(length(self_note)<=2000); created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0007_content_learning.sql |
| retention_policies | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; data_type varchar(30) NOT NULL CHECK(data_type IN ('pdf','audio','transcript','review','audit')), version int NOT NULL CHECK(version>0); retention_days int NOT NULL CHECK(retention_days BETWEEN 1 AND 3650), legal_hold_supported boolean NOT NULL DEFAULT false; status varchar(20) NOT NULL CHECK(status IN ('draft','active','retired')), effective_from timestamptz NOT NULL; approved_by_membership_id uuid NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0008_retention_deletion_audit.sql |
| legal_holds | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL, reason_code varchar(50) NOT NULL, reason_detail_redacted text NULL; placed_by_membership_id uuid NOT NULL, placed_at timestamptz NOT NULL, released_by_membership_id uuid NULL, released_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0008_retention_deletion_audit.sql |
| deletion_requests | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL, retention_policy_id uuid NULL, request_type varchar(20) NOT NULL CHECK(request_type IN ('retention','early','withdrawal','admin')); requested_by_membership_id uuid NOT NULL, reason_code varchar(50) NOT NULL; status varchar(20) NOT NULL CHECK(status IN ('requested','approved','running','partial','succeeded','failed','cancelled','held')); requested_at timestamptz NOT NULL, approved_by_membership_id uuid NULL, approved_at timestamptz NULL, completed_at timestamptz NULL; failure_summary_redacted text NULL, job_id uuid NULL REFERENCES jobs(id) ON DELETE RESTRICT; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0008_retention_deletion_audit.sql |
| deletion_items | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; deletion_request_id uuid NOT NULL, target_type varchar(40) NOT NULL, target_id uuid NULL, storage_object_id uuid NULL; sequence_no int NOT NULL, status varchar(20) NOT NULL CHECK(status IN ('pending','blocked','deleting','deleted','failed','skipped')); attempt_count int NOT NULL DEFAULT 0, deleted_at timestamptz NULL, error_code varchar(100) NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0008_retention_deletion_audit.sql |
| audit_events | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; occurred_at timestamptz NOT NULL DEFAULT now(), actor_type varchar(20) NOT NULL CHECK(actor_type IN ('user','service','system')); actor_id varchar(128) NOT NULL, action varchar(100) NOT NULL, resource_type varchar(50) NOT NULL, resource_id uuid NULL; result varchar(20) NOT NULL CHECK(result IN ('allowed','denied','failed')), request_id varchar(64) NOT NULL, trace_id varchar(64) NOT NULL; ip_hash char(64) NULL, user_agent_hash char(64) NULL, metadata_redacted jsonb NOT NULL DEFAULT '{}'; prev_event_hash char(64) NOT NULL, event_hash char(64) NOT NULL | packages/database/migrations/0008_retention_deletion_audit.sql |
| system_settings | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; setting_key varchar(150) NOT NULL, value_type varchar(20) NOT NULL, value_json jsonb NOT NULL; schema_version int NOT NULL, effective_from timestamptz NOT NULL, expires_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,setting_key,effective_from) | packages/database/migrations/0008_retention_deletion_audit.sql |
| feature_flags | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; flag_key varchar(150) NOT NULL, enabled boolean NOT NULL DEFAULT false, target_rule jsonb NOT NULL DEFAULT '{}'; owner_membership_id uuid NOT NULL, expires_at timestamptz NULL, rollback_note text NOT NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,flag_key) | packages/database/migrations/0008_retention_deletion_audit.sql |
| visit_preparations | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL; document_extraction_id uuid NOT NULL REFERENCES document_extractions(id) ON DELETE RESTRICT; job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT; prompt_version_id uuid NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT; version int NOT NULL CHECK(version>0); model_name varchar(100) NOT NULL; input_hash char(64) NOT NULL; structured_result jsonb NOT NULL CHECK(jsonb_typeof(structured_result)='object'); status varchar(20) NOT NULL CHECK(status IN ('generated','confirmed','superseded','failed')); confirmed_by_membership_id uuid NULL; confirmed_at timestamptz NULL; lock_version bigint NOT NULL DEFAULT 1; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0015_visit_preparations.sql |
| roleplay_sessions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; membership_id uuid NOT NULL; scenario_content_item_id uuid NOT NULL; status varchar(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')); started_at timestamptz NOT NULL DEFAULT now(); completed_at timestamptz NULL; self_note text NULL CHECK(length(self_note)<=2000); created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0016_roleplay_sessions.sql |
| roleplay_turns | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; session_id uuid NOT NULL; sequence_no int NOT NULL CHECK(sequence_no>0); staff_text text NOT NULL CHECK(length(staff_text) BETWEEN 1 AND 2000); customer_reply text NOT NULL CHECK(length(customer_reply) BETWEEN 1 AND 4000); feedback jsonb NOT NULL CHECK(jsonb_typeof(feedback)='array'); model_name varchar(100) NOT NULL; input_hash char(64) NOT NULL; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0016_roleplay_sessions.sql |
| content_version_metadata | content_version_id uuid PRIMARY KEY; organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; content_item_id uuid NOT NULL; title varchar(300) NOT NULL; category varchar(200) NOT NULL DEFAULT ''; search_text text NOT NULL DEFAULT ''; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0021_content_publication_and_role_isolation.sql |
| visit_deletion_fences | organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; visit_id uuid NOT NULL; job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE; operation varchar(20) NOT NULL CHECK(operation IN ('delete','retention')); created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0022_legal_hold_deletion_fence.sql |
| audit_retention_anchors | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; cutoff_at timestamptz NOT NULL; last_event_hash char(64) NOT NULL; purged_count int NOT NULL CHECK(purged_count>0); created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0023_retention_policy_enforcement.sql |
| content_approval_batches | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; content_type varchar(30) NOT NULL CHECK(content_type IN ('talk','flow','glossary','price','manual','legal','video','roleplay')); category varchar(200) NOT NULL; status varchar(20) NOT NULL CHECK(status IN ('in_review','approved','rejected','invalidated')); item_count int NOT NULL CHECK(item_count>0); required_approvals int NOT NULL CHECK(required_approvals IN (1,2)); snapshot_hash char(64) NOT NULL CHECK(snapshot_hash ~ '^[0-9a-f]{64}$'); submitted_by_membership_id uuid NOT NULL; submitted_at timestamptz NOT NULL DEFAULT now(); decided_at timestamptz NULL; invalidated_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0038_content_approval_batches.sql |
| content_approval_batch_items | organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; batch_id uuid NOT NULL; content_item_id uuid NOT NULL; content_version_id uuid NOT NULL; version int NOT NULL CHECK(version>0); source_hash char(64) NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$') | packages/database/migrations/0038_content_approval_batches.sql |
| content_approval_decisions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; batch_id uuid NOT NULL; decision varchar(20) NOT NULL CHECK(decision IN ('approved','rejected')); decided_by_membership_id uuid NOT NULL; reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000); decided_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0038_content_approval_batches.sql |
| review_chunk_checkpoints | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; job_id uuid NOT NULL; transcript_id uuid NOT NULL; chunk_index int NOT NULL CHECK(chunk_index>=0); first_sequence_no int NOT NULL CHECK(first_sequence_no>=0); last_sequence_no int NOT NULL CHECK(last_sequence_no>=first_sequence_no); input_hash char(64) NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'); result_redacted jsonb NOT NULL CHECK(pg_column_size(result_redacted)<=1048576); completed_at timestamptz NOT NULL DEFAULT now(); created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0039_review_chunk_checkpoints.sql |
| video_upload_sessions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; content_item_id uuid NOT NULL; content_version_id uuid NOT NULL; object_name text NOT NULL; mime_type varchar(255) NOT NULL CHECK(mime_type IN ('video/mp4','video/webm')); size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 2000000000); sha256 char(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'); requested_by_membership_id uuid NOT NULL; expires_at timestamptz NOT NULL; completed_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0041_training_video_storage.sql |
| training_videos | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; content_item_id uuid NOT NULL; content_version_id uuid NOT NULL; storage_object_id uuid NOT NULL; duration_ms bigint NOT NULL CHECK(duration_ms>0); width int NOT NULL CHECK(width>0); height int NOT NULL CHECK(height>0); media_metadata jsonb NOT NULL; status varchar(20) NOT NULL CHECK(status IN ('ready','deleted')); retention_until timestamptz NOT NULL; retention_policy_id uuid NOT NULL REFERENCES retention_policies(id) ON DELETE RESTRICT; uploaded_by_membership_id uuid NOT NULL; deleted_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0041_training_video_storage.sql |
| transcript_quality_assessments | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; transcript_id uuid NOT NULL; status varchar(32) NOT NULL CHECK(status IN ('evaluated','assessment_unavailable')); model_name varchar(100) NULL; failure_class varchar(40) NULL CHECK(failure_class IN ('MODEL_OUTPUT_INVALID','EVIDENCE_INVALID')); flags text[] NOT NULL DEFAULT '{}'; confidence numeric(5,4) NULL CHECK(confidence BETWEEN 0 AND 1); metrics jsonb NOT NULL CHECK(jsonb_typeof(metrics)='object'); continuation_decision varchar(20) NULL CHECK(continuation_decision IN ('continue','replace')); acknowledged_by_membership_id uuid NULL; acknowledged_at timestamptz NULL; lock_version bigint NOT NULL DEFAULT 1; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now(); (status='assessment_unavailable' AND flags @> ARRAY['assessment_unavailable']::text[]); OR (status='evaluated' AND NOT flags @> ARRAY['assessment_unavailable']::text[]); ) | packages/database/migrations/0049_transcript_quality_operations.sql |
| transcript_quality_evidence | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; assessment_id uuid NOT NULL; transcript_id uuid NOT NULL; transcript_segment_id uuid NOT NULL; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0049_transcript_quality_operations.sql |
| operational_alerts | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; job_id uuid NOT NULL; failure_class varchar(40) NOT NULL CHECK(failure_class IN (; 'STT_HEARTBEAT_STALE','STT_LRO_TIMEOUT','RETRY_WAIT_OVERDUE'; 'MODEL_OUTPUT_INVALID','EVIDENCE_INVALID','RETRY_LIMIT_EXCEEDED'; )); job_type varchar(40) NOT NULL; severity varchar(20) NOT NULL CHECK(severity IN ('warning','critical')); attempt int NOT NULL CHECK(attempt>=0); max_attempts int NOT NULL CHECK(max_attempts>0); oldest_age_seconds int NOT NULL CHECK(oldest_age_seconds>=0); status varchar(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')); detected_at timestamptz NOT NULL DEFAULT now(); last_seen_at timestamptz NOT NULL DEFAULT now(); resolved_at timestamptz NULL | packages/database/migrations/0049_transcript_quality_operations.sql |
| operations_scan_runs | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; scanned_at timestamptz NOT NULL DEFAULT now(); warning_count int NOT NULL CHECK(warning_count>=0); critical_count int NOT NULL CHECK(critical_count>=0) | packages/database/migrations/0049_transcript_quality_operations.sql |
| market_price_identifications | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; branch_id uuid NOT NULL; created_by_membership_id uuid NOT NULL; job_id uuid NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT; status varchar(30) NOT NULL CHECK(status IN ('draft','analyzing','suggestion_ready','confirmation_required','confirmed','failed','expired')); input_redacted jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(input_redacted)='object' AND pg_column_size(input_redacted)<=32768); suggestion_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(suggestion_json)='object' AND pg_column_size(suggestion_json)<=131072); confirmed_fields_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(confirmed_fields_json)='object' AND pg_column_size(confirmed_fields_json)<=32768); model_name varchar(100) NULL; prompt_version int NULL CHECK(prompt_version IS NULL OR prompt_version>0); expires_at timestamptz NOT NULL; lock_version bigint NOT NULL DEFAULT 1; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0053_market_price_search.sql |
| market_price_searches | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; branch_id uuid NOT NULL; identification_id uuid NULL; created_by_membership_id uuid NOT NULL; job_id uuid NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT; status varchar(30) NOT NULL CHECK(status IN ('queued','planning','fetching','normalizing','review_required','ready','partial','blocked','failed','cancelled')); query_json jsonb NOT NULL CHECK(jsonb_typeof(query_json)='object' AND pg_column_size(query_json)<=32768); condition_filters_json jsonb NOT NULL CHECK(jsonb_typeof(condition_filters_json)='array'); outlier_policy_json jsonb NOT NULL CHECK(jsonb_typeof(outlier_policy_json)='object'); normalized_query_hash char(64) NOT NULL; period_start timestamptz NOT NULL; period_end timestamptz NOT NULL; period_days int NOT NULL DEFAULT 90 CHECK(period_days=90); sort_key varchar(40) NOT NULL DEFAULT 'ENDED_AT_NEWEST' CHECK(sort_key='ENDED_AT_NEWEST'); page_size int NOT NULL DEFAULT 100 CHECK(page_size=100); max_pages int NOT NULL DEFAULT 20 CHECK(max_pages=20); ai_parameter_plan_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(ai_parameter_plan_json)='object' AND pg_column_size(ai_parameter_plan_json)<=32768); closed_search_spec_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(closed_search_spec_json)='object' AND pg_column_size(closed_search_spec_json)<=32768); query_plan_hash char(64) NULL; parameter_registry_version varchar(50) NULL; generator_version varchar(50) NULL; planner_model varchar(100) NULL; planner_prompt_version int NULL CHECK(planner_prompt_version IS NULL OR planner_prompt_version>0); planner_status varchar(40) NULL CHECK(planner_status IS NULL OR planner_status IN ('registry_resolved','ai_applied','deterministic_fallback')); generated_url_hash char(64) NULL; coverage_status varchar(20) NOT NULL DEFAULT 'pending' CHECK(coverage_status IN ('pending','complete','partial','blocked')); coverage_oldest_at timestamptz NULL; candidate_count int NOT NULL DEFAULT 0 CHECK(candidate_count>=0); included_count int NOT NULL DEFAULT 0 CHECK(included_count>=0); minimum_price bigint NULL CHECK(minimum_price IS NULL OR minimum_price>=0); median_price_before_outlier_exclusion numeric(14,2) NULL CHECK(median_price_before_outlier_exclusion IS NULL OR median_price_before_outlier_exclusion>=0); median_price numeric(14,2) NULL CHECK(median_price IS NULL OR median_price>=0); maximum_price bigint NULL CHECK(maximum_price IS NULL OR maximum_price>=0); exclusion_counts_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(exclusion_counts_json)='object'); parser_version varchar(50) NULL; failure_class varchar(100) NULL; started_at timestamptz NULL; completed_at timestamptz NULL; lock_version bigint NOT NULL DEFAULT 1; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0053_market_price_search.sql |
| market_price_search_pages | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; search_id uuid NOT NULL; page_number int NOT NULL CHECK(page_number BETWEEN 1 AND 20); result_offset int NOT NULL CHECK(result_offset=1+((page_number-1)*100)); url_hash char(64) NOT NULL; http_status int NOT NULL CHECK(http_status BETWEEN 100 AND 599); source_count int NOT NULL CHECK(source_count BETWEEN 0 AND 100); parsed_count int NOT NULL CHECK(parsed_count BETWEEN 0 AND 100); parse_failure_count int NOT NULL DEFAULT 0 CHECK(parse_failure_count BETWEEN 0 AND source_count); newest_ended_at timestamptz NULL; oldest_ended_at timestamptz NULL; response_hash char(64) NULL; fetch_duration_ms int NOT NULL CHECK(fetch_duration_ms>=0); status varchar(20) NOT NULL CHECK(status IN ('succeeded','blocked','failed')); fetched_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0053_market_price_search.sql |
| market_price_candidates | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; search_id uuid NOT NULL; source_page_number int NOT NULL CHECK(source_page_number BETWEEN 1 AND 20); source_item_id varchar(100) NOT NULL; source_type varchar(20) NOT NULL CHECK(source_type IN ('auction','fleamarket')); canonical_url text NOT NULL CHECK(length(canonical_url)<=1000); title text NOT NULL CHECK(length(title)<=1000); closing_price bigint NOT NULL CHECK(closing_price>0); ended_at timestamptz NOT NULL; condition_label varchar(50) NULL; normalized_condition varchar(30) NOT NULL CHECK(normalized_condition IN ('unused','near_unused','good','fair','poor','very_poor','unspecified')); condition_matched boolean NOT NULL DEFAULT false; tax_display varchar(20) NOT NULL CHECK(tax_display IN ('included','not_included','unknown')); match_score numeric(5,4) NOT NULL DEFAULT 0 CHECK(match_score BETWEEN 0 AND 1); match_reasons jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(match_reasons)='array'); exclusion_reasons jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(exclusion_reasons)='array'); condition_group_count int NOT NULL DEFAULT 0 CHECK(condition_group_count>=0); condition_median_price numeric(14,2) NULL; price_deviation_rate numeric(10,6) NULL; iqr_lower_bound numeric(14,2) NULL; iqr_upper_bound numeric(14,2) NULL; auto_outlier boolean NOT NULL DEFAULT false; inclusion_override varchar(10) NULL CHECK(inclusion_override IS NULL OR inclusion_override IN ('include','exclude')); included boolean NOT NULL DEFAULT false; decision_source varchar(20) NOT NULL DEFAULT 'automatic' CHECK(decision_source IN ('automatic','manual')); content_hash char(64) NOT NULL; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0053_market_price_search.sql |
| market_price_source_mappings | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; dimension varchar(20) NOT NULL CHECK(dimension IN ('category','brand')); registry_key varchar(150) NOT NULL; source_id varchar(32) NOT NULL CHECK(source_id ~ '^[1-9][0-9]{0,18}$'); canonical_name varchar(300) NOT NULL; aliases jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(aliases)='array'); status varchar(20) NOT NULL CHECK(status IN ('CONFIRMED','COMPATIBLE','DEPRECATED')); registry_version varchar(50) NOT NULL; verified_at timestamptz NOT NULL; expires_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0053_market_price_search.sql |
| market_price_image_upload_sessions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; identification_id uuid NOT NULL; image_id uuid NOT NULL; object_name text NOT NULL; mime_type varchar(100) NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')); size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760); sha256 char(64) NOT NULL; requested_by_membership_id uuid NOT NULL; expires_at timestamptz NOT NULL; completed_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0054_market_price_full_workflow.sql |
| market_price_images | id uuid PRIMARY KEY; organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; identification_id uuid NOT NULL; storage_object_id uuid NOT NULL UNIQUE; status varchar(24) NOT NULL CHECK(status IN ('uploaded','normalizing','ready','failed','deleting','deleted')); content_sha256 char(64) NOT NULL; width int NULL CHECK(width IS NULL OR width>0); height int NULL CHECK(height IS NULL OR height>0); expires_at timestamptz NOT NULL; deleted_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0054_market_price_full_workflow.sql |
| market_price_results | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; search_id uuid NOT NULL; snapshot_version int NOT NULL CHECK(snapshot_version>0); snapshot_hash char(64) NOT NULL; condition_filters_json jsonb NOT NULL CHECK(jsonb_typeof(condition_filters_json)='array'); outlier_policy_json jsonb NOT NULL CHECK(jsonb_typeof(outlier_policy_json)='object'); coverage_status varchar(20) NOT NULL CHECK(coverage_status IN ('complete','partial')); period_start timestamptz NOT NULL; period_end timestamptz NOT NULL; candidate_count int NOT NULL CHECK(candidate_count>=0); included_count int NOT NULL CHECK(included_count>0); minimum_price bigint NOT NULL CHECK(minimum_price>=0); median_price_before_outlier_exclusion numeric(14,2) NULL CHECK(median_price_before_outlier_exclusion IS NULL OR median_price_before_outlier_exclusion>=0); median_price numeric(14,2) NOT NULL CHECK(median_price>=0); maximum_price bigint NOT NULL CHECK(maximum_price>=0); exclusion_counts_json jsonb NOT NULL CHECK(jsonb_typeof(exclusion_counts_json)='object'); included_candidate_ids jsonb NOT NULL CHECK(jsonb_typeof(included_candidate_ids)='array'); confirmed_by_membership_id uuid NOT NULL; confirmed_at timestamptz NOT NULL DEFAULT now(); created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0054_market_price_full_workflow.sql |
| sso_enrollment_events | id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY; organization_id uuid NOT NULL REFERENCES organizations(id); user_id uuid NOT NULL REFERENCES users(id); request_id uuid NOT NULL; action varchar(30) NOT NULL CHECK(action IN ('prepared','reconciled')); created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0057_sso_local_enrollment_guard.sql |
| expense_days | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; branch_id uuid NOT NULL; owner_membership_id uuid NOT NULL; business_date date NOT NULL; opening_wallet_cash bigint NULL CHECK(opening_wallet_cash IS NULL OR opening_wallet_cash>=0); purchase_total bigint NULL CHECK(purchase_total IS NULL OR purchase_total>=0); status varchar(24) NOT NULL DEFAULT 'draft' CHECK(status='draft'); lock_version bigint NOT NULL DEFAULT 1; created_by_membership_id uuid NOT NULL; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0058_expense_settlement_records.sql |
| expense_items | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL; day_id uuid NOT NULL; spent_by_membership_id uuid NOT NULL; entered_by_membership_id uuid NOT NULL; business_date date NOT NULL; merchant varchar(200) NOT NULL; category varchar(40) NOT NULL; amount bigint NOT NULL CHECK(amount>0); payment_source varchar(20) NOT NULL CHECK(payment_source IN ('company_wallet','personal')); status varchar(20) NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','confirmed')); entry_source varchar(20) NOT NULL DEFAULT 'manual' CHECK(entry_source IN ('manual','synthetic_ocr')); receipt_status varchar(30) NOT NULL DEFAULT 'not_attached' CHECK(receipt_status IN ('not_attached','reference_pending')); note varchar(1000) NULL; lock_version bigint NOT NULL DEFAULT 1; confirmed_by_membership_id uuid NULL; confirmed_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0058_expense_settlement_records.sql |
| expense_followups | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL; day_id uuid NOT NULL; kind varchar(30) NOT NULL CHECK(kind IN ('funding_request','unreplenished','vault_discrepancy','report','correction_proposal')); status varchar(24) NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')); amount bigint NULL CHECK(amount IS NULL OR amount>=0); reason varchar(1000) NOT NULL; target_item_id uuid NULL; proposed_before jsonb NULL; proposed_after jsonb NULL; recorded_by_membership_id uuid NOT NULL; occurred_at timestamptz NOT NULL DEFAULT now(); resolved_at timestamptz NULL; lock_version bigint NOT NULL DEFAULT 1; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0058_expense_settlement_records.sql |
| expense_cash_permissions | organization_id uuid NOT NULL, branch_id uuid NOT NULL, membership_id uuid NOT NULL; authority varchar(16) NOT NULL CHECK(authority IN ('officer','delegate')); can_close boolean NOT NULL DEFAULT false, valid_from timestamptz NOT NULL, valid_until timestamptz NULL | packages/database/migrations/0066_expense_branch_closing.sql |
| expense_cash_policies | organization_id uuid NOT NULL, branch_id uuid NOT NULL; reconciliation_mode varchar(32) NOT NULL CHECK(reconciliation_mode IN ('external_reference','vault_ledger_v1')); policy_reference varchar(500) NOT NULL, version integer NOT NULL CHECK(version>0) | packages/database/migrations/0066_expense_branch_closing.sql |
| expense_branch_days | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_id uuid NOT NULL; business_date date NOT NULL, status varchar(24) NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed_balanced','closed_difference')); roster_note varchar(1000) NOT NULL; expected_cash bigint NULL CHECK(expected_cash>=0), actual_cash bigint NULL CHECK(actual_cash>=0); reconciliation_input jsonb NULL, reconciliation_version bigint NULL; lock_version bigint NOT NULL DEFAULT 1, closed_at timestamptz NULL; review_required boolean NOT NULL DEFAULT false; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0066_expense_branch_closing.sql |
| expense_branch_participants | organization_id uuid NOT NULL, branch_day_id uuid NOT NULL, day_id uuid NOT NULL; ready_at timestamptz NULL, ready_by uuid NULL | packages/database/migrations/0066_expense_branch_closing.sql |
| expense_cash_transfers | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_day_id uuid NOT NULL, day_id uuid NOT NULL; amount bigint NOT NULL CHECK(amount>0), performed_by uuid NOT NULL, recorded_by uuid NOT NULL; occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(); unreplenished_id uuid NULL, reverses_id uuid NULL, reason varchar(1000) NOT NULL | packages/database/migrations/0066_expense_branch_closing.sql |
| expense_branch_events | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_day_id uuid NULL, day_id uuid NULL; action varchar(40) NOT NULL, actor_id uuid NOT NULL, details jsonb NOT NULL; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0066_expense_branch_closing.sql |
| expense_branch_closures | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_day_id uuid NOT NULL; expected_cash bigint NOT NULL, actual_cash bigint NOT NULL, difference bigint NOT NULL; snapshot jsonb NOT NULL, snapshot_hash varchar(64) NOT NULL; closed_by uuid NOT NULL, closed_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0066_expense_branch_closing.sql |
| expense_branch_issues | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_day_id uuid NOT NULL; kind varchar(24) NOT NULL CHECK(kind IN ('cash_difference','post_close_correction')); status varchar(16) NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')); amount bigint NULL, note varchar(1000) NOT NULL, assignee_id uuid NOT NULL; resolution_note varchar(1000) NULL, resolved_by uuid NULL, resolved_at timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0066_expense_branch_closing.sql |
| ebay_retention_policies | organization_id uuid PRIMARY KEY REFERENCES organizations(id); content_days integer NOT NULL CHECK(content_days BETWEEN 1 AND 3650); approved_at timestamptz NOT NULL; approved_by_membership_id uuid NOT NULL | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| soldgraph_accounts | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); account_key varchar(100) NOT NULL UNIQUE; execution_mode varchar(24) NOT NULL DEFAULT 'emergency_stop'; credit_budget integer NOT NULL DEFAULT 0 CHECK(credit_budget>=0); pending_limit integer NOT NULL DEFAULT 1 CHECK(pending_limit BETWEEN 1 AND 200); calls_per_minute integer NOT NULL DEFAULT 60 CHECK(calls_per_minute BETWEEN 1 AND 60); usage_checked_at timestamptz NULL; usage_remaining integer NULL CHECK(usage_remaining>=0); usage_window_json jsonb NULL CHECK(jsonb_typeof(usage_window_json)='object'); usage_accounted_charged bigint NOT NULL DEFAULT 0 CHECK(usage_accounted_charged>=0); allow_extra_requests boolean NOT NULL DEFAULT false; usage_lease_owner uuid NULL, usage_lease_until timestamptz NULL; lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version>0); created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| ebay_market_price_searches | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT; branch_id uuid NOT NULL, created_by_membership_id uuid NOT NULL; identification_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES soldgraph_accounts(id); acquisition_mode varchar(10) NOT NULL DEFAULT 'latest' CHECK(acquisition_mode IN ('reuse','latest')); status varchar(30) NOT NULL DEFAULT 'queued'; plan_json jsonb NOT NULL CHECK(jsonb_typeof(plan_json)='object' AND pg_column_size(plan_json)<=32768); plan_hash varchar(64) NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'); product_basis_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(product_basis_json)='object' AND pg_column_size(product_basis_json)<=8192); exclusion_keywords_json jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(exclusion_keywords_json)='array'); outlier_percent numeric(5,2) NOT NULL DEFAULT 20 CHECK(outlier_percent>0 AND outlier_percent<=100); period_mode varchar(20) NOT NULL DEFAULT 'source_sample' CHECK(period_mode='source_sample'); cancel_requested_at timestamptz NULL, content_purged_at timestamptz NULL; failure_class varchar(60) NULL, lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version>0); created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| soldgraph_budgets | id uuid PRIMARY KEY DEFAULT gen_random_uuid(); account_id uuid NOT NULL REFERENCES soldgraph_accounts(id); scope_type varchar(16) NOT NULL CHECK(scope_type IN ('account','organization','membership')); organization_id uuid NULL REFERENCES organizations(id), membership_id uuid NULL; period_kind varchar(20) NOT NULL CHECK(period_kind IN ('lifetime','rolling_30_days','calendar_month')); calendar_timezone varchar(20) NOT NULL DEFAULT 'Asia/Tokyo' CHECK(calendar_timezone IN ('UTC','Asia/Tokyo')); credit_limit integer NOT NULL DEFAULT 0 CHECK(credit_limit>=0); valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NULL; OR (scope_type='organization' AND organization_id IS NOT NULL AND membership_id IS NULL); OR (scope_type='membership' AND organization_id IS NOT NULL AND membership_id IS NOT NULL)) | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| ebay_market_price_runs | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, search_id uuid NOT NULL; market varchar(2) NOT NULL CHECK(market IN ('us','uk','ca','au','de','fr','it','es')); status varchar(24) NOT NULL DEFAULT 'queued'; next_page integer NULL CHECK(next_page BETWEEN 2 AND 11); failure_class varchar(60) NULL, lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version>0); created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| ebay_market_price_pages | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL; search_id uuid NOT NULL, run_id uuid NOT NULL; account_id uuid NOT NULL REFERENCES soldgraph_accounts(id); market varchar(2) NOT NULL CHECK(market IN ('us','uk','ca','au','de','fr','it','es')); page_number integer NOT NULL CHECK(page_number BETWEEN 1 AND 10); attempt integer NOT NULL DEFAULT 1 CHECK(attempt>0); operation_key varchar(67) NOT NULL UNIQUE CHECK(operation_key ~ '^sg-[a-f0-9]{64}$'); request_json jsonb NOT NULL CHECK(jsonb_typeof(request_json)='object' AND pg_column_size(request_json)<=32768); request_id varchar(200) NULL CHECK(request_id ~ '^[A-Za-z0-9_-]+$'); cache_from_page_id uuid NULL; state varchar(24) NOT NULL DEFAULT 'reserved'; credit_state varchar(16) NOT NULL DEFAULT 'reserved'; credits smallint NULL CHECK(credits IN (0,1)); charged_at timestamptz NULL; failure_class varchar(60) NULL; retry_not_before timestamptz NULL; normalized_result_json jsonb NULL CHECK(jsonb_typeof(normalized_result_json)='object' AND pg_column_size(normalized_result_json)<=2097152); response_hash varchar(64) NULL CHECK(response_hash ~ '^[a-f0-9]{64}$'); parser_version varchar(60) NULL; processing_version varchar(60) NULL; lease_owner uuid NULL, lease_until timestamptz NULL; created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(); OR (credit_state IN ('reserved','pending','unknown') AND credits IS NULL)) | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| ebay_market_price_observations | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL; search_id uuid NOT NULL, page_id uuid NOT NULL; market varchar(2) NOT NULL CHECK(market IN ('us','uk','ca','au','de','fr','it','es')); observation_key varchar(200) NOT NULL; source_item_id varchar(15) NULL CHECK(source_item_id ~ '^[0-9]{9,15}$'); observation_json jsonb NOT NULL CHECK(jsonb_typeof(observation_json)='object' AND pg_column_size(observation_json)<=32768); manual_decision varchar(16) NOT NULL DEFAULT 'default' CHECK(manual_decision IN ('default','include','exclude')); decision_reason varchar(1000) NULL; changed_by_membership_id uuid NULL; lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version>0); created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| ebay_market_price_item_decisions | organization_id uuid NOT NULL, search_id uuid NOT NULL; source_item_id varchar(15) NOT NULL CHECK(source_item_id ~ '^[0-9]{9,15}$'); excluded boolean NOT NULL, reason varchar(1000) NOT NULL; changed_by_membership_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| ebay_market_price_results | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, search_id uuid NOT NULL; snapshot_version integer NOT NULL CHECK(snapshot_version>0); snapshot_json jsonb NOT NULL CHECK(jsonb_typeof(snapshot_json)='object' AND pg_column_size(snapshot_json)<=2097152); snapshot_hash varchar(64) NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'); confirmed_by_membership_id uuid NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| soldgraph_account_calls | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES soldgraph_accounts(id); called_at timestamptz NOT NULL DEFAULT now(), operation_key varchar(67) NULL; call_type varchar(10) NOT NULL CHECK(call_type IN ('submit','poll','usage')) | packages/database/migrations/0067_ebay_soldgraph_search.sql |
| purchase_result_policies | organization_id uuid PRIMARY KEY REFERENCES organizations(id); self_confirm_enabled boolean NOT NULL DEFAULT false; changes_enabled boolean NOT NULL DEFAULT false; reference varchar(500) NOT NULL | packages/database/migrations/0068_purchase_results.sql |
| purchase_results | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id); branch_id uuid NOT NULL, assessor_membership_id uuid NOT NULL; business_date date NOT NULL, purchase_amount bigint NOT NULL CHECK(purchase_amount>0 AND purchase_amount<=1000000000); status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','cancelled')); lock_version integer NOT NULL DEFAULT 1 CHECK(lock_version>0); created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0068_purchase_results.sql |
| purchase_result_revisions | id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL; result_id uuid NOT NULL, version integer NOT NULL, action varchar(24) NOT NULL; before_json jsonb NULL, after_json jsonb NOT NULL, reason varchar(1000) NULL; actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now() | packages/database/migrations/0068_purchase_results.sql |


### マイグレーション一覧

- `packages/database/migrations/0001_extensions_roles.sql`
- `packages/database/migrations/0002_org_users_rbac.sql`
- `packages/database/migrations/0003_visits_dynamic_forms.sql`
- `packages/database/migrations/0004_storage_drive_recordings.sql`
- `packages/database/migrations/0005_jobs_outbox_idempotency.sql`
- `packages/database/migrations/0006_transcripts_reviews.sql`
- `packages/database/migrations/0007_content_learning.sql`
- `packages/database/migrations/0008_retention_deletion_audit.sql`
- `packages/database/migrations/0009_rls_grants.sql`
- `packages/database/migrations/0010_indexes_partitions_seed.sql`
- `packages/database/migrations/0011_runtime_system_roles.sql`
- `packages/database/migrations/0012_retention_scheduler.sql`
- `packages/database/migrations/0013_transcription_provider_metadata.sql`
- `packages/database/migrations/0014_job_leases_media_metadata.sql`
- `packages/database/migrations/0015_visit_preparations.sql`
- `packages/database/migrations/0016_roleplay_sessions.sql`
- `packages/database/migrations/0017_worker_least_privilege.sql`
- `packages/database/migrations/0018_worker_chained_jobs.sql`
- `packages/database/migrations/0019_provider_idempotency_leases.sql`
- `packages/database/migrations/0020_content_separation_of_duties.sql`
- `packages/database/migrations/0021_content_publication_and_role_isolation.sql`
- `packages/database/migrations/0022_legal_hold_deletion_fence.sql`
- `packages/database/migrations/0023_retention_policy_enforcement.sql`
- `packages/database/migrations/0024_pilot_content_availability.sql`
- `packages/database/migrations/0025_retention_system_scheduler.sql`
- `packages/database/migrations/0026_async_speech_operations.sql`
- `packages/database/migrations/0027_runtime_metadata_retention.sql`
- `packages/database/migrations/0028_security_definer_rls_owner.sql`
- `packages/database/migrations/0029_visit_info_schema_bootstrap.sql`
- `packages/database/migrations/0030_worker_feature_flag_read.sql`
- `packages/database/migrations/0031_worker_retry_outbox_grant.sql`
- `packages/database/migrations/0032_worker_retry_outbox_read.sql`
- `packages/database/migrations/0033_visit_info_poc_schema.sql`
- `packages/database/migrations/0034_visit_schedule_local.sql`
- `packages/database/migrations/0035_nullable_unextracted_visit_fields.sql`
- `packages/database/migrations/0036_approve_baseline_ai_configuration.sql`
- `packages/database/migrations/0037_recording_consent_notice_hash.sql`
- `packages/database/migrations/0038_content_approval_batches.sql`
- `packages/database/migrations/0039_review_chunk_checkpoints.sql`
- `packages/database/migrations/0040_manual_transcript_input.sql`
- `packages/database/migrations/0041_training_video_storage.sql`
- `packages/database/migrations/0042_enable_content_approval.sql`
- `packages/database/migrations/0043_api_role_assignment_management.sql`
- `packages/database/migrations/0044_api_deletion_fence_insert.sql`
- `packages/database/migrations/0045_worker_visit_delete_upload_sessions.sql`
- `packages/database/migrations/0046_worker_visit_delete_upload_lock.sql`
- `packages/database/migrations/0047_worker_visit_delete_review_comments.sql`
- `packages/database/migrations/0048_poc_review_prompt_parity.sql`
- `packages/database/migrations/0049_transcript_quality_operations.sql`
- `packages/database/migrations/0050_canonical_feature_flag_rollback_note.sql`
- `packages/database/migrations/0051_retry_unavailable_transcript_quality.sql`
- `packages/database/migrations/0052_resume_unresolved_transcript_quality.sql`
- `packages/database/migrations/0053_market_price_search.sql`
- `packages/database/migrations/0054_market_price_full_workflow.sql`
- `packages/database/migrations/0055_market_price_suggestion_contract.sql`
- `packages/database/migrations/0056_market_price_source_switch.sql`
- `packages/database/migrations/0057_sso_local_enrollment_guard.sql`
- `packages/database/migrations/0058_expense_settlement_records.sql`
- `packages/database/migrations/0059_expense_candidate_review.sql`
- `packages/database/migrations/0065_expense_daily_record_recovery.sql`
- `packages/database/migrations/0066_expense_branch_closing.sql`
- `packages/database/migrations/0067_ebay_soldgraph_search.sql`
- `packages/database/migrations/0068_purchase_results.sql`
- `packages/database/migrations/0069_purchase_scope_validity.sql`
- `packages/database/migrations/0070_branch_address.sql`

## 7. 外部連携・ジョブ・設定

Identity Platform／有効な共通認証、Cloud SQL/PostgreSQL、Cloud Storage、Cloud Tasks、Worker、Vertex AI、Speech-to-Text V2、相場プロバイダーを既存構成に従って使用します。外部機能は設定・認可・機能フラグが揃った場合のみ利用できます。

### 質問機能の設定

| 変数 | 役割 |
|---|---|
| HELP_AI_ENABLED | trueで回答を有効化。未設定・falseでも記事検索は利用可能 |
| HELP_AI_PROJECT_ID | Vertex AIの対象プロジェクト。GOOGLE_CLOUD_PROJECTも利用可 |
| HELP_AI_LOCATION | global（既定）／asia-northeast1／us-central1 |
| HELP_AI_MODEL | 利用するGeminiモデル。既定gemini-2.5-flash、配備前に利用可否を確認 |


本番の認証情報はCloud Runサービスアカウントからmetadata経由で取得し、ブラウザへ渡しません。生の質問・回答・トークン・上流エラーはログへ出しません。必要なVertex AI権限は対象の実行サービスアカウントへ限定します。

## 8. 制約・未確認事項・検証結果・ソース参照

本仕様書の版はソース基準の初版です。ローカル単体・型検査、UI・API・本番検証の結果は docs/help-validation.md に記録します。未実行の項目を合格と記載しません。実機・読み上げ・全業務の顧客受入は別の確認です。

### 更新手順

1. docs/help の原稿と対象者・機能設定・画面リンクを更新する。
2. node scripts/build-help.mjs で生成JSONを更新する。
3. 画面・API・データ変更に対応して本仕様書と画面対応表を更新する。
4. 権限・回答・リンク・スマホの検証結果を記録する。
5. 公開リビジョン・image digest・固定URLでの確認結果を保存する。

### ソースの扱い

コード上の存在・ローカル検証・本番で有効な機能・クライアント承認を区別します。ヘルプの追加は業務処理の受入完了を意味しません。
