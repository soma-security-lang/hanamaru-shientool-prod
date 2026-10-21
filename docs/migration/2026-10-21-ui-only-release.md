# UI限定の手動リリース

2026-10-21 23:42 JSTの本人依頼に基づく、候補674c254のUI差分のmain統合・UI限定手順整備・検証・固定URL公開を対象とする。一般のAPI/Worker/DBリリースは既存手順を維持する。

## 許可された対象と非該当条件

- Repository soma-security-lang/hanamaru-shientool-prod、project monocle-503402、asia-northeast1、既存hanamaru-pilot-webとhanamaru-pilot-stage-webだけを配備する。
- API/Worker/DB/共有contract/依存lockfile/認証/provider/ネットワーク設定に差分がない場合だけ利用できる。これらの変更があれば通常のfull releaseへ戻し、UI-onlyとして実行しない。
- 変更元は現行API/Worker/Webで確認したsource SHA。変更対象を限定したdiffと、既存隔離DB/Chromium/WebKitの35成功・1予定skip/89画像の製品source一致を証跡にする。
- 本番用コードは実origin/mainのHEADと完全一致、clean checkout、digest固定、固定Stageでの認証済み読取UI確認、同一Web digest、段階公開、ERROR確認、旧revisionへの切戻しを維持する。
- CIのPRIVATE/main保護/WIF/Environment承認の条件は変更しない。この手動経路は既存本人認証アカウントによる今回の明示的な差分・統合・公開承認の範囲で運用する。既存GitHub Actionsのgovernance preflightを無効化して実行しない。
- UI限定ではAPI/Workerの再配備、DBジョブ/backup/コンテンツ取込、外部AI/STTの再実行を行わない。認可/API契約不変のstatic証拠と既存隔離business E2Eを前提に、liveでは登録・保存・生成を行わない読取UI gateを実行する。非該当判定と実試験の範囲を混同しない。
- 本番アプリの既存本人sessionを使用する。新規利用者/ロール、恒久token、IAM/認証/authorized domain/referrer/CORS/DNSの変更は含めない。足りない場合はfail closed。

## 実行順序

1. 既存認証とremote/main、4サービスのactive100%revision/sourceを読取確認。秘密値を除く必要メタデータだけを保存する。
2. UI-only適合判定と品質gate、guardの失敗/切戻し試験を通し、通常main統合・push後の正確なSHAを固定。
3. 既存cloudbuild.web.yamlのSBOM/Trivy/provenanceを維持してWebだけをbuild。公開build引数は現行の公開設定と一致させる。
4. Stage/Webのimage以外を引き継ぎ、旧100%revisionを保存。固定Stageを同digest候補へ切替、既存本人のアプリ認証で21経路/主要画面・responsive・認証境界を読取検証。業務APIの更新要求は拒否して証跡化する。
5. Stage合格後、本番Webを1→10→50→100%で昇格。既存観測時間(15分/15分/30分)を維持し、各段階でヘルスとERRORを検証。
6. 固定Firebase URLと新source/revision/digest、主要画面/未認証境界、Monitoring/Terraformの既存安全確認を照合。未確認は未確認として記載する。
7. 失敗/中断時はStage/Webを保存した旧100%revisionへ戻す。API/Worker/DBを操作しない。失敗した切戻しはROLLBACK_INCOMPLETEとして報告する。

以前の汎用一括手順を無条件適用する提案は本UI作業では採用しない。UI-onlyの実装・判定・試験の詳細を本書へ追記する。

## 現在の検証と実行前提

UI-only適合/業務HTTP更新遮断の24件、既存release guard、lint/typecheck/unit、隔離DB/API/Worker175件、docs21画面/189状態/エラー0、秘密/実メール検査0件を確認した。製品コードは既存両browser正式E2Eの証跡sourceと同一treeである。live Google認証や公開の完了を意味しない。

`GCP_ACCOUNT`には今回本人承認された既存アカウントを実行時に明示し、default accountを書き換えない。`WEB_IMAGE`は既存Webレジストリのdigest固定、`BUILD_ID`は同じmain SHA tagを出力した成功buildだけを指定する。

`UI_GATE_REQUEST_FILE` / `UI_GATE_STATUS_FILE` は本人の通常Googleログイン済み一時browserと接続する。ID tokenやrefresh tokenのfile、既存user profileからのcookie抽出、custom token生成は用いない。live gateは23画面×4幅と匿名境界を読取検証し、業務APIのPOST/PUT/PATCH/DELETEを遮断する。実データの本文/スクリーンショットを保存しない。

`UI_DRIFT_EVIDENCE` は実際の承認済み正規Terraform planで得たsanitized結果であり、`status=PASS`、実mainの`sourceSha`、`resourceChanges=0`、`mutationPerformed=false`、開始前は`phase=pre-release`、公開後は`phase=post-release`を要求する。値・raw state・planファイルを保存/出力しない。入力不足や承認不足をPASSとして生成しない。この作業ではstate利用案が実行前拒否されており、追加承認または承認済みoperatorの結果提供が必要。前後のdrift gateを省略せず、後段未確認ならStage/Web trafficを旧版に戻す。
