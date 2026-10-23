# 既存認証維持・Web安全更新の限定公開

## 承認と対象

2026-10-23の明示承認「Next.jsの安全更新を含めて進める」に基づく。通常のUI-only条件を緩めるのではなく、`scripts/release-web-security.sh` からのみ選ぶ `next-security-20261023` という今回専用profileを追加する。

- Web基点：`09d6fb1432e85a8bebd5342df078c2baba18e6ad`。
- API／Workerの実配備source：`9a70aba8e2e9c8292609e553c874e222586a5ae3`。Web基点とbackend treeは同一だが、ラベルを同一と偽らず別々に検査する。
- 技術詳細のCSS改善に、Next／eslint-config-nextの正確な `16.3.8 → 16.4.1` と対応するNext familyのlock変更だけを加える。他の依存・認証実装・API・Worker・DB・権限・Next設定・Dockerfileは変更しない。
- Firebase公開URL、既存Googleログイン、Bearer、既存データ、API／Worker Revisionを維持する。共通SSO、永続セッション、Prisma、native APIの本番対応は別工程。
- 個人情報・認証情報・業務writeを試験に利用しない。通常の既存管理者ログインは本人が専用一時Chromeで行う。cookie／token／storageを他ブラウザからコピーしない。

## セキュリティ根拠

対象は [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw)、[GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr)、[GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)。検出は依存バージョンに基づき、実配備での悪用成功を意味しない。既存画像previewはunoptimized、sharpは既に0.35.5、確認したsourceにuse cache／Server Actionsはない。既存用途を変えず公式修正版へ更新する。

独立読み取り調査と独立candidate reviewを各1回実施。レビューでCloud BuildアーカイブにGit履歴がない問題を発見し、unitは合成contract fixture、配備CLIは実Git比較に分離した。Git履歴を利用できない条件でも検査する。

## 不変条件と検査

1. 通常UI-only profileはpackage／lockの変更を引き続き拒否する。新profileは固定baseline、許可path、manifest全体の意味差分、全lock graphの意味差分、レビュー済みlock SHA-256を検査する。
2. backend treeは固定の実配備sourceと同一でなければ拒否する。認証・proxy・DB・infra・workflowのpathは許可しない。
3. Next更新後のclean candidateで隔離DB・production build・Chromium／WebKitの全offline E2Eを取り直す。旧16.3.8の証跡は流用しない。
4. Cloud Buildは既存のlint／typecheck／unit／docs／secret検査に、新profile contractとproduction auditを追加。SBOM・Trivy・provenanceは維持し、High／Criticalを無視しない。
5. Web限定の手動経路でも、通常ログイン、実read-only Terraform plan、固定Stageのread-only画面確認、匿名API拒否、同一digest、backend Revision不変、段階traffic、ERRORログ、rollback、公開後driftを維持する。full-releaseの別gateは変更しない。
6. Terraformの読み取りでは既存opt-in設定を参照する。新しい設定を有効化せず、差分がある場合は止める。planをapplyしない。

## 実行手順

1. 現行main・公開Revision・並行差分・承認を再確認し、今回のファイルだけcommitする。
2. 新candidateのlocal gateとbrowser gateを実行し、失敗／skip／未実行を分ける。
3. 承認済みの今回差分だけmainへfast-forward push。Webだけを既存公開設定のままCloud Buildする。
4. regional buildの成功・イメージdigestとsource・SBOM／image scanを照合する。
5. 本人が固定Stage／Firebase本番で通常ログインする。現行sourceに対する実read-only driftが0であることを確認する。
6. `release-web-security.sh` に実証跡を渡し、固定Stage→同一digestの本番段階公開を行う。API／Worker／migration／Firebase Hosting設定は配備しない。
7. 公開URLでsource・画面・権限・匿名境界・ERRORログを確認し、post-release driftを確認する。不合格なら旧Web／Stageへrollbackする。

通常配備・Stage・本番の成功は、それぞれ実行完了後にだけ記録する。後続SSO作業のローカル合格を公開の合格と混同しない。

## ローカル確認：安全更新直後

- lint、typecheck、unit、docs、release guard成功。
- 通常UI-only＋新profile contractは54件成功。Git履歴を利用不可にしたarchive条件でも54件成功。
- production auditはHigh／Critical 0で成功。Moderate 3件・Low 1件は残存しており、全脆弱性0とはしない。
- この記載時点では新candidateの全offline E2E、cloud image build、固定Stage・本番は未実行。後続結果は実行証跡と分離して追記する。
