# 相馬さん向け 買取支援ツール デモ版／GCP版比較報告

## 1. 結論

**GCP版は、Vercelデモ版の主要機能を維持したうえで、限定本番運用に必要な認証、保存、権限、監査、復旧を追加した実運用版です。**

- PDF取込からAI振り返りまで、実Googleサービスで一貫稼働します。
- 固定Stage・公開環境の実ブラウザE2Eは各15/15 PASSです。
- 現在、運用を止めるCritical／High不具合はありません。
- 追加話者分類は実装しない方針です。混在音声は警告後に人が継続可否を判断します。

## 2. デモ版との比較

| 領域 | Vercelデモ版 | GCP版 | 評価 |
| --- | --- | --- | --- |
| 認証 | デモ用ログイン | Google Identity Platform、組織・店舗別RBAC | 強化 |
| 買取支援AI | AIチャット | 1,677件のコンテンツを根拠に回答 | 強化 |
| 訪問登録 | PDFから一括生成 | PDF起点で正式10項目を抽出し、人が根拠を確認・確定 | 強化 |
| 訪問前準備 | 顧客情報、心理、トーク、Q&A | 確定事実とAI生成を分離。法令4項目と根拠を追加 | 強化 |
| 音声 | 文字起こし済み文書・貼付け中心 | 録音同意、端末／Drive取込、private Storage | 強化 |
| 文字起こし | 既存テキストを利用 | Chirp 3、長時間処理、時刻付き区間、話者確認 | 強化 |
| 振り返り | 6領域の評価 | 同じ6領域＋実在発話の根拠＋保存・再実行 | 強化 |
| 現場知識 | トーク、フロー、用語、価格、マニュアル、法務 | PoC由来データを検索・一覧・詳細へ実接続 | 同等以上 |
| 研修 | 動画、AIロープレ、成績 | 動画、AIロールプレイ、保存・再開・自分の履歴 | 強化 |
| 管理 | 簡易管理 | コンテンツ版管理、二者承認、利用者、Job、保存期間、監査 | 強化 |
| 分析 | 個人成績を含む | チーム集約のみ。個人ランキング・人事評価は不採用 | 方針変更 |

## 3. 意図的に変更した点

以下は欠落ではなく、安全性と運用方針による変更です。

- APIキー入力を画面から廃止し、サーバー側Secretへ移行
- 匿名利用と共通管理パスワードを廃止
- 固定表示「880件」を廃止し、実データ件数を表示
- 個人ランキングと人事評価を不採用
- 未承認コンテンツは警告と根拠を表示して利用継続
- スマートフォンアプリ風UIではなく、PC/Web中心の業務画面へ再設計

## 4. 公開・検証結果

### 公開構成

| 対象 | Revision | Traffic |
| --- | --- | ---: |
| Web | `hanamaru-pilot-web-00097-koh` | 100% |
| API | `hanamaru-pilot-api-00201-yiz` | 100% |
| Worker | `hanamaru-pilot-worker-00112-ror` | 100% |
| 固定Stage Web | `hanamaru-pilot-stage-web-00019-lrn` | 100% |

- Release：`g-e9befa178c46`
- Source commit：`e9befa178c4601078c8192523dce51e7eadcfced`
- Cloud Build：`486cf140-92e1-4708-bf9b-921759a1d5da`／SUCCESS
- Migration：`0052_resume_unresolved_transcript_quality`
- [GitHub Release](https://github.com/soma-security-lang/hanamaru-shientool-prod/releases/tag/g-e9befa178c46)

### 受入結果

| 検証 | 結果 |
| --- | --- |
| 固定Stage実ブラウザE2E | 15/15 PASS |
| 公開URL実ブラウザE2E | 15/15 PASS |
| PDF→Vertex AI抽出→訪問準備 | PASS |
| 音声→Chirp 3→話者確認→AI振り返り | PASS |
| Manager／Assessor RBAC | PASS |
| 全20画面・旧Route・別タブ認証維持 | PASS |
| axe serious／critical | 0 |
| PC／Tablet／Mobile画像 | 60枚 |
| 運用ヘルス | `critical 0 / warning 0` |
| 既存の音声品質失敗3件 | 3/3復旧 |

品質判定で一時停止しても、文字起こし結果は失いません。保存済みTranscriptから品質判定だけを再開し、正常復帰時に運用アラートを解消します。

## 5. 現在の運用境界

- 話者分類は`査定員／顧客／未確認`です。
- 第三者、メディア、分析対象外の追加分類は実装しません。
- 多数話者、放送音声、長い非対話区間は自動検知します。
- 警告時は、人が確認して継続するか、音声を差し替えます。
- 未確認区間を査定員／顧客へ自動割当しません。

## 6. 相馬さんへの確認事項

技術受入は完了しています。実務面では、次の5点をご確認ください。

1. PDFから訪問を登録する流れが現場手順に合うか
2. 抽出10項目と訪問前チェックの文言に過不足がないか
3. 話者確認と音声品質警告が理解しやすいか
4. AI振り返り6領域が改善行動につながるか
5. デモ版で利用していた知識・研修機能へ迷わず到達できるか

## 7. 最終判定

**GCP版を限定本番運用の正本として利用できます。**

Vercelデモ版の主要業務体験は維持されています。GCP版では、実運用に必要な安全性、根拠、保存、権限、監査、復旧を追加しました。今後の確認事項は機能不足ではなく、実利用者による文言・操作感のHITLです。

## 8. 比較基準・根拠

- [Vercelデモ版](https://hanamaru-shientool.vercel.app/app.html)：HTTP 200、1,172,142 bytes、SHA-256 `defc22f7a8efb85113ed6cc2442441d4b523b95cff9db97298f6b53cda4c1f3f`
- [公開GCP版](https://hanamaru-pilot-web-tpqjzqidwa-an.a.run.app)：HTTP 200
- [Vercel版／GCP版 UI・機能差分台帳](./2026-08-18-vercel-gcp-difference-ledger.md)
- [Vercel版／GCP版 UI差分 修正管理台帳](./2026-08-18-vercel-gcp-correction-ledger.md)
- [公開GCP E2E／Vercel差分検出報告](./2026-08-19-live-e2e-and-vercel-parity-detection.md)
- [固定Stage・音声回帰・品質判定リカバリ Runbook](./2026-08-21-fixed-stage-release-and-audio-regression-runbook.md)
