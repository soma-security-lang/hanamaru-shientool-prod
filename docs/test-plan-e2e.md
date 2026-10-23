# UI先行公開のE2E計画

対象：`release/ui-alignment-20261023`。2026-10-23。既存Google認証を維持するCSS限定差分。公開可否はE2Eと依存監査・既存release gateを別々に判定する。

| ID | 対象 | 期待結果 |
| --- | --- | --- |
| UI-01 | 既存offline-stack全シナリオ／Chromium・WebKit | 隔離PG16・合成データで既存業務が維持される。21画面・8幅、axe、画像89枚を既定手順で検証する |
| UI-02 | 技術詳細の表示・コピー・通知 | 13px以上、44pxの操作領域、長いIDの折返しとスクリーンリーダー通知を維持する。見える画面は画像で確認する |
| UI-03 | 固定Stageの認証済み読取 | 既存管理者で23画面×4幅・匿名401・新deployment IDを確認し、業務writeは遮断する |
| UI-04 | 固定本番URL | Stageと同一digest、既存認証・API接続、UI-03相当の読取、既存API/Worker Revision不変、前後driftを確認する |

起動：`E2E_CHROMIUM_CHANNEL=chrome OFFLINE_E2E_WEB_PORT=3146 OFFLINE_E2E_API_PORT=3246 OFFLINE_E2E_WORKER_PORT=3346 OFFLINE_E2E_POSTGRES_PORT=55446 OFFLINE_E2E_TRACE=off pnpm test:e2e:offline`。ローカル以外へ待受しない。fixtureは既存scriptが終了時に削除する。実AI・有料外部APIへ接続しない。

公開確認は通常Googleログインを一時browser内で行い、token・cookie・認証stateを取り出さない。業務データ本文・実画面画像は証跡として保存しない。ログイン未完了・依存監査不合格・drift未確認の場合はStage／本番未実行と記録する。

過去のSSO横断結果は今回の証跡に流用しない。初回Chromium起動失敗、再実行、意図的skip、依存監査の不合格は成功数と分けて報告する。
