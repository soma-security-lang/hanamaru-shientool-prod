# 相馬さん向け 買取支援ツール デモ版／GCP版比較・公開完了報告

## 1. 結論

Vercelデモ版で確認できる主要な買取支援機能は、現行GCP版で維持されています。GCP版はデモ画面をそのまま移植したものではなく、実運用に必要な認証、権限、データ保存、非同期処理、根拠確認、監査、復旧を追加した本番運用向けの再構築版です。

2026年8月24日時点の公開GCP版では、固定Stageと公開URLの両方で実ブラウザE2Eを各15件実行し、PDF取込、Vertex AI訪問準備、Chirp 3文字起こし、話者確認、音声品質判定、AI振り返り、保存・再読込、Manager／Assessor権限、全20画面、アクセシビリティ、60画面画像をすべてPASSしています。

現時点で本番主要経路を止める既知のCritical／High不具合はありません。音声に第三者や放送音声が混在する場合の話者種別追加は、協議の結果、実装しない方針としています。現行版では混在リスクを検知して警告し、人が確認して継続または音声を差し替える運用です。

## 2. 比較対象

| 項目 | Vercelデモ版 | GCP版 |
| --- | --- | --- |
| 公開URL | [デモ版](https://hanamaru-shientool.vercel.app/app.html) | [GCP版](https://hanamaru-pilot-web-tpqjzqidwa-an.a.run.app) |
| 2026-08-24 HTTP確認 | 200 | 200 |
| 配信物 | 単一HTML主体のデモ | Next.js Web＋API＋Worker＋PostgreSQL＋private Storage |
| Vercel配信物 | 1,172,142 bytes | 対象外 |
| Vercel SHA-256 | `defc22f7a8efb85113ed6cc2442441d4b523b95cff9db97298f6b53cda4c1f3f` | 対象外 |
| GCP release | 対象外 | `e9befa178c46` |
| 評価目的 | 業務機能と利用イメージの確認 | 実データ・実Google providerを使う限定本番運用 |

Vercel配信物のサイズとSHA-256は過去の比較基準と一致しており、今回の比較中にデモ側の変更は検出されませんでした。

## 3. 機能比較

| 領域 | Vercelデモ版 | 現行GCP版 | 判定 |
| --- | --- | --- | --- |
| ログイン | デモ用ログイン、簡易な管理導線 | Google Identity Platform、membership、組織・店舗scope、RBAC | GCP拡張 |
| 買取支援AI | AIチャットとして支援 | 1,677件のコンテンツを検索し、根拠を表示するAI支援 | GCP拡張 |
| 訪問登録 | 訪問前チェックの中でPDFを利用 | PDFを起点に訪問を作成し、正式10項目を抽出・根拠確認・人が確定 | GCP拡張 |
| 訪問前チェック | 顧客情報、心理、トーク、Q&Aを一括生成 | 確定事実とAI生成を分離し、心理、法令4項目、トーク、Q&A、Content根拠を保存 | GCP拡張 |
| 音声取込 | 文字起こし済みDrive文書や貼付けが中心 | 録音同意、端末音声／Drive取込、private Storage、音声検査 | GCP拡張 |
| 文字起こし | 既存テキストを振り返りへ利用 | Speech-to-Text V2 `chirp_3`、長時間処理、時刻付き発話区間、話者cluster確認 | GCP拡張 |
| 音声品質 | 明示的な品質判定なし | 多数話者、メディア混入、長い非対話区間、判定不能を警告 | GCP拡張 |
| 振り返り | 良かった点、改善点、トーク、法令、次回助言、再訪可能性 | 同じ6領域を保持し、実在発話IDの根拠、再実行、確認済み保存を追加 | GCP拡張 |
| 履歴 | 振り返り履歴 | 案件、処理状態、結果、再読込を統合した履歴 | GCP拡張 |
| 現場知識 | トーク、フロー、用語、価格、マニュアル、法務 | PoC由来全件を検索・一覧・詳細へ接続。件数固定表示を廃止 | 同等＋拡張 |
| 研修 | 動画、AIロープレ、成績表示 | 動画、AIロールプレイ、保存・再開・フィードバック・自分の履歴 | GCP拡張 |
| コンテンツ管理 | 種別ごとの簡易管理 | 8種別、版、プレビュー、公開状態、二者承認 | GCP拡張 |
| 利用者管理 | スタッフ／管理の分岐 | 招待、複数role、所属、停止、自己権限変更防止 | GCP拡張 |
| 運用管理 | API設定等のデモ管理 | Job、再試行、保存期間、削除、Legal Hold、監査、運用ヘルス | GCP拡張 |
| チーム分析 | 個人成績を含む表示 | 集約指標のみ。個人ランキング・人事評価は実装しない | 意図的変更 |

## 4. デモ版から意図的に引き継いでいないもの

次の差は機能欠落ではなく、安全性と運用方針による変更です。

- ブラウザ上でのAPIキー入力・保存は廃止し、サーバー側Secretへ移しました。
- 匿名利用や共通管理パスワードは廃止し、Google認証と正式な権限判定へ置き換えました。
- デモ上の固定表示「880件」は使わず、データから実件数を計算しています。
- 個人ランキング、点数による人事評価は実装していません。
- 未承認コンテンツは利用停止にせず、限定運用中であることと人による確認が必要であることを表示します。
- Apple製品やスマートフォン画面の模倣は行わず、PC/Web中心の業務UIへ再設計しています。

## 5. 現行GCP版の公開・検証結果

### 5.1 公開構成

| 対象 | Revision | Image digest | Traffic |
| --- | --- | --- | ---: |
| Web | `hanamaru-pilot-web-00097-koh` | `sha256:27e55db34610f5e84cf907d98e2791bc4ebe954a898262b0b93329807308c466` | 100% |
| API | `hanamaru-pilot-api-00201-yiz` | `sha256:ed590bf90efb248cccc6e695709a57231fbaa535e38c1ff3ff14b1c752bab97b` | 100% |
| Worker | `hanamaru-pilot-worker-00112-ror` | `sha256:dd6b580c65871766b28e2b30e7865ac6af914adf3a89f90912c3da2bfe29be16` | 100% |
| 固定Stage Web | `hanamaru-pilot-stage-web-00019-lrn` | Webと同一digest | 100% |

- Git commit：`e9befa178c4601078c8192523dce51e7eadcfced`
- Git tag：`g-e9befa178c46`
- Cloud Build：`486cf140-92e1-4708-bf9b-921759a1d5da`／SUCCESS
- Migration：`0052_resume_unresolved_transcript_quality`
- [GitHub Release](https://github.com/soma-security-lang/hanamaru-shientool-prod/releases/tag/g-e9befa178c46)

### 5.2 受入結果

| 検証 | 結果 |
| --- | --- |
| 固定Stage実ブラウザE2E | 15/15 PASS |
| 公開URL実ブラウザE2E | 15/15 PASS |
| PDF→Vertex AI抽出→訪問準備 | PASS |
| 音声→Chirp 3→話者確認→AI振り返り | PASS |
| 20画面・旧Route・別タブ認証維持 | PASS |
| Manager／Assessor RBAC | PASS |
| axe serious／critical | 0 |
| PC／Tablet／Mobile画像 | 60枚生成 |
| 1,677件Contentの検索・ページ送り | PASS |
| 運用スキャン後のヘルス | `critical 0 / warning 0` |
| 既存の音声品質失敗3件 | 3/3復旧、Job `succeeded` |

文字起こし成功後の音声品質判定が失敗した場合も、Transcriptと発話区間は失いません。品質判定だけを耐久ジョブとして再試行し、WorkerやRevisionが途中停止しても保存済みTranscriptから再開します。正常復帰時は`MODEL_OUTPUT_INVALID`等の運用アラートを解消します。

## 6. 残存する制約と運用判断

| 項目 | 現在の扱い |
| --- | --- |
| 第三者／メディア／分析対象外という追加話者分類 | 実装しない方針で確定 |
| 放送・多数話者・長い非接客区間 | 自動検知して警告。人が確認して継続、または音声を差し替える |
| 実Google providerの一時障害 | durable retryと明示的な再実行導線で復旧 |
| バックエンド・DB・Storage | GCP内で実接続済み。デモfixtureを通常導線に使用しない |
| 未承認コンテンツ | 警告と根拠を表示したうえで利用継続 |

追加話者分類を実装しないため、メディア混在音声を査定員／顧客へ自動的に割り当てることはしません。警告が出た場合の人による確認を運用条件とします。

## 7. 相馬さんに確認いただきたいポイント

技術的な受入は完了しています。最終的には、実際の業務利用者として次をご確認ください。

1. PDFから訪問を登録する導線が現場の手順に合うか。
2. 抽出10項目と訪問前チェックの文言が実務で過不足ないか。
3. 話者clusterの割当と音声品質警告が理解しやすいか。
4. AI振り返り6領域が査定員の改善行動につながるか。
5. Vercelデモで使っていた知識・研修機能へ迷わず到達できるか。

## 8. 最終判定

**GCP版を限定本番運用の正本として利用可能です。**

Vercelデモ版の主要業務体験は維持され、GCP版では実運用に必要な安全性、保存、復旧、根拠、監査、権限が追加されています。技術検証上の未解決Critical／Highはありません。以降は新規開発を必須とする状態ではなく、実利用者の文言・操作感に関するHITLと通常監視の段階です。

## 9. 根拠文書

- [Vercel版／GCP版 UI・機能差分台帳](./2026-08-18-vercel-gcp-difference-ledger.md)
- [Vercel版／GCP版 UI差分 修正管理台帳](./2026-08-18-vercel-gcp-correction-ledger.md)
- [公開GCP E2E／Vercel差分検出報告](./2026-08-19-live-e2e-and-vercel-parity-detection.md)
- [固定Stage・音声回帰・品質判定リカバリ Runbook](./2026-08-21-fixed-stage-release-and-audio-regression-runbook.md)
