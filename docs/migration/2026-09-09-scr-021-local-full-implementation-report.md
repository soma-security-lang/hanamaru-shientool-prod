# SCR-021「買取相場（仮）」ローカル・フル実装 完了報告

## 現況サマリー

| 境界 | 判定 | 根拠 |
| --- | --- | --- |
| ローカルfixture製品 | PASS | production buildのWeb／API／Worker／PostgreSQLを起動し、21画面を実走 |
| SCR-021 fixture業務フロー | PASS | 画像＋AI補助、手入力＋AI補助、手入力のみを確定・履歴まで完走 |
| Vertex AI実接続 | PASS | 匿名1件、`gemini-2.5-flash`、商品候補1件・検索語3件 |
| Yahoo実接続 | PASS | HTTP 200、100件、終了日時の最新順、Parser v1.0.0一致 |
| Googleログイン込みローカル実接続UI | BLOCKED | 追跡対象外のルート`.env.local`と分離したManager／Assessor受入設定が未配置 |
| GCP公開環境 | NOT TESTED | 今回はデプロイ対象外 |
| GitHub／本番Feature Flag | NOT CHANGED | push・Feature Flag有効化とも未実施 |

fixture合格や外部provider単体合格から、Googleログイン込みの実接続UI合格を推定しない。本番にも反映していない。

## 実装範囲

- PC Sidebarとスマホ下部ナビへ`/market-price`を追加した。
- MP-01〜MP-06をNext.jsの単一URL状態として実装し、商品入力、検索条件確認、取得状況、候補確認、相場結果、履歴を接続した。
- 最大5画像、JPEG／PNG／WebP、1枚10MB、合計50MB、magic bytes、SHA-256、重複、最大辺2048px、EXIF除去、24時間削除を実装した。
- AI提案は利用者入力と分離し、商品候補と検索語を採用・編集・却下してから検索を開始する。
- Yahoo URL Generator、100件単位、最新順、直近90日、最大20ページ、checkpoint、24時間cache、安全停止をWorkerへ接続した。
- 候補の手動除外・復帰、20%初期閾値の外れ値再計算、immutable結果確定、再読込、retry、cancel、repeatを実装した。
- organization RLS、最小権限DB role、assessor／manager capability、system_admin本文非表示を実装した。
- 既存migrationのチェックサムを維持し、提案DTO補正は新規`0055`へ分離した。
- 検索語、完全Yahoo URL、生HTML、生AI応答、画像内容を通常ログ・監査へ出さない。

## 自動検証

| 検査 | 結果 |
| --- | --- |
| ESLint | PASS |
| TypeScript strict／script check | PASS |
| Web component | 21 files／182 tests PASS |
| Market price domain | 2 files／11 tests PASS |
| Platform | 8 files／45 tests PASS |
| API | 7 files／52 tests PASS |
| Worker | 5 files／22 tests PASS |
| PostgreSQL integration | 5 files／21 tests PASS |
| DB runtime role境界 | PASS |
| Next production build | PASS |
| Terraform／runtime contract | PASS |
| Secret／PII scan | 297 files、secret 0、非匿名メール 0 |
| 画面設計契約 | 21画面、21 route、189状態、error 0 |
| Quality gate | 3 tests PASS |

## ブラウザE2E・画像

- E2E：19 PASS、1意図的SKIP、3.4分。
- Browser：Chromium／WebKit。
- 対象：全21画面、PDF→訪問準備、音声→文字起こし→6領域振り返り、相場3経路、RBAC、retention、operations。
- Accessibility：axe serious／critical 0。
- Responsive：320／360／390／430／768／834／1024／1440pxで全21画面の横スクロールなし。
- 画像：390／834／1440pxの63枚＋中核7画面の360／430px 14枚＝77枚。
- 証跡：`.artifacts/offline-e2e/20260909T110045Z/`

SCR-021の目視確認では、スマホの検索履歴をアイコン操作へ縮退し、タブレットの入力方式3件を縦配置に変更した。本文16px以上、44px操作領域、下部ナビとSticky Actionの非重複を維持している。

## 外部provider実接続

匿名のカメラ商品情報1件だけを使用し、低頻度の専用smoke testを実行した。

| 項目 | 結果 |
| --- | --- |
| Vertex AI model | `gemini-2.5-flash` |
| 商品候補 | 1件 |
| 検索語候補 | 3件 |
| Yahoo HTTP | 200 |
| Yahoo source／parsed | 100件／100件 |
| 並び順 | 終了日時の最新順 |
| Page size | 100 |
| Parser | v1.0.0、期待版と一致 |

検索語、商品タイトル、完全URL、HTMLは証跡へ保存していない。ハッシュと件数だけを保存した。

- 証跡：`.artifacts/local-connected-market-price/20260909T110517277Z/result.json`
- 再実行：`LIVE_MARKET_PRICE_DATA_CLASSIFICATION=anonymous-approved GCP_PROJECT_ID=monocle-503402 VERTEX_LOCATION=asia-northeast1 VERTEX_AI_MODEL=gemini-2.5-flash pnpm local:e2e:market-price:connected`

## ローカル起動確認

`pnpm local:up:fixture`相当をproduction buildで起動し、Web、API、Worker、PostgreSQLがすべてrunning、Web HTTP 200、API／Worker `status=ready`、DB `ok`、provider `local`を確認した。その後`pnpm local:down`で全processを停止し、DBと検証logだけを保持した。

永続ローカルDBでは適用済みmigrationのチェックサムを変更しないことも再起動で確認した。`0055`だけが追補として適用される。

## 残る受入条件

Googleログインを含む`pnpm local:up`と、その画面からの90日境界までの実Yahoo Worker走行は未実行である。開始には次の追跡対象外設定が必要になる。

- permission 0600のルート`.env.local`
- Identity Platform／Google Pickerのlocalhost設定
- 分離したManager／Assessor受入アカウント
- OAuth client secret、token encryption key、GCP bucket設定

これらは秘密値または利用者アカウントの意思決定を含むため、推測で作成していない。コード・fixture・外部provider境界は検証済みだが、この受入だけはBLOCKEDとして残す。

## 変更していないもの

- GCPサービス、Cloud Run、Cloud SQL、GCS、Identity Platform
- GitHub remote、branch、release
- 本番`market_price_search` Feature Flag
- 既存20画面のAPI／DB／認証方式
- 訪問案件との相場結果連携
