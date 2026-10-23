# 勤怠基準移行：公開前ゲートの再確認

確認日：2026-10-23 JST。今回の変更だけのcommit・push、Stage合格後の本番反映はユーザー承認済み。ただし、承認は以下の不合格を合格へ読み替えるものではない。

## 判定

**BLOCKED — Stage／本番への反映は未実行。** ローカル専用実装を本番で有効にしていない。公開URL、実データ、実利用者ID・membership・権限、DB、既存trafficは変更しない。

## 読み取りで確認した事実

| 項目 | 確認結果 | 判断 |
| --- | --- | --- |
| GCP認証 | `ext.s.ri@2ndvillage.co.jp` のaccess-token取得が成功（値は非表示） | 認証切れが停止理由ではない |
| CLI既定project | `legalassistai-dev` | GCP操作は必ず対象project `monocle-503402` とregionを明示する。既定値は変更しない |
| 買取origin/main | `09d6fb1432e85a8bebd5342df078c2baba18e6ad` | 専用worktreeの基点と一致 |
| 総務origin/main | `204a4791a7f1abf7d726a0e89a58e816d6156cd4` | 専用worktreeの基点と一致 |
| 買取GitHub公開範囲 | API応答 `private=false` | 既定release preflightのPrivate必須条件と不一致。管理者が公開範囲を確認するまで今回の未公開差分をpushしない |
| 買取GitHub管理権限 | `push=true`、`admin=false`、`maintain=false` | 現アカウントで管理設定の整備を完了できない |
| 買取main保護 | `protected=false`、保護設定GETは404 | required review／`CI / verify`必須条件を満たさない |
| 買取Environment | 一覧に`pilot`のみ、`prod-apply` GETは404 | 本番applyのrequired reviewer／protected branch条件を検証できない |
| 総務main／Environment | main保護なし、Environment一覧は空 | 製品横断releaseの独立した承認経路が必要 |
| 本番SSO providerのtraffic | `soumu-sso-provider-00001-pcm`へ100% | latestReadyを稼働版と誤認しない |
| 同Revisionのimage | `us-docker.pkg.dev/cloudrun/container/hello@sha256:41057662708590d619ab7bcd0f90cd81679b6f924df11c0e9a4662c3b99b189a` | 共通OIDC provider稼働を証明しない。候補Revisionが存在しても本番有効とは扱わない |

GitHubの404単独では不存在を断定しない。一覧の結果と現権限を併記し、「承認設定を確認できない」ことを停止理由にする。GitHub設定、SSO traffic、既存ユーザー対応は変更していない。無関係のPR #31は取り込まない。

## 実装上残る公開条件

1. `local-session-runtime.ts`、`native-runtime.ts`、`localPrisma`、総務local session policyはCloud Run／非loopback接続を拒否する。ガードを削除して本番化しない。
2. 本番専用の設定検証・HTTPS固定origin・実provider接続・最小権限のsession永続DB・暗号鍵管理・監査・分散要求制限を実装し、ローカル設定と分離する。
3. 本番にsessionテーブルを作成するmigration／role付与は未作成・未適用。Prisma `db push`、reset、ローカルschemaの本番流用は禁止する。
4. 実ユーザーをメールで自動統合せず、不変subjectと既存製品IDの承認済みリンクを維持・照合する。既存Google経路を残し、対象ユーザーの移行・停止・復旧を検証する。
5. 公開HostingのCookie転送、実イメージ、固定Stageでの3製品UI横断、全体logout、既存業務回帰、旧Revisionへの切戻しを確認する。

## 今回実施した検査

- 両worktreeでlint／typecheck／unitコマンドが成功。実行ログは各製品のignored `.artifacts/`。買取unitは636件合格／139件skip。総務はTurbo 10 task成功（7 taskはcache再利用）、ログ上85件合格／18件skipであり、全件の新規実行とは扱わない。DB依存skipは合格へ換算しない。
- 買取のCookie Max-Age検査は実時計の1ms経過で300→299秒となる非決定性を検出した。時計を注入する既存テスト機構へ変更し、期限の期待値・実装を緩めずに再実行して成功した。初回の1件失敗は`.artifacts/alignment/release-unit.log`、修正後は`release-unit-final.log`に残す。
- 保存則検査：買取192対象、既存SQL・DB migration・Firebase・infraの想定外変更なし。総務84対象、業務SQL／methodの変更なし。
- コンテナ定義・inventoryのNodeテスト6件合格。実コンテナbuildは未実行。
- 限定secret scanner：買取691ファイル、総務291ファイル、候補0。除外・大容量・環境変数・生成物を網羅した保証ではない。
- 前工程の3製品UI横断はChromium／WebKitの2journey合格。今回は公開Stage未実行であり、その代用とはしない。

## 次の担当と解除条件

- **GitHub管理者**：買取repoのPrivate必須方針との不一致を解消し、main review／required CI／本番applyの人による承認環境を整備する。既定gateを削除・偽装して通さない。
- **実装担当**：上記本番runtime・DB／鍵・provider接続を実装し、対象版を固定する。ローカルcommitは中間成果の保全であり、本番readyの宣言ではない。
- **リリース担当**：承認・実装・CI・固定Stageがすべて合格した後、同一digestを既存URLへ昇格する。全機能OFFのStageを新SSO合格として扱わない。

公開設定・管理権限の不一致が判明したため、今回のpushと配備は停止する。追加の承認があっても、不合格テストや未実装の本番経路を省略しない。
