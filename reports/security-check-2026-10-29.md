# 勤怠基準統一：範囲限定セキュリティ確認

日付：2026-10-29 JST。対象：`release/attendance-stack-20261029` の永続セッション・Native API切替・公開手順。基準commitは `09d6fb1432e85a8bebd5342df078c2baba18e6ad`。AIによる静的確認であり、包括的監査・本番安全性保証ではない。

## 結果

秘密情報の静的走査719ファイルで検出0件。1MB超・バイナリ・生成物・除外ディレクトリ・Git履歴は対象外。認証の本番有効化、Cloud SQLへの追加migration、鍵配備は未実行で、静的合格を公開合格へ転記しない。

- `production-config.ts`：登録service・HTTPS origin・Cloud SQL socket・DB名・正式providerを限定。未設定は既定OFF、誤設定は拒否する。
- `session-gateway.ts`：変更操作はOriginとCSRFを検証。SSO CookieとBearer混在・期限切れCookieからの暗黙fallbackを拒否。
- `session-store.ts`：暗号化、version付き鍵ring、DB lease/CAS。`0071_runtime_sessions.sql` は既存業務テーブルを変更せず、専用role以外の直接参照を拒否。
- `session-audit.ts`：固定操作名・状態・request ID・revisionのみ。token・自由記述・Cookieを通常ログへ複製しない。
- `manual-alignment-release.mjs`：固定SHA・CI・Cloud Build digest・Stage receipt・既存trafficの照合。従来の標準ゲートを緩和しない別の承認済み公開経路。

## 依存関係

pnpm 11.17.0のproduction audit。`@firebase/firestore` 配下の `re2js` を2.8.7へ限定更新後、High/Criticalは0件。Moderate 5件・Low 4件は残存し、到達性・全修正を確認済みとは扱わない。根拠：[GHSA-gg6h-894w-4m9c](https://github.com/advisories/GHSA-gg6h-894w-4m9c)。依存名・versionのみレジストリへ照会し、ソースは送信していない。

## 要確認・未検査

StageのHosting Cookie往復、実Googleログイン、実SSOの承認済みID対応、鍵Secret権限、LOGIN role、分散instanceでの実時間運転、実配備の侵入試験は未検査。これらは静的検査で代替せず、有効化の前に実施する。実利用者データや認証情報を試験用に複製しない。
