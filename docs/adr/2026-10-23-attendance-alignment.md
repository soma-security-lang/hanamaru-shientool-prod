# 勤怠基準への移行：第一段階

状態：ローカル実装。公開・認証切替は未実施。

本書はP1とメモリsession PoC時点の履歴。継続実装した永続session・native API・Prisma・server SSOの現行仕様は [追加ADR](2026-10-23-persistent-session-native-api-prisma-sso.md)、最新合否は [検証結果](2026-10-23-alignment-test-results.md) を参照する。以下の「未実装」は当時の状態を示す。

## 決定

- 2026-10-23のユーザー指定計画に従いTailwind 4.3.0を採用。既存semantic tokenとCSS Modulesを維持し、`tw:` prefixで段階導入する。Preflightを加えて全画面のresetを変えない。
- 第一移行部品はTechnicalDetailsのlayoutと支援技術向け非表示表示。色・余白・操作は既存契約を保つ。
- `/api/v1/*` にNext Route Handlerの互換transportを追加する。業務認可・書込・監査は従来APIが唯一の実行主体。通常経路はBearerのままとし、別途ローカル専用Cookie PoCを追加する。
- `HANAMARU_BFF_ENABLED=true` の場合だけ起動。未設定時は404。接続先はサーバー設定 `HANAMARU_BFF_UPSTREAM`、Originは `HANAMARU_BFF_PUBLIC_ORIGIN` を使い、クライアントから指定できない。
- ローカルHTTP許可は `HANAMARU_BFF_LOCAL=true` かつCloud Run環境でない場合のみ。秘密設定をファイルへコピーしない。
- 呼出側は既存runtime設定のAPI baseを `/api/v1` とすることでopt-inできる。既定の接続設定、Google/OIDC認証、ID、権限、DB、Job、Hosting rewriteは変更しない。
- 認証情報はAuthorizationのBearerだけを転送し、Cookie、x-dev-role、actorヘッダーは転送しない。組織選択の `x-organization-id`、音声のRange関連ヘッダーは既存APIの検証へ渡す。APIがtokenと現在のmembershipを再検証する。本番のサービス間identity方式は後続P3で確定し、今回のtransportを本番へ有効化しない。
- 更新のOriginは設定値に完全一致するものだけ許可。redirectを追わず、通信失敗を自動再送しない。結果不明と未保存を混同しない。
- ファイルuploadは既存の直接upload先を維持する。APIレスポンスのURLは書き換えない。

## 固定URL

正式入口は `https://monocle-503402.firebaseapp.com/`。`firebase.json` とサービス名は維持。勤怠・総務のURLも変更しない。

## 次段階

全画面Tailwind移行、opaque session永続化、Hosting Cookie／PKCE、SSO provider、Prisma、API業務処理の移植は未完了。transport導入を認証統一完了とは扱わない。基準API・DBを削除しない。

## ローカル認証PoCの追加

- `GET /api/auth/session` で認証前sessionとCSRFを発行、POSTで既存APIの `/me` にBearerを検証させた後にsessionをローテーション、DELETEで失効する。
- Cookie名は `__session`、HttpOnly、host-only、Path=/、SameSite=Lax。IDは32ランダムbytesで、サーバーmapのキーはそのSHA-256。TTLは絶対5分、最大128件、認証交換は同一session最大5回。ローカルHTTPではSecureを付けない。本番用Cookie設定の実証ではない。
- `HANAMARU_LOCAL_SESSION_POC=true`、BFF有効、local有効、接続先・公開originの両方が別ポートのHTTP 127.0.0.1の場合のみ有効。`K_SERVICE` が存在するCloud Runでは必ず拒否する。PoCが指定され設定不正の場合、Bearerへ戻さず503。無効化時はmap参照を破棄する。
- 本人のmembership IDと選択組織を固定し、各読取・書込前にAPIで現在のactive状態・権限を再取得。roleをCookieへコピーしない。組織変更にはsessionの再確立が必要。
- 更新は固定Host・Origin・CSRFを検証する。Next内部のRequest URLがlocalhostになる場合でもHostは設定値へ完全一致させ、`x-forwarded-host` から許可originを作らない。
- ブラウザ応答にBearerを返さず、Cookie／CSRFをAPIへ転送しない。ログアウト後・組織変更・membership変更・401/403後は保存を実行しない。通信断で保存を自動再送しない。
- storeはプロセスメモリのみ。再起動・複数instance・refresh token・OIDC callback／PKCE・監査イベント／本番rate limitは未実装。既存ログイン画面とApiClientはこのPoCへ切り替えない。
- 試験は `playwright.session.config.ts` の3357/3358のみで、合成HTTP upstreamを使用する。8ケース（4シナリオ×Chrome/WebKit）合格。実Google／固定Hosting／実DB認可の通し試験ではない。

## 再現可能な現行台帳

`node scripts/alignment-inventory.mjs --write` で `.artifacts/alignment/source-inventory.json` を生成する。TypeScript ASTから型引数あり／なし両方のAPI登録と呼出service、画面ID・Route、Worker dispatchを収集する。24画面、143 API登録（`/api/v1/` 141＋health 2）、10 Job種別、65 SQL migrationファイル。SQL中のCREATE TABLE宣言は実DBの有効schemaやRLS検証ではない。従来docs検査の21画面とは母集団が違う。

## 容量制約時のビルド

`HANAMARU_ALIGNMENT_LOW_DISK=true` はCloud Run外でのみ、Turbopackの再利用cacheと未使用standalone梱包を省略する。コンパイル・型検査を省略しない。通常buildは従来どおりstandaloneを生成する。容量回復後に通常buildも再実行している。

## ローカル依存安全更新

同日の依存監査を受け、買取worktreeだけNext／eslint-config-nextを16.4.1、Fastifyを5.12.6、qsを6.16.0、brace-expansionの2系を2.1.7へ限定更新。production依存監査は7 advisoryから0へ。API／Workerの業務ソースを変えなくてもruntime依存は変わるため、WebだけでなくDB統合・独立DB role・全業務offline E2Eを再実行して判定する。総務・勤怠、通常配備には適用しない。
