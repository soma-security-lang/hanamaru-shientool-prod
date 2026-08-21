# 実音声・フォーム準拠PDF 公開GCP E2E／Vercel差分検出報告

## 0. 現在の公開状態（2026-08-21最終確認）

本章が現在値である。第1〜9章のFAIL／BLOCKEDは修正前の履歴、第10章以降は修正・再検証履歴として保持しており、現在の合否として読み替えない。

| 項目 | 現在値 |
| --- | --- |
| 公開Web | `hanamaru-pilot-web-00049-zel`／100% |
| 公開API | `hanamaru-pilot-api-00113-bif`／100% |
| 公開Worker | `hanamaru-pilot-worker-00068-kav`／100% |
| API readiness | `ready / database=ok / providers=gcp` |
| 公開ブラウザE2E | **13/13 PASS** |
| 全画面検証 | 20画面×3端末＝60枚、axe serious／critical 0 |
| PDF／訪問前AI | 正式10項目、根拠、訪問準備をPASS |
| 音声／AI振り返り | Chirp 3、話者確認、6領域、根拠照合をPASS |
| RBAC | Manager／AssessorをPASS |
| Content | 1,677件、cursor全件巡回、重複0・欠落0 |

本番主要経路を止めるCritical／Highの既知不具合は、この確認範囲では残っていない。FIX-002の新しい話者roleは明示的に対象外であり、混在音声を査定員／顧客へ自動推定してはならない。固定Stage Web、保存期間表示、運用監視等のFIX-001・003〜010は、本章の公開Revisionとは分離して実装・再リリース証跡を記録する。

> **履歴注記**：本書の初回FAILを受けてChirp 3経路を修正・再デプロイし、対象音声と追加2件の実音声で文字起こしを完了した。初回FAILの事実と原因は監査証跡として以下に残す。

## 1. 初回検証の結論（修正前）

修正前の公開GCP版を新規訪問1件で検証した結果、初回総合判定は **FAIL** であった。

- Identity PlatformのManager／Assessor認証、PDF保存、10項目抽出、訪問前AI生成、音声保存、音声Range取得は動作した。
- PDFの10項目はNFKC正規化後にすべて期待値と完全一致した。ただし全項目の`confidence`が未設定で、計画した品質メタデータ条件を満たさなかった。
- 45分音声のSpeech-to-Text V2 `chirp_3`はGoogle providerからcode 8（`RESOURCE_EXHAUSTED`相当）を繰り返し、文字起こしを生成できなかった。
- 再試行上限を超えたため対象Jobだけを取消した。案件、PDF、音声は削除していない。
- 文字起こしが存在しないため、話者確認、AI振り返り6領域、発話根拠、確認済み保存は **BLOCKED** とした。
- AssessorのAPI権限は成立したが、`/admin/users`の画面自体を開けるため、管理画面拒否要件はFAILとした。
- Vercelの主要機能に対してGCPは概ね拡張構成だが、公開環境には文字起こし実行不能、全件一覧到達性、公開済み振り返りプロンプトの3点で未完了が残る。

初回検証工程では、コード、GCP設定、Cloud Run traffic、Vercel、デプロイには変更を加えていない。その後の明示的なChirp 3修正依頼に基づく変更は第10章に記録する。

## 2. 検証対象

| 対象 | 実測値 |
| --- | --- |
| GCP Project | `monocle-503402` |
| Web | `hanamaru-pilot-web-00045-niw`／100% traffic |
| API | `hanamaru-pilot-api-00106-qem`／100% traffic |
| Worker | `hanamaru-pilot-worker-00048-mol`／100% traffic |
| API readiness | `ready`／database `ok`／providers `gcp` |
| Vertex AI | `gemini-2.5-flash`／`asia-northeast1` |
| Speech-to-Text | V2 `chirp_3`／`us` |
| Vercel比較元 | HTTP 200／1,172,142 bytes |
| Vercel SHA-256 | `defc22f7a8efb85113ed6cc2442441d4b523b95cff9db97298f6b53cda4c1f3f` |
| 実行時間 | 2026-08-20 19:01〜19:26 JST |

検証対象は公開Revisionであり、ローカルworktreeにある未デプロイの振り返りプロンプト同等化差分は合格根拠へ含めていない。

## 3. 入力データ

### 3.1 匿名デモPDF

- 成果物：[買取支援ツール_訪問情報_E2Eデモ.pdf](../../output/pdf/買取支援ツール_訪問情報_E2Eデモ.pdf)
- A4、1ページ、52,330 bytes
- 埋込みフォント：`STHeitiTC-Light-0`、TrueType、subset、Unicode対応
- SHA-256：`85476e65e0c3afc404075ff9b149b28b58186f490f454d2fc996258278882af3`
- レンダリング、文字抽出、文字化け、切れ、重なり、10項目の存在を検査済み

### 3.2 実音声

実音声のファイル名、ローカルpath、SHA-256、サイズはPUBLICリポジトリ版から除外した。約45分のMP3をGit外の一時領域からGCPへアップロードし、音声・文字起こし全文は証跡ディレクトリや本文へ複製していない。内部の非公開証跡にのみ厳密な入力fingerprintを保持する。

## 4. E2E判定

| 工程 | 判定 | 実測結果 |
| --- | --- | --- |
| 公開HTTP・readiness | PASS | Web応答、API `ready`、database `ok`、providers `gcp` |
| Manager認証 | PASS | `/`へ到達。ログインループ、API切替画面、開発メタ情報なし |
| Assessor認証 | PASS | `/visits`へ到達。Managerとは別Identity |
| PDF生成・視覚QA | PASS | CJK埋込み、A4、1ページ、10項目、文字抽出、目視QA完了 |
| PDF保存・抽出Job | PASS | `queued → running → succeeded`、attempt 1 |
| PDF抽出値 | PASS | 10/10キー、10/10値がNFKC正規化後に完全一致 |
| PDF根拠page／excerpt | PASS | 全10項目でpage有効、excerpt非空、PDF本文内に存在 |
| PDF confidence | FAIL | 全10項目で0〜1の数値を取得できなかった |
| 訪問前AI | PASS | 顧客事実10、心理4、法令4、トーク7、Q&A 7 |
| 訪問前AI根拠 | PASS | 11件の参照Content IDがすべて取得可能 |
| 未承認利用表示 | PASS | `pilot`、未承認利用あり、人による確認必須を返却 |
| 録音同意・音声保存 | PASS | 同意後に音声保存。duration 2,701.349秒 |
| 音声再取得 | PASS | Range requestがHTTP 206、Content-Rangeあり |
| Chirp 3文字起こし | FAIL | provider code 8を反復。attempt 9で取消し、segment 0 |
| 話者確認・確定 | BLOCKED | Transcript未生成 |
| AI振り返り6領域 | BLOCKED | 確定Transcript未生成 |
| AI発話根拠 | BLOCKED | Review未生成 |
| 保存・再読込 | PARTIAL | 訪問、PDF、準備、録音は保持。Transcript／Reviewは不存在 |
| Assessor案件scope API | PASS | 対象案件workspaceはHTTP 404 |
| Assessor管理API | PASS | `/admin/users`はHTTP 403 |
| Assessor管理UI | FAIL | `/admin/users`のRoute自体は表示され、明示的な権限拒否画面にならない |
| Vercel差分検出 | PASS | 下記の機能・要件差分を検出 |

### 4.1 PDF抽出値

| キー | 期待値 | 抽出値 | 値 | 根拠 | confidence |
| --- | --- | --- | --- | --- | --- |
| `visitDate` | `2026-08-20` | `2026-08-20` | PASS | PASS | FAIL |
| `visitTime` | `14:00` | `14:00` | PASS | PASS | FAIL |
| `customerLabel` | `匿名デモ顧客A` | `匿名デモ顧客A` | PASS | PASS | FAIL |
| `appraisalItems` | `ブランドバッグ2点、腕時計1点、金券5枚` | 同左 | PASS | PASS | FAIL |
| `visitAddress` | `東京都サンプル区1-2-3（架空住所）` | NFKC正規化後に同一 | PASS | PASS | FAIL |
| `contact` | `デモ連絡先（架空）` | NFKC正規化後に同一 | PASS | PASS | FAIL |
| `parking` | `敷地内1台` | `敷地内1台` | PASS | PASS | FAIL |
| `campaign` | `訪問査定デモ` | `訪問査定デモ` | PASS | PASS | FAIL |
| `notes` | `E2E確認用の架空情報` | 同左 | PASS | PASS | FAIL |
| `assignedStaffName` | `デモ査定員` | `デモ査定員` | PASS | PASS | FAIL |

抽出されたキーは正式10項目だけで、未定義キーやPDFにない値はなかった。

### 4.2 訪問前AI

訪問前AI Jobは`queued → running → succeeded`、attempt 1で完了した。

- 顧客事実：10件
- 想定心理：4件
- 法令確認：4件
- 想定トーク：7件
- 想定Q&A：7件
- 参照Content ID：11件、全件HTTP 200
- Content policy：`pilot`
- 未承認コンテンツ利用：あり
- 人による確認：必須

「未承認でも利用継続する」という限定運用方針どおり、利用を止めず警告と根拠を表示している。

### 4.3 文字起こし障害

- Job ID：内部の非公開証跡に保持
- Recording ID：内部の非公開証跡に保持
- 最終Job状態：`cancelled`
- 最終エラー：`PROVIDER_TEMPORARY`
- provider detail：Google STT V2 `chirp_3`処理失敗、code 8
- attempt：9
- Transcript：なし
- Segment：0件

Jobは初回処理後にバックオフ付き`retry_wait`へ入り、同じ処理でcode 8を反復した。計画した再試行上限を超えたため、追加課金と無制限再試行を防ぐ目的で対象Jobだけを取消した。

取消し後も録音リソースの状態が`transcribing`のままである。Job終端状態との不整合であり、画面上の処理中表示や再実行判断を誤らせるリスクがある。

## 5. 保存期間

組織の有効ポリシーはAPIで次のとおり確認した。

| 種別 | 日数 |
| --- | ---: |
| PDF | 180日 |
| 音声 | 90日 |
| Transcript | 180日 |
| Review | 180日 |
| Audit | 365日 |
| Video | 365日 |

private-only Cloud SQL read replicaから対象リソースの`retention_policy_id`を直接確認しようとしたが、ローカル端末からprivate IPへの到達経路がなく取得できなかった。したがって、対象PDF・録音に実際に保存されたpolicy IDの独立確認は **NOT TESTED** とする。テスト案件は削除していない。

## 6. Vercel／GCP差分

| 領域 | 判定 | 検出結果 |
| --- | --- | --- |
| 認証・権限 | GCP拡張 | Google Identity Platform、Bearer、membership、RBACへ強化。Assessor管理UIのRoute拒否だけ不足 |
| 買取支援AI | GCP拡張 | 根拠付きAIと1,676件Contentを使う構成。今回はAIホーム生成を実行していない |
| PDF・訪問前チェック | GCP拡張＋機能欠落 | 10項目の事実抽出と人の確定を分離。値は完全一致したがconfidenceなし |
| 録音・文字起こし | GCP拡張＋機能欠落 | 音声保存・Range再生は追加。実Chirp 3はcode 8で完了不能 |
| 振り返り | GCP拡張／未確認 | 根拠付き6領域の設計は存在するが、実音声E2EはSTT失敗で到達不能 |
| 振り返りプロンプト | 機能欠落 | Vercel同等化はローカルmigration 0048にあり、公開Revisionへ未反映。公開結果も今回未生成 |
| トーク・フロー・用語・価格・マニュアル・法務 | GCP拡張 | PoC由来件数をAPIで確認。検索・版・未承認警告を追加 |
| 動画 | GCP拡張 | PoC由来0件に対して公開GCPには動画1件が追加され、総件数は1,677件 |
| AIロープレ・練習履歴 | GCP拡張／未確認 | 保存・再開・履歴構成は存在。今回のlive操作対象外 |
| 管理・承認・分析 | GCP拡張 | ジョブ、保存、監査、承認、集約分析を追加。Assessor管理APIは拒否 |
| 個人ランキング | 意図的変更 | 実装しない方針を維持 |
| APIキー入力 | 意図的変更 | ブラウザの管理入力を廃止し、サーバー側Secretへ移動 |
| 1,676件到達性 | 機能欠落 | type別総数は確認できるが、一覧APIは最大100件でcursor条件が未実装。UI一覧だけで全件を順に辿れない |
| 保存・復旧 | GCP拡張＋未確認 | 有効ポリシーは確認。対象リソースへのpolicy ID適用は独立確認できず |

### 6.1 公開GCPコンテンツ件数

| 種別 | 件数 |
| --- | ---: |
| Talk | 1,156 |
| Flow | 159 |
| Glossary | 107 |
| Price | 76 |
| Manual | 6 |
| Legal | 4 |
| Roleplay | 168 |
| Video | 1 |
| 合計 | 1,677 |

PoC由来の1,676件はtype別総数上は保持され、動画1件が追加されている。ただし`GET /contents`は最大100件を返す一方で、返却する`nextCursor`を次の検索条件へ使用していない。画面も60件または80件表示であるため、「全1,676件を一覧から到達可能」は現在の公開環境では成立しない。

## 7. リスク一覧

| ID | 重大度 | リスク | 再現条件 |
| --- | --- | --- | --- |
| LIVE-001 | Critical | 45分音声のChirp 3が`RESOURCE_EXHAUSTED`で完了しない | 対象音声を録音同意後にアップロード |
| LIVE-002 | High | STT Job取消し後もRecordingが`transcribing`のまま | `retry_wait`のJobを管理取消し |
| LIVE-003 | High | 抽出confidenceが全項目未設定 | 正式10項目PDFを抽出してworkspaceを取得 |
| LIVE-004 | High | Assessorが管理Routeを開ける | Assessorで`/admin/users`を直接表示。API自体は403 |
| LIVE-005 | High | Content一覧のcursor未適用で全件巡回できない | 100件超のtypeを一覧表示 |
| LIVE-006 | High | Vercel同等の振り返りプロンプトが公開Revisionへ未反映 | 公開digestとローカルmigration 0048を比較 |
| LIVE-007 | Medium | 対象リソースの保存policy IDを公開APIから確認できない | 対象workspace／retention APIを取得 |

## 8. 証跡

証跡ルート：[`../../.artifacts/live-e2e/20260820T095247Z/`](../../.artifacts/live-e2e/20260820T095247Z/)

- `runtime-baseline.json`：Revision、digest、provider契約、readiness
- `result.json`：ブラウザE2Eの状態遷移とPDF／訪問前AI検証
- `post-stt.json`：音声、Range、STT終端状態
- `rbac.json`：Assessorブラウザ／API境界
- `retention-policies.json`：有効な保存期間
- `content-counts.json`：公開GCPのtype別件数
- `vercel-gcp-keywords.json`：Vercel SHA-256と公開語彙比較
- `gcp-log-summary.json`：対象時間帯のCloud Runログ要約
- `01-pdf-extraction.png`：匿名PDF抽出画面
- `02-preparation.png`：匿名訪問前チェック画面

証跡には音声本体、文字起こし全文、ID token、refresh token、署名URL、実メールアドレスを含めていない。スクリーンショットは匿名デモPDFと匿名訪問前情報だけを対象とした。

## 9. 初回完了状態（修正前）

| 区分 | 状態 |
| --- | --- |
| PDF成果物 | 完了 |
| 公開GCP新規案件1件 | 作成・保持 |
| PDF→訪問前AI | 完了 |
| 音声保存 | 完了 |
| Chirp 3文字起こし | 失敗・対象Job取消し |
| AI振り返り | BLOCKED |
| Assessor RBAC | API PASS／UI FAIL |
| Vercel差分検出 | 完了 |
| コード修正 | 未実施 |
| GCP／Vercel変更 | 未実施 |
| 再デプロイ | 未実施 |

この結果をもって「公開GCP版が実音声を含む1件の業務フローで完動する」とは判定できない。

## 10. Chirp 3修正・公開再検証（2026-08-20追補）

### 10.1 現在の結論

Chirp 3経路は修正・公開済みで、3件の実音声はすべて **PASS** した。文字起こし後の対象1件ではVertex AI振り返り6領域と発話根拠整合もPASSし、結果を`acknowledged`で再読込できた。

初回障害から次の3段階で原因を分離した。

1. BatchRecognizeの巨大inline応答を避け、native JSONとSRTをprivate GCSへ出力する方式へ変更した。
2. SRTに必要なword time offsetsを有効化した。Chirp 3の時刻付きBatchRecognize上限20分を守るため19分チャンクとし、codec frame境界の数ミリ秒重複を次チャンク開始時刻でclipした。
3. 60分超音声の特定19分区間でGoogle LROが停止する実測を受け、10分チャンクへ縮小した。最大8時間でも48 operation以内である。

### 10.2 公開Revision

| 対象 | 現在値 | Traffic |
| --- | --- | ---: |
| Web | `hanamaru-pilot-web-00045-niw` | 変更なし |
| API | `hanamaru-pilot-api-00027-dl6`／`sha256:edd7e0188b745cb13729a41c4a90f8625eec95c2baf9e3e9af916eb6f72b6f33` | 100% |
| Worker | `hanamaru-pilot-worker-00028-flj`／`sha256:1aee0506e5242fbf6f161520e0d870f2d268b9d3291d8567ca959323781b274a` | 100% |
| API readiness | `ready`／database `ok`／providers `gcp` | PASS |

Cloud BuildはAPI `13ef18d0-8574-471a-9283-fc8ac01870cc`、Worker `b2ad031e-e01a-4610-bc2a-1bccf32b9f4f`でDocker build、SBOM生成、Trivy HIGH/CRITICAL検査を通過した。現RevisionのCloud Run `ERROR`ログはAPI 0件、Worker 0件である。

### 10.3 実音声3件の結果

| 非公開入力profile | 長さの分類 | 結果 | 区間 | 話者label |
| --- | --- | --- | ---: | ---: |
| `private-audio-01` | 約45分 | PASS | 867 | 12 |
| `private-audio-02` | 約81分 | PASS | 1,071 | 27 |
| `private-audio-03` | 約73分 | PASS | 802 | 17 |

3件ともprovider `google-cloud-speech-to-text-v2`、model `chirp_3`、location `us`、非空本文、非空区間、区間ID重複なし、正の開始・終了時刻、全体の単調時系列を満たした。音声本文と文字起こし全文は証跡へ保存していない。

対象音声のAI振り返りは`strength / improvement / talk / compliance / next_action / revisit`の6領域を返し、全根拠IDが実在する発話区間へ接続した。Review Jobは`succeeded`、保存後状態は`acknowledged`である。

### 10.4 取消・清掃の追加修正

長時間音声の検証で、管理取消がtemporary GCSだけを消し、Google LRO自体を取消していない不具合も検出した。Speech providerへ`cancelTranscription`契約を追加し、API取消、Worker取消、案件削除時にcomposite operation内の全LROを取消してからtemporary dataを削除するよう修正した。

旧停止Operation 2件は明示取消した。途中停止した3ジョブのtemporary prefixと診断用prefixは、対象を完全一致で確認した後に削除した。正常な録音、Transcript、Review、テスト案件は削除していない。最終的な`local-validation/stt-input/`残存objectは0件である。

### 10.5 検証

- Node.js `22.16.0`
- Platform：30 tests PASS
- Worker：10 tests PASS（DB依存3件は別Gate）
- API：10 tests PASS（DB依存34件は別Gate）
- ESLint：PASS、warning 0
- TypeScript：PASS
- Production build：PASS
- Security scan：252 files、secret 0、non-anonymous email 0
- GitHub push：未実施
- Vercel変更：未実施

証跡：[`../../.artifacts/live-e2e/20260820T105632Z/`](../../.artifacts/live-e2e/20260820T105632Z/)

- `chirp3-continuation.json`：45分音声、Chirp 3、AI振り返り6領域、根拠整合
- `chirp3-additional-retry.json`：73分音声の成功と81分音声のprovider停止検出
- `chirp3-long-recovery.json`：81分音声の10分チャンク再実行PASS

なお、初回報告で挙げたPDF confidence、Assessor管理Route、Content cursor等はChirp 3修正の対象外であり、この追補によって自動的にCloseとはしない。

## 11. 全面回帰・公開最終検証（2026-08-21追補）

### 11.1 結論

公開GCP版の主要業務フロー、実AI、実Chirp 3、認証・RBAC、全20画面、1,677件Content、アクセシビリティ、レスポンシブ、保存・再読込を再検証した。検出したAI出力契約とContentページ送りを修正し、Web／API／Workerをdigest固定で段階公開した。

- 正式PDF10項目 → 抽出 → 人の確定 → 訪問前AI：**PASS**
- 45分音声と81分音声 → Chirp 3 → 話者確認 → 6領域AI振り返り → 保存再読込：**PASS**
- AIホームの根拠付き回答：**PASS**
- AIロールプレイの実回答・フィードバック・履歴：**PASS**
- Manager／Assessor、全20画面、旧Route、別タブ認証、API切替画面非表示：**PASS**
- 1,677件の全件cursor巡回：**PASS（重複0・欠落0）**
- 73分の混在音声：文字起こしは **PASS**、業務話者役割の確定と振り返りは **BLOCKED**

最後のBLOCKEDはSTT障害ではない。音声に査定会話以外の番組・複数話者が混在し、現行UIが`査定員 / お客様 / 未確認`の2役割しか持たないため、安全に人物を捏造せず`unknown`を維持した結果である。

### 11.2 公開Revision

| 対象 | 公開Revision | Image digest | Traffic |
| --- | --- | --- | ---: |
| Web | `hanamaru-pilot-web-00049-zel` | `sha256:7cabbc0d7bbbcf9673207de44afffa3474c033b59c6eee016726dc7f59d5ecd8` | 100% |
| API | `hanamaru-pilot-api-00113-bif` | `sha256:25e39f416784f3241273969a71c1da5bfc8414622072e26ac850f88d9b9cb6ab` | 100% |
| Worker | `hanamaru-pilot-worker-00068-kav` | `sha256:fa39c675d5c2afa9da253b8b2594c585b886e612793c5a10dfb218afcafde233` | 100% |

API readinessは`ready / database=ok / providers=gcp`。対象3 Revisionの公開後Cloud Run `ERROR`ログは各0件だった。

Cloud Buildは次の3本でDocker build、SBOM、Trivy HIGH／CRITICAL検査を通過した。

- Worker：`4ff9f173-8f3e-423f-b0c0-45342e5112f0`
- API：`1077cdcf-7e19-4f19-ba64-d8d9ee6d40ea`
- Web：`85c9fb9f-11be-4fe2-ac86-43ca2ad38347`

### 11.3 AI振り返りとロールプレイ

`private-audio-02`の確定済み1,071区間から新しいReviewを生成した。初期の公開Workerでは、長い入力に対するJSON打切りと、モデルが返す一時的な根拠IDをDBの発話UUIDとして扱う契約不整合があった。

修正後は入力発話へ短い一時aliasを付与し、モデル出力をサーバー側で実UUIDへ戻す。出力を6カテゴリ各1件、根拠最大3件、本文長上限付きに制約し、出力上限を8,192 tokenへ拡張した。

| 項目 | 結果 |
| --- | --- |
| Review Job | `succeeded`（attempt 1） |
| Review ID | 内部の非公開証跡に保持 |
| 6領域 | `strength / improvement / talk / compliance / next_action / revisit`、欠落0 |
| Finding | 6件 |
| 根拠 | 36件 |
| 未知Segment ID | 0件 |
| 空excerpt | 0件 |
| 保存状態 | `acknowledged`、再読込PASS |

AIロールプレイは`gemini-2.5-flash`の非空Customer応答、フィードバック1件以上、DB保存、完了、再読込を確認した。点数・順位・人事評価fieldは返していない。モデルがフィードバック0件を返した場合は、契約を満たすよう1回だけ再生成する。

### 11.4 話者labelと`unknown`の意味

Chirp 3の話者labelは人物IDではない。`chunk-3:1`のように、10分音声chunk内でモデルが分離した音声clusterを示す。同じ数値でも別chunkでは別人物の可能性があり、数値だけから`査定員`や`お客様`へ自動確定してはならない。

| 音声 | 区間 | chunk-local label | 査定員 | お客様 | unknown | 状態 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `private-audio-01` | 867 | 12 | 495 | 372 | 0 | Transcript confirmed／Review acknowledged |
| `private-audio-02` | 1,071 | 27 | 651 | 420 | 0 | Transcript confirmed／Review acknowledged |
| `private-audio-03` | 802 | 17 | 0 | 0 | 802 | Transcript generated／役割未確定 |

3件目の`unknown`は文字起こし失敗ではなく、役割未確認を正しく表す状態である。音声には複数人物・番組部分が含まれ、現行の二者会話モデルでは安全に割り当てられない。改善候補は`その他 / メディア / 分析対象外`の役割と、対象区間の除外操作である。

### 11.5 Content全件到達性

初回検証で、APIが`nextCursor`を返す一方、次回検索でcursorを使用していない不具合を再現した。APIを`display_order + id`の安定順によるkeyset paginationへ修正し、総件数は全ページで維持した。Webには「前のページ／次のページ」を追加し、検索語変更時は1ページへ戻す。

公開APIを低負荷・逐次で全件巡回した結果は次のとおり。

| 種別 | 期待件数 | 巡回件数 | 重複 |
| --- | ---: | ---: | ---: |
| Talk | 1,156 | 1,156 | 0 |
| Flow | 159 | 159 | 0 |
| Glossary | 107 | 107 | 0 |
| Price | 76 | 76 | 0 |
| Manual | 6 | 6 | 0 |
| Legal | 4 | 4 | 0 |
| Roleplay | 168 | 168 | 0 |
| Video | 1 | 1 | 0 |
| 合計 | 1,677 | 1,677 | 0 |

### 11.6 全テスト結果

| Gate | 結果 |
| --- | --- |
| Node.js | `22.16.0` |
| ESLint | PASS、warning 0 |
| TypeScript strict | PASS |
| Web unit | 156 PASS |
| Platform unit | 32 PASS |
| Database unit | 4 PASS |
| Worker non-DB unit | 10 PASS |
| API non-DB unit | 10 PASS |
| 48 migrations＋PoC import | PASS、1,676件 |
| Database integration | 19 PASS |
| Worker integration | 13 PASS |
| API integration | 45 PASS |
| Production build | PASS |
| Terraform fmt／validate／runtime contract | PASS |
| Security scan | 254 files、secret 0、実メール0 |
| Screen docs | 20画面／20Route／180状態／error 0 |
| Offline product E2E | 4/4 PASS |
| 公開ブラウザE2E | 13/13 PASS |
| 公開20画面 axe | serious／critical 0 |
| 公開スクリーンショット | 20画面×3端末＝60枚 |

公開ブラウザE2Eには全20画面、旧Route、別タブ認証維持、API切替画面非表示、PoC件数・検索、Contentページ送り、PC／Tablet／Mobile横幅、44px操作領域、axe、Assessor全管理画面拒否、60画像を含む。

### 11.7 残存事項

| ID | 重大度 | 状態 | 内容 |
| --- | --- | --- | --- |
| LIVE-001〜006 | Critical〜High | Closed／再検証済み | Chirp 3、取消後状態、confidence、Assessor Route、cursor、公開promptを修正・再確認 |
| LIVE-007 | Low | Open | active保存期間は確認済みで、作成時適用はDB結合test済み。ただし個別リソースのpolicy IDを公開workspaceから独立確認できない |
| LIVE-008 | Medium | Open | 混在・番組音声に`その他 / メディア / 分析対象外`がなく、二者へ安全に分類できない |
| RELEASE-001 | Medium | Open | Cloud Runのtraffic tag URLはIdentity Platformの承認済みdomainではないため、タグURLのブラウザ認証E2Eはログイン画面へ戻る。main URL切替後の全E2EはPASS |

本番主要経路を止めるCritical／Highの既知不具合は、この検証範囲では残っていない。ただし、3件目のような業務外混在音声を振り返り対象にするにはLIVE-008の仕様追加が必要であり、未対応のまま二者へ自動分類してはならない。

最終証跡：[`../../.artifacts/live-e2e/20260821T014700Z/`](../../.artifacts/live-e2e/20260821T014700Z/)

- `final-verification.json`：公開Revision、全テスト、3音声、AI、全件巡回の非秘密要約
- `final2-routes-60/`：公開中Revisionの20画面×3端末画像
- Playwright HTML／trace：失敗時のみ保持。最終実行は13/13 PASS

音声本体、文字起こし全文、AI本文、ID token、refresh token、署名URL、実メールアドレスは証跡へ保存していない。
