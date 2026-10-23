# 既存認証を維持するUI先行公開

2026-10-23のユーザー承認に基づく限定release。勤怠基準移行の全差分は取り込まない。

## 今回の変更

- 技術詳細欄の文字を13px以上、行間1.6とし、見出し・項目間の余白を整理する。
- 長いID・ラベルの折返しと狭い画面のgrid縮小を改善する。コピー操作の44px領域と読み上げ通知を維持する。
- 対象は既存CSS Moduleと本書だけ。認証・API・DB・Worker・契約・依存lockfile・Next設定・配備設定・公開URLは変更しない。
- 全面UI刷新ではない。Tailwind導入を含むbuild依存変更、Prisma、native API、永続Cookie session、共通SSOの本番化は別工程に保持する。

## 品質・公開条件

既存の `scripts/release-ui-only.sh` と `ui-only-eligibility.mjs` を変更せず使用する。対象sourceの全両browser/DB E2Eと89画像を確認し、正式なread-only Terraform drift確認、本人の通常Googleログイン、固定Stageでの画面・匿名境界検査を通す。同一Web digestのみを本番へ昇格し、API/WorkerとDBは変更しない。失敗時は旧Web/Stage Revisionへ切り戻す。

既存のfull-release Private/main保護/Environment/WIF gateは変更しない。UI限定の手動経路は既存の明示承認付き運用に従う。不足証跡・アクセス拒否・ログイン失敗を成功として記録しない。外部AIへの実データ送信、業務write、新規権限付与を行わない。

## 検証状態

この文書の作成時点で、今回のsourceに対するbuild・Stage・本番検査は未実行。過去の共通SSOローカル検証を今回の公開合格証跡として流用しない。実行後のsanitized結果はignored `.artifacts/` に保持する。
