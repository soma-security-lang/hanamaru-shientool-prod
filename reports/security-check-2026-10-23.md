# 勤怠基準移行：限定セキュリティ確認

## 継続：長時間SSO経路の限定確認

2026-10-23の追加差分を確認した。包括的な差分監査や公開環境の安全保証ではない。実装・動作試験の合否は [結果台帳](../docs/adr/2026-10-23-alignment-test-results.md) と分ける。

- 8時間の絶対上限は検証済みのauth_timeに結び付け、Cookieの延長だけでアクセスを継続させない。server側refreshはissuer・sub・auth_timeを固定し、更新前後に承認リンク・停止・共通logoutを確認する。membershipと現在の権限は既存APIが判定する。
- refresh tokenは暗号化payloadにのみ保存し、ブラウザ・通常ログへ返さない。CSRF・origin・混合credential拒否を維持する。flowは引き続き5分、一度のみ消費する。
- 同じCookieのrefreshにCAS leaseを使う。同一key更新のversionを増分させてABAを拒否する。旧tokenの遅延401では、別の更新済みcredentialを無条件に削除しない。再評価はidentity読取に限定し、業務writeの再送は行わない。
- 不明なrefresh結果は再送せず再ログインを要求する。logout中に更新応答が来ても消えたsessionを復活させない。待機要求が6秒を超えた場合は503、排他期限切れはfail closed。
- 総務のoffline_access／refresh許可は新しいlocal policyで既定OFF・Cloud Run禁止・loopback・専用DB・買取clientだけに限定する。本番client設定や他製品の権限を転記しない。
- テスト専用control口は `e2e/alignment-real-sso-fixture.mjs` のみ。独立プロセス、強い一時secret、合成subjectとsession keyだけを対象とし、アプリの通常APIへ登録しない。実接続テストはtrace・認証state・画像を保存しない。
- 限定scannerは買取server13・総務SSO9ファイルで候補0（`long-secrets.json` / 総務 `long-session-secrets.json`）。独自secret/匿名データ検査は448ファイルで検出0（`long-security-final.log`）。除外ファイル・大容量・生成物・環境変数の値などは全面検査していない。依存を変更していないため、この工程で依存監査の再実行はしていない。

実接続中に見つかった旧token応答の失効競合は修正・回帰確認済み。ただし、認証監査の本番運用、分散要求制限、session専用DB最小権限、鍵更新・TLS・公開Hosting・3つの正式URL横断・実時間耐久は残る公開前条件である。

以下は前段の記録。

調査日：2026-10-23。対象：専用worktreeのローカルBFF、PostgreSQL永続session、server PKCE、native業務API、Prisma接続、Next設定、依存更新。包括的監査・本番侵入試験ではない。公開環境・認証設定・実利用者データは変更していない。

- ブランチ：`feat/hanamaru-kintai-alignment-20261023`、基準 `09d6fb1` と未コミット差分。
- Stack：TypeScript、Next Route Handlers、既存Fastify service、Prisma 6.19.3／adapter-pg、AES-GCM、openid-client。既存業務SQL migration／IaCは未変更。ローカル専用session tableを追加。
- 方法：AIによる限定静的レビュー、secret scan、依存監査。以下の未修正指摘数はこの範囲に限定する。

| Severity | 未修正の確認済み | 要追加確認 |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 0 | 0 |
| Low | 0 | 0 |
| Info | 1 | 0 |

優先事項：固定Hosting・実provider／Google・認証監査・session最小権限roleの公開ゲートを満たすまで、Cloud Run拒否と既定OFFを維持する。

### SC-001 [Info] ローカルsessionの本番利用は未対応

- 場所：`apps/web/src/server/session-gateway.ts`、`apps/web/src/server/local-session-runtime.ts`。
- 分類：OWASP A04 Insecure Design / A09 Security Logging and Monitoring Failures。
- 根拠：PostgreSQL storeを追加し、暗号化payload・CAS rotation・別process復元を検証した。絶対5分TTL、最大128記録、交換5試行。Cloud Runと非loopbackでは起動拒否。
- 前提・影響：ローカル明示opt-in時のみ到達可能。試験DBのowner接続でsession tableを扱う。本番専用role、長期更新、認証監査、分散rate limit、鍵更新・固定Hostingは未対応のため、現行ゲートを外した配備は不可。
- 対応：現在の拒否ゲートを維持し、本番化は別設計・検証とする。
- 確度：confirmed（仕様上の制約。本番到達可能な脆弱性とは判定していない）。

### SC-002 [修正済み] 依存監査の該当バージョン

- 場所：`apps/web/package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`。
- 分類：OWASP A06 Vulnerable and Outdated Components。
- 根拠・修正：次表の7 advisory。該当バージョンは確認済み、実サービスでの攻撃成立は未検証。修正版への限定更新後にproduction依存監査0。
- 確度：confirmed（バージョン該当のみ）。

## 依存関係

`pnpm audit --prod --json` はP1更新前にCritical 2、High 1、Moderate 3、Low 1。Prisma追加後にはdeepmerge-ts 7.1.5のHigh 1件を別途検出し、限定override後に全severity 0、終了0。開発依存を含む全依存監査ではない。レジストリへ照会したのはパッケージとバージョン情報のみ。証跡 `.artifacts/alignment/audit-current.json`。

| 依存 | 更新前 → ローカル更新後 | 対応 |
|---|---|---|
| Next / eslint-config-next | 16.3.8 → 16.4.1 | Webの固定バージョン更新 |
| Fastify | 5.12.5 → 5.12.6 | 既存範囲に限定したoverride |
| qs | 6.15.3 → 6.16.0 | 既存依存範囲のoverride |
| brace-expansion | 2.1.6 → 2.1.7 | 2系の既存overrideを更新 |
| @prisma/config→deepmerge-ts | 7.1.5 → 8.0.0 | Prisma 6.19.3の当該依存だけoverride。生成・型・DB・buildで互換性を検証 |

[deepmerge-ts公式advisory GHSA-ggr8-5vv4-36mx](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) は循環参照objectのmergeでstack枯渇する問題。通常JSONだけでは循環参照を作れないため、バージョン該当とアプリからの攻撃成立を区別する。@prisma/configのconfig reader経路で利用しており、新APIのJSONをこのmergeへ渡す処理は追加していない。

Nextの公式advisory：[画像最適化](https://github.com/advisories/GHSA-2464-fhr4-w9xw)、[use cache](https://github.com/advisories/GHSA-673q-mjm6-r5xr)、[Server Actions](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)。該当バージョン検出と実悪用可能性は区別する。既存sharpは0.35.5であり、今回調査したWebソースにはuse cache／use serverの使用を確認していない。実環境での悪用・影響を断定していない。

## 静的確認

| 観点 | 確認した境界／制限 |
|---|---|
| 認可 | 既存authenticate/service/RLSを利用。sessionごとのmembership・選択組織を固定し要求ごとにactive状態を再照会。利用者指定roleを採用しない |
| 認証 | ランダム32bytesのopaque ID、DBはSHA-256キー＋AES-256-GCM payload。ログイン時CAS rotation、logout失効、期限5分。PKCE/state/nonce/署名/owner Cookieを検証。メール一致の自動紐付けなし |
| CSRF・origin | 固定HostとOrigin、一意CookieとCSRF照合。x-forwarded-hostを信頼しない。更新にCookieとBearerを混在させない |
| SSRF・転送 | upstreamは固定設定のみ、redirect追従なし。偽actor/dev/Cookie/CSRFを業務APIへ転送しない |
| 機密保持 | no-store、CookieはHttpOnly・host-only。Bearerをブラウザ応答へ返さない。自由記述・tokenの新規通常ログなし |
| 設定 | 明示opt-in＋異なる127.0.0.1の2ポートのみ。Cloud RunではPoC拒否。PoC設定不正時にBearerへfallbackしない |
| 完全性・再送 | 通信断時に更新を自動再送しない。既存冪等キー・API本文・statusを維持 |
| 注入 | 既存SQL本文を再利用し、値はPrisma bound parameter。SET LOCAL ROLEは既存constructorの検証済みrole名のみ。任意URL・任意raw SQLをHTTP入力に持たせない |
| DB分離 | 同じtransactionでrole/GUCを設定。pool max1・rollback・他組織への切替を検査。localPrismaはloopback＋専用DB名＋Cloud Run外だけ許可 |
| 鍵・機密値 | server専用ランダム鍵、毎回異なるIVとsession keyのAAD。旧cipher本体は基準と同一。server設定・raw DB例外を応答へ返さない |
| 監査・rate limit | 本番用認証監査イベント、分散rate limitは未実装。128 session／同一pre-auth 5試行はローカル資源上限であり、本番防御の代わりではない |

限定スキャンとリポジトリ独自の匿名fixture／秘密情報検査を再実行し、最終件数は検証記録に記載する。依存・生成物・バイナリ・大きなファイル等はscannerの除外範囲。秘密情報が絶対に存在しないという保証ではない。

## 本番切替前に残る条件

- 永続storeの別client／別process復元・共有試行回数はローカルで検証済み。実Cloud SQLのsession専用role・暗号鍵更新・長期session・refresh tokenは未対応。
- ローカルHTTP用Cookieであり、本番TLS・固定HostingでのCookie転送・callback／PKCEを未検証。
- 既存ログインUIとApiClientはローカルflag ONの場合だけ接続する。合成署名issuer＋隔離製品DBのSSOは検証済み。実Google・実providerと3正式URLの通し試験は未実行。
- 本番用認証監査、サービス間identity、鍵更新、グローバルrate limitは別ゲート。ローカル合格を本番投入可と扱わない。
- 今回調査範囲で未修正のCritical/Highを確認していないが、全アプリ・全IaC・全JWT検証を保証しない。総務・勤怠の依存更新は本報告の対象外。

実Next／ブラウザ・DB回帰は実装依頼に基づく別検証：[結果と未実行事項](../docs/adr/2026-10-23-alignment-test-results.md)。実装差分は未コミット。本番反映なし。

## 総務側の同時確認

総務専用worktreeにもlocal opt-inのPrisma transactionを追加した。接続先は127.0.0.1の指定した合成DB名だけで、Cloud Runでは拒否する。既存認証・session・SSO・API・Jobs・SQL・infraの84ファイルと業務repository本体は基準と一致。actorは既存serverで決定し、同じtransactionでGUCを設定する。HTTP入力からSQLやDB roleを組み立てない。

総務のproduction依存監査も0。Nextは16.4.1、@prisma/config参照のdeepmerge-tsは8.0.0。既存SQL・RLS・trigger/check・式index・grantはSQL管理を継続する。SSO provider専用schemaをPrisma生成物で更新しない。

総務のブラウザ検証は合成データ・ローカル文書を使用する。開発用Nextの診断ログには一時署名URLが含まれるため、ログをそのまま外部共有・Git登録しない。今回の`.artifacts/`、既存`test-results/`、一時session/資格情報は追跡対象外。実利用者の認証情報や実領収書は使っていない。
