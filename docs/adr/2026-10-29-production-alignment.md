# 勤怠基準統一：本番対応と監査付き手動公開

更新：2026-10-29 JST。ユーザーは計画全体の実装、今回差分のcommit・push、Stage合格後の本番公開を承認し、GitHub公開範囲を変えない監査付き手動経路を選択した。

## 位置と不変条件

既存のローカル実装を継続する。旧PoCはCloud Runを引き続き拒否する。本番経路は別設定であり、ローカル制限を外して接続するものではない。

- 固定入口は `https://monocle-503402.firebaseapp.com/`。総務・勤怠の既存URLも維持する。
- 既存SQL migration、業務ID、RLS、membership、capability、監査、冪等性、Workerを保持する。
- 無関係な業務追加PR・canonical checkoutのdirty差分を取り込まない。DB統合・再採番・役職の製品間コピーはしない。
- この文書の作成時点では今回差分のStage／本番反映は未実行。ローカル試験、CI、image build、Stage、本番を別々に記録する。

## 本番経路

`HANAMARU_PRODUCTION_SESSION=true` を明示した登録済みWebだけが本番経路を使う。既定OFF。固定HTTPS origin、固定upstream、Cloud SQL socket／DB名、正式GCP provider、暗号鍵を検証する。設定不備は503／起動失敗とし、local providerや別writerへ戻さない。

`__session` はHttpOnly／Secure／SameSite=Lax／host-only。PKCEはサーバー保存し、変更操作はOrigin・CSRFで保護する。Hostingから渡されるtransport Hostはサーバー設定の明示リストだけを認め、利用者のforwarded Hostから許可先を作らない。固定Hosting入口での成立はStage試験が必要で、コード追加だけで合格とはしない。

セッションは製品DBの `alignment_sessions` に暗号化して保存する。専用loginにsession roleだけを付与する。鍵ringはSecret Managerの固定versionで供給し、active鍵で保存、以前の鍵で読取できる重複期間を設ける。期限切れ旧鍵の撤去は全該当session失効後とする。分散要求制限は `alignment_rate_limits` の原子的更新を使う。通常ログにtoken・Cookie・本文を出さない。

追加migration `0071_runtime_sessions.sql` はsession／制限テーブル・専用NOLOGIN roleだけを追加する。既存migrationは編集しない。LOGIN roleの資格情報は運用jobで生成してSecretへ直接渡す。DBを外部公開しない。Prismaによるschema生成・reset・db pushは行わない。

## 既存Googleログインの互換

共通SSOはサーバーCookie、Googleは当初のBearerを明示互換経路として残す。Googleの認証SDKは既存どおりで、サーバーがtokenをブラウザへ返すことはない。GoogleのCookie化完了とは報告しない。

API clientは登録済みサーバーsessionが有効ならCookieを使う。Cookieなし・未移行のGoogle利用者は従来のBearerを使う。期限切れ／停止済みSSO Cookieがある場合は、Googleへ自動fallbackせず401で止める。明示的なログイン操作だけが旧flowを破棄・再作成できる。

SSO CookieとBearerの混在は拒否する。共通IDの権限をGoogleへコピーしない。Google Drive同意時は、サーバーで現在のmembershipとGoogleのmembershipを比較する。Google Drive OAuthと製品ログインを混同しない。

## Native APIとPrisma

`HANAMARU_PRODUCTION_NATIVE_API=true` を別に指定した場合だけ、同じservice・認可・DTOのJSON APIをNextで実行する。正式GCP adapterと既存API roleを使う。対応外binary／非JSON／内部routeは本文を読む前に旧APIへ振り分ける。保存エラーやprovider障害を契機に別writerで再実行しない。

SSOは絶対8時間、短命access tokenはサーバーで更新する。CAS／leaseにより複数instanceでrefreshを二重実行せず、結果不明時のrefresh token再送はしない。停止・リンク取消・共通logoutは元のauth_timeと現行製品認可で再判定する。総務・勤怠の期限はこの変更で延長しない。

## 確認ケース

| ID | 必須の観測 |
|---|---|
| PROD-01 | 既定OFF、設定不備、stage→本番DBの誤接続、local providerを拒否 |
| PROD-02 | 鍵更新後の旧session読取、新鍵保存、未知鍵・暗号文差替えを拒否 |
| PROD-03 | 明示login開始、期限切れSSOのGoogle自動fallbackなし、logoutで失効 |
| PROD-04 | 別process・同時refresh、分散要求制限、RLS／専用roleの拒否 |
| PROD-05 | Google／共通ID／Driveの本人不一致拒否、製品role維持 |
| PROD-06 | native／旧APIの契約、保存再読込、同一キー再送、binary互換 |
| PROD-07 | 最新勤怠mainと3製品UI横断、共通logout、固定Hosting callback |
| PROD-08 | 同一digestのStage→本番、通常traffic read-back、旧版への切戻し |

未実行を合格にしない。次の結果追記までは、上記は受入条件であり実績ではない。

## 公開済みFAQ・独立Stageの保持

並行作業で公開されたWeb FAQ `201c3b0324f8b76cc819ee576aec2e4e9f3bb997` とAPI FAQ `5af6b6c13dbf434e1b902861a7d77833c64fc94c` のhelp機能を保持する。API commit全体にはUIやrelease手順を差し戻す変更もあるため、help部分だけを保持し、Native APIはhelpを旧API所有として扱う。公開版のFAQを統一版で消さない。

独立Stageは `alignment-stage-pg16` と製品別DBを使う。買取は `hanamaru_alignment_stage`、本番は既存の `hanamaru-pilot-postgres/hanamaru` だけを認める。並行セッションの `sso-review-pg16` への接続は拒否する。SQLはprivate IPのみ、既存VPCは参照だけとし、他環境のinstanceや権限を変更しない。

session以降の手動公開では、概要のbooleanだけでなく、exact SHA/digestに結び付くprivate DB試験receiptを検証する。新旧writerの保存・再表示、RLS、専用role、復元後read-backを必須とし、成功した本番backupと独立復元instanceの `RESTORE_VOLUME` 完了をCloud SQLから読み戻す。DB試験・backup・restoreが未実行の間は昇格できない。

## 追試状況（ローカルとCIを分離）

SSO開始画面で利用者APIを先行取得する競合を抑制し、auth画面を離れた後だけidentityを取得する回帰を追加した。関連Web 55件、型検査・lintが成功。Node専用GCP SDKはサーバーexternalに分離し、実imageでの起動確認を後続ゲートに残す。

固定コミット `829c9a3` はGitHub CI、Cloud Build `9694fd3a-d660-4e4c-8b59-869e94a57cb5` のimage/SBOM/修正可能High・Critical検査を通過した。ただし、その後のSSO・Stage境界の修正を認定するものではない。offlineブラウザ結果は35件合格・画像用1件skipであり、全ケース実行済みとはしない。Stage／本番は未反映。

## 10月29日ローカル検証

隔離PostgreSQLへ66 migrationを適用し、alignment/session/DB 27件、Native・server SSO 6件、Worker Prisma 2件、Worker契約4件、既存API Native互換92件を各コマンドで確認した。Web重点テストはログアウト失敗表示を含め64件合格。型検査・lint・文書契約21画面／189状態・manual release policy 12件を別に検査する。最初のDB試験ではPostgreSQL `name` 型の結果読取が失敗し、`current_role::text` へ明示変換して再試験した。失敗履歴を成功へ上書きしない。

証跡はprivateな `.artifacts/alignment/production-db-contracts-final-20261029.log`。鍵・本文・実人物情報は収録しない。ブラウザ回帰・production buildはCIへ継続し、今回SHAのStage／本番は未反映。
