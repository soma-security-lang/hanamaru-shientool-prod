# Terraform

`monocle-503402`へ適用する前のレビュー用IaC。現工程では`fmt/init/validate`までを実行し、`plan`は承認済みの変数・実image digest・Secret versionが揃った後、`apply`はGCP Gate承認後だけ実行する。

## 定義済みresource

- 必要API、Artifact Registry、VPC/subnet/private service connection
- private IPのCloud SQL PostgreSQL 16、backup/PITR/deletion protection
- private Cloud Storage bucket、Cloud Tasks queue
- Web/API/Worker用Cloud Run serviceと、認証済みGreen Gate専用の固定Stage Web service
- migration用Cloud Run Job、PoC content import用Cloud Run Job
- outbox dispatcherの毎分Cloud Scheduler、retention scanの日次Cloud Scheduler、operations scanの5分Cloud Scheduler
- runtime/job/scheduler別service accountと最小権限IAM
- API/Worker/Migrator別のSecret Manager container

## 適用前の必須作業

1. Secret Managerの値は別経路で登録する。tfvars、Git、plan出力へ値を置かない。
2. container imageはtagではなくdigestを指定する。
3. DB loginへ次のrole membershipをout-of-bandで付与する。

   - API login: `hanamaru_api_system`, `hanamaru_api`
   - Worker login: `hanamaru_worker_system`, `hanamaru_worker`
   - Migration login: `hanamaru_migrator`

4. `BOOTSTRAP_ORGANIZATION_ID`と`BOOTSTRAP_INITIAL_MANAGER_MEMBERSHIP_ID`を先に承認・固定し、Terraformの`initial_organization_id`と`content_import_owner_membership_id`へ同じUUIDを設定する。branch/user用UUIDもbootstrap前に固定する。migration後、下記の本番bootstrapをdry-run、二者確認、applyの順で実行する。
5. Google Identity ServicesとDriveで同じOAuth Web client IDを使い、Drive code popupのredirect URIをWeb originと一致させる。client secretはSecret Managerへ別経路で登録し、Terraform stateへ値を入れない。
6. Web imageは`NEXT_PUBLIC_API_BASE_URL`、Identity Platformの公開設定3値、`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`、`NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER`をbuild-argで埋め込む。Cloud Runのruntime envだけでは既にbuild済みの`NEXT_PUBLIC_*`を変更できないため、image build時の値とTerraform変数が一致することを検査する。`web_api_base_url`はこのbuild-argと同じ値にする。
7. public Web/API、custom domain/LB、Cloud Run ingress/IAMの境界をHITLで承認する。既定値は非公開。
8. `terraform plan`のproject ID、destroy、IAM拡張、public binding、Cloud SQL変更を二者確認する。

## GitHub Environment契約

`deploy.yml`は、`pilot`／`prod`のbuild-plan Environmentと、人間承認付き`pilot-apply`／`prod-apply` Environmentを使う。WIF用の先頭2 Secretはbuild-plan／apply双方へ、E2E用Secret・Variableはapply側へ登録する。短命ID tokenやrefresh tokenそのものをGitHub Secretへ保存しない。

- Secrets: `GCP_WORKLOAD_IDENTITY_PROVIDER`、`GCP_DEPLOY_SERVICE_ACCOUNT`、`E2E_SIGNING_SERVICE_ACCOUNT`、`LIVE_E2E_MANAGER_EMAIL`、`LIVE_E2E_ASSESSOR_EMAIL`
- Variables: `API_BASE_URL`、`IDENTITY_PLATFORM_AUTH_DOMAIN`、`GOOGLE_CLOUD_PROJECT_NUMBER`、`ALERT_EMAIL`、`LIVE_E2E_AUDIO_GCS_URI`、`LIVE_E2E_ASSESSOR_MEMBERSHIP_ID`

release runnerはWIFの短命access tokenでIdentity Platformの既存verified accountを検索し、`E2E_SIGNING_SERVICE_ACCOUNT`の`signBlob`でcustom tokenを作る。Identity Platform tokenは権限`0600`のrunner一時fileだけへ保存する。匿名音声は`LIVE_E2E_AUDIO_GCS_URI`で指すprivate GCS objectを1件だけ取得し、PDF→準備、音声→Chirp 3、AI振り返り、RBAC、20画面を検証する。準備に失敗した場合はTerraform applyへ進まず、終了時は成功・失敗を問わず一時fileを削除する。

Terraformのbinary planと完全な`show -json`はsensitive入力を含み得るためArtifactへ保存しない。build-plan jobはresource address／mode／type／actionだけのsummaryを承認用Artifactへ保存する。アプリrelease workflowで許す差分はCloud Run Web/API/Workerと4管理Jobのimage更新だけで、すべてupdate、delete 0を必須とする。人間承認後に同じdigestで再planし、sanitized summaryが承認版と完全一致した場合だけBlue/Greenへ進む。Terraform applyで先にrevisionを作らず、traffic 0%受入と段階昇格は`release-blue-green.sh`だけが行う。昇格後に再planしてdrift 0を必須化する。binary planとraw JSONは同一job内だけで使用し削除する。network、IAM、DB、Storage等のインフラ変更は、このアプリrelease workflowでは適用せず別の明示承認Gateとする。

`infra-change.yml`は非アプリ・非DBのTerraform変更専用である。アプリrelease用とは別のWIF provider／service accountを使い、provider conditionをこのworkflow、PRIVATE repository、保護済みmainへ固定する。`pilot-infra-apply`／`prod-infra-apply`のrequired reviewerを通し、起動時に指定したTerraform addressと実planを完全一致させる。create／updateだけを許し、delete／replace、Cloud Run service／Job、Cloud SQL instanceを拒否する。Cloud SQLは再起動や接続切替を伴い得るため、このworkflowから自動applyしない。

同一リージョンread replicaはpromotion候補として`REGIONAL`にする。replica自身の再構成中も現行primaryは接続先のまま稼働する。これは自動failoverではないため、promotionは最新backup、replication lag 0、書込みdrain、接続Secret更新、Cloud Run Green受入、rollback先をそろえた別Gateで行う。既存ZONAL primaryを直接`REGIONAL`へ変更する通常releaseは禁止する。

BrowserがCloud Run API URLへ直接接続する構成では、Web/APIともInvoker経路が必要になる。`allow_public_*`はアプリ内Google session/RBACとは別のネットワーク公開判断なので、custom domain/LB/IAPを採用しない場合だけ、二者承認後に明示的に有効化する。

private bucketのCORSは`cors_origins`だけを許可し、署名URLのGET/HEAD/PUTとchecksum metadata headerに限定する。origin追加はAPI CORS、Drive popup origin、Web image build引数と同じ変更としてレビューする。

## Release順序

1. digest固定imageを作成し、SBOM/vulnerability検査を通す。
2. Terraform planを承認する。
3. infrastructureをapplyする。
4. migration jobを一度だけ実行する。
5. Terraform入力と同じ承認済みUUIDで本番bootstrapのdry-run結果を確認し、`--apply`で初期organization、branch、招待中管理者、権限、保持・AI・Feature Flag設定を作成する。
6. 初期organizationとowner membershipがTerraform入力と完全一致することを読み取り確認してcontent import jobを実行する。
7. Worker、APIをdigest固定で段階昇格する。
8. 同じWeb digestを固定`hanamaru-<environment>-stage-web`へ反映し、認証、PDF、Chirp 3、振り返り、RBACを完走する。
9. Stage合格後だけ本番Webを段階昇格し、本番URLで最終E2Eを実行する。traffic-tag URLは認証Green Gateに使わない。

固定Stage originは作成後に一度だけ`../../scripts/configure-fixed-stage-origin.sh`でIdentity Platform authorized domain、Identity／Picker API key referrer、private bucket CORSへ追加する。既定はdry-runで、適用には`APPLY_FIXED_STAGE_ORIGIN=true`が必要である。処理は変更前を`.artifacts`へ権限`0600`で保存し、additive mutation後にread-backし、途中失敗時は元の完全一致値へrollbackする。

release tagは`g-<Git commit先頭12文字>`に固定する。正規表現、末尾ハイフン、Cloud Run service名との合計長を事前検証し、不正値を切り詰めて続行しない。Cloud Run labelとrelease証跡にはsource commit、Build ID、migration version、image digest、Revisionを記録する。

運用監視は`/internal/operations-scan`を5分間隔で呼び、`STT_HEARTBEAT_STALE`、`STT_LRO_TIMEOUT`、`RETRY_WAIT_OVERDUE`、`MODEL_OUTPUT_INVALID`、`EVIDENCE_INVALID`、`RETRY_LIMIT_EXCEEDED`を構造化ログから検知する。ログへ本文、発話抜粋、顧客識別子、provider raw payloadを含めない。

## Production DB bootstrap

実行loginはmigration適用と同じ`hanamaru_migrator`権限を使う。`.env.example`の`BOOTSTRAP_*`と`PILOT_CONTENT_AI_ENABLED`を、Secret Managerまたは権限`600`の一時環境ファイルから設定する。実メールをshell history、ログ、tfvars、Gitへ書かない。

```bash
# 既定はdry-run。DBは変更しない。
pnpm db:bootstrap:production

# dry-runのcreated/existingと入力値を二者確認した後だけ変更する。
pnpm db:bootstrap:production --apply
```

bootstrapは以下を1トランザクションで作成する。

- organizationと初期branch
- Googleログイン時にメールhashで紐付く招待中initial manager membership
- organization scopeの`manager`、`educator`、`content_approver`
- PDF、音声、文字起こし、振り返り、監査の保持ポリシー
- PDF抽出、訪問前準備、振り返りのprompt versionと育成用review criteria
- `content_approval`、`team_analytics`、`pilot_content_ai`のFeature Flag

全入力は必須で、organization、branch、初期manager user、初期manager membershipの4 UUIDをTerraform plan前に承認・固定する。保持日数と`PILOT_CONTENT_AI_ENABLED=true|false`も明示値が必要。同じ値での再実行は変更なし、IDを含む既存値との不一致は`BOOTSTRAP_DRIFT`で停止する。CLIの標準出力は作成・既存の項目名だけで、UUID、実メール、email hash、tokenを表示しない。これは`seed:dev`の代替ではなく、本番初期化専用である。

`terraform.tfvars.example`は構造例であり、そのままapplyできない。GCP変更は承認済みplanと適用後のread-back／drift 0を証跡化し、既存`monocle-*`資源へ触れない。
