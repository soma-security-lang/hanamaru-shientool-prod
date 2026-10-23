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

## 継続結果：2026-10-23 20:51 JST

**公開判定はBLOCKED。Stage・本番未実行。** 以下は今回のUI source `9e23ae2a3ad6c24ec453797c5e94e6ef88dfd6c9` の結果であり、共通SSOの結果ではない。

- lint／typecheck／unit成功。unitは563件合格、125件skip。skipはDB依存などで、合格には含めない。
- UI公開適合／write遮断のNode testは24件合格。認証・API・Worker・DB・contract・依存lockfile・infra・Firebaseの対象treeは基点`09d6fb1432e85a8bebd5342df078c2baba18e6ad`と同一。
- 隔離PG16・実API/Worker・Next production build・両browserの最終実走は35件合格、1件予定skip、失敗／flaky 0。89画像、21画面×8幅、axe、経費・ランキング・相場・PDF・音声の既存シナリオを確認した。予定skipはWebKitでの重複画像取得で、既存正式gateの扱いを維持する。
- UI-02の技術詳細は両browserで320/390/834/1440pxの13px以上、44px操作領域、横はみ出しなしを確認。390/1440pxの合成画面画像も目視確認した。
- 初回はChromium同梱binary不足で1件失敗・17件未実行・17件合格・1件skip。既存Chrome channelを明示して再実行した。次の実走で親CSSによる文字サイズ上書きを2件検出し、component scopeだけを修正後、上記の最終結果を得た。これらを成功履歴で上書きしない。
- 証跡：`.artifacts/ui-first/`、最終fixtureは`.artifacts/offline-e2e/20261023T114706Z/`。最終Playwright JSONは`ui-first/playwright-fixed.json`。一時DB/API/Worker/Webと一時ログイン試験browserは停止した。

## 公開を止めている依存監査

`pnpm audit --prod --audit-level high` は不合格。既存Next.js 16.3.8にCritical 2件・High 1件のadvisoryを検出した。修正候補は16.4.1以上。

- GHSA-2464-fhr4-w9xw（画像最適化APIのSVGに関するadvisory）
- GHSA-673q-mjm6-r5xr（typed arrayを返すuse cacheに関するadvisory）
- GHSA-p3m5-59mp-jv5r（Server ActionsのDoSに関するadvisory）

監査はバージョン検出であり、実配備での悪用可能性を確定したものではない。他にModerate 3件・Low 1件がある。今回のCSS変更で依存は変えていない。通常のUI-only gateを削除したり、lockfile更新禁止を黙って緩めたりせず、Web安全更新を含める範囲と手順の確認を求めている。

従ってUI-01/02のローカル結果と、未実行のUI-03/04・依存監査FAILを分離する。既存scriptのローカル`PASS`を公開全体のPASSとは扱わない。main・公開URL・本番data/role/trafficは変更していない。UI差分だけを`release/ui-alignment-20261023`へpushし、全体SSO移行branchは混ぜていない。
