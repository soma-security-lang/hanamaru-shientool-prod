# 固定Stageリリース・匿名音声回帰 Runbook

## 1. 境界

- 対象は`monocle-503402`の`hanamaru-pilot-*`だけとし、既存`monocle-*`資源へ触れない。
- traffic-tag URLはRevision識別とrollbackにだけ使い、ブラウザ認証のGreen Gateには使わない。
- 実音声、文字起こし全文、token、署名URL、実メールはGit、Artifact、ログ、文書へ保存しない。
- FIX-002は対象外。音声品質警告が出ても新しい話者roleを発明せず、人の確認なしに振り返りを開始しない。

## 2. 固定Stage originの一度限りの設定

Terraform planで`google_cloud_run_v2_service.stage_web`、Storage CORS、Scheduler、Logging metric、Alert policyだけが意図どおり追加・更新されることを承認する。Stage Web作成後、次を実行する。
正本の`live-terraform-plan.sh`は`allow_public_stage_web=true`を明示し、Cloud Run入口だけを到達可能にする。業務データへのアクセスは引き続きIdentity PlatformのBearer認証とAPIのmembership・RBACで制御する。

```bash
# 読み取り、backup、差分要約だけ。GCPは変更しない。
scripts/configure-fixed-stage-origin.sh

# dry-run出力とbackup先を二者確認した後だけ適用する。
APPLY_FIXED_STAGE_ORIGIN=true scripts/configure-fixed-stage-origin.sh
```

scriptはStage serviceの固定URIをIdentity Platform authorized domain、Identity／Picker API key referrer、private bucket CORSへ加算し、read-back完全一致を確認する。途中失敗時はbackup値へrollbackする。

実行主体がIdentity Platform Admin configのread権限を持たない場合、REST readの`403 PERMISSION_DENIED`で変更前にfail-closeする。権限を黙って拡張せず、承認済み管理者がGCP Consoleで同じ固定domainを追加するか、必要最小限の権限を持つ実行主体へ切り替えた後にscriptを再実行し、API key／CORSを含むread-backを完了する。

## 3. 匿名3音声profile

macOS `say`と`ffmpeg`から、Git外の一時領域へ匿名音声を生成する。private GCSの専用prefixへだけアップロードする。

```bash
UPLOAD_ANONYMOUS_AUDIO=true \
ANONYMOUS_AUDIO_GCS_PREFIX=gs://PRIVATE_BUCKET/anonymous-regression/v1 \
scripts/generate-anonymous-audio-regression.sh

node scripts/validate-anonymous-audio-regression.mjs \
  .artifacts/anonymous-audio-regression/manifest.json
```

manifestへ保存するのはprofile、GCS URI、object generation、SHA-256、duration、codec、期待品質flagだけである。音声本文、Transcript、segment、ローカルpath、利用者情報を含めない。

| Profile | Release Gate |
| --- | --- |
| `normal_dialogue` | STT→話者確認→振り返りまで成立 |
| `multi_speaker` | `many_speakers`警告、明示確認なしの振り返り拒否 |
| `media_mix` | `possible_media / long_non_dialogue`警告、明示確認なしの振り返り拒否 |

## 4. リリースとread-back

- `GIT_COMMIT_SHA`はpush済み`main`の40文字lowercase SHAと完全一致させる。
- Web/API/Workerはdigest-pinned imageだけを受け付ける。
- Worker→API→固定Stage Webの認証付き全E2E→本番Webの順で昇格する。
- Stage Webと本番Webのimage digestが完全一致しなければ停止する。
- 最終`result.json`のcommit、Build ID、migration、各digest、RevisionとCloud Run実値を機械照合する。
- 本番E2E、readiness、Cloud Run ERROR 0、Monitoring policy有効、Terraform drift 0を確認して完了とする。

## 5. 文字起こし後の音声品質判定リカバリ

- Chirp 3の文字起こし成功後に品質判定のmodel出力または根拠契約が不正だった場合、文字起こしJobを成功終了させず`retry_wait`へ戻す。
- 再試行では保存済みTranscriptとsegmentだけを読み、音声の再送信、Chirp 3 LROの再作成、Transcriptの再生成を行わない。
- retryは既存Job、lease、attempt、outboxのdurable契約で継続し、WorkerやCloud Run revisionが途中で停止しても次のdispatchが同じ品質判定を再開する。
- 品質判定が成功した時点で`MODEL_OUTPUT_INVALID`／`EVIDENCE_INVALID`のactive alertを即時resolveし、5分間隔のoperations scanでも候補外であることを再確認する。
- 利用者が`continue`または`replace`を選択済みの場合、その判断をretryで上書きせず、自動復旧対象から除外する。
- migration `0051_retry_unavailable_transcript_quality.sql`は、Review未生成、削除処理外、人の継続判断なしの既存失敗だけを再試行へ戻す。既存Transcriptは保持する。
- rolling release中に旧Workerが0051のeventを先に消費しても、migration `0052_resume_unresolved_transcript_quality.sql`が未解決の安全な対象だけを新しいdeduplication keyで再投入する。Speech-to-Textは再送せず、保存済みTranscriptから品質判定だけを再開する。
- 画面はSTT実行中と品質判定再試行中を区別し、保存済みTranscriptと発話区間を品質判定の復旧待ちでも表示する。
- STTのprovider operationと一時入力はTranscript保存直後に後処理し、品質判定の再試行へ持ち越さない。Operations scanもTranscriptが存在するjobを`STT_LRO_TIMEOUT`候補から除外する。
- 品質判定のVertex構造化出力は、現在処理中のchunkに実在する発話aliasだけをresponse schemaの列挙値として許可する。未知の根拠IDは保存せず、契約修復またはdurable retryへ送る。
