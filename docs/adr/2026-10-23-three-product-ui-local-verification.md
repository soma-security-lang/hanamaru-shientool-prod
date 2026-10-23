# 3製品UI横断：ローカル共通ログイン・アプリ切替・ログアウト

実施：2026-10-23 JST。ブラウザ開始20:19:37、ブラウザ試験28.5秒。判定：**ローカル横断PASS**。公開URL・本番DB・GCP設定・配備は未変更。commit・push・PR作成なし。

## 実行対象と正本

| 製品 | ローカルsource | HEADと作業状態 |
|---|---|---|
| 総務・共通SSO | `worktrees/soumu-kintai-alignment-20261023` | `204a4791a7f1abf7d726a0e89a58e816d6156cd4`＋既存未コミット差分・今回の試験追加 |
| 勤怠 | `kintai-base-prd` | `9b455b85e665df0a6bc7d931f7beec8a8e10a687`、追跡対象変更なし |
| 買取支援 | `worktrees/hanamaru-kintai-alignment-20261023` | `09d6fb1432e85a8bebd5342df078c2baba18e6ad`＋前段の未コミット実装 |

固定commitのみの試験ではなく、上記ローカル実装を含む。通常配備のimageやcommitとの照合はこの試験の範囲外。

総務の既存 `e2e/cross-product/run.mjs` に `CROSS_PRODUCT_ALIGNMENT=true` の試験モードを追加した。既存のBearer版は既定として維持し、今回のモードでは買取のserver PKCE・8時間Cookie・PostgreSQL session・native API・Prismaを有効にする。総務の業務Prismaも有効。勤怠のアプリコードは変更しない。

## 環境・データ・安全境界

- PostgreSQL 16.14を新規loopback clusterとして起動。DBは `soumu_alignment_test`、`kintai`、`hanamaru_alignment_cross` の3つ。既存のlocalhost:3100・通常DBは使用しない。
- 総務は既存のschema-only migration projectionを再利用し、歴史的な社員・マスタseedを除外。勤怠・買取は既存の合成fixtureを利用。共通ID、password、署名鍵、内部secret、製品ID対応も合成・一時値のみ。
- 共通SSO providerと管理API、総務Web、勤怠Web、買取API、買取Webを別processとして起動。すべて127.0.0.1で、通常ポートを占有しない。
- 開発用の認証bypassは使わず、共通IDのpassword照合・Authorization Code＋PKCE・承認済み不変ID対応・製品内の認可を実装本体で行う。
- 総務はアプリ認証、勤怠は既存SSOセッション、買取は新しいサーバーCookie方式。共通SSOのlocal refresh policyは既定OFF・専用DB限定のまま、試験プロセスだけ明示ON。
- Nextのdev起動による実UI試験。全製品のproduction image・公開Hostingと同一の配備検証とは扱わない。ブラウザはChrome channel／WebKit、外部originへの要求を遮断、trace・画像・認証state出力なし。

## 結果

`E2E-CROSS-ALIGN-01` という一連のjourneyを2ブラウザで実行した。**2実行合格、失敗0、skip0、flaky0**。以下の5工程はそのjourney内の確認項目であり、独立した10テストとは数えない。

| 工程 | 操作と受入条件 | Chromium | WebKit |
|---|---|---|---|
| CROSS-01 | 共通ID／passwordを1回入力し、承認済み3製品をアプリ選択画面へ表示 | PASS | PASS |
| CROSS-02 | 実勤怠UIを開き、既存user ID・MEMBER roleを確認 | PASS | PASS |
| CROSS-03 | ヘッダーのアプリ切替から買取へ。password再入力なし。既存membership・assessor権限、8時間session、HttpOnly Cookie、ブラウザBearerなしを確認 | PASS | PASS |
| CROSS-04 | 買取→総務→勤怠と実画面を往復。総務は管理者、勤怠はMEMBER、買取はmanager／system_adminへ昇格しない | PASS | PASS |
| CROSS-05 | 複数タブで3製品を開いた状態から共通ログアウト。各APIが401、勤怠・総務はlogin画面、買取は「ログインが必要です」へ戻る | PASS | PASS |

未処理のbrowser pageerrorは両方0。買取のブラウザsessionStorageに従来のaccess tokenがないことを確認した。商品・訪問・経費等の業務データを変更する試験ではない。

型検査・E2E ESLint・Node構文検査・差分空白検査は合格。総務のソース保全検査も合格し、前段でレビューしたlocal gate以外の認証・API・Job・migration・infra・業務SQLの追加変更はない。

## 証跡と再現

証跡は作成者端末内の `/tmp/sso-cross-product-Z0LHUt/`：

- `alignment-result.json`：Playwright結果（expected 2／unexpected 0／skipped 0／flaky 0）。
- `source-state.json`：実行対象HEAD・未コミット件数・各loopback port。
- 各processの診断log：合成試験専用。外部共有・Git登録は行わない。
- 総務worktreeの `.artifacts/alignment-prisma/cross-product-run.log`、`cross-lint.log`、`cross-typecheck-final.log`、`cross-preservation.json`。

試験終了後、fixtureのPostgreSQL・provider・管理API・3製品Web/APIすべてのlisten停止を確認した。診断用の一時DBファイルは停止した状態で保持する。勤怠checkoutの追跡対象に変更はない。

```sh
# 総務専用worktreeで、5GiB以上の空き容量を確保して実行する。
CROSS_PRODUCT_ALIGNMENT=true \
KINTAI_REPO=/absolute/path/to/kintai-base-prd \
HANAMARU_REPO=/absolute/path/to/hanamaru-kintai-alignment-worktree \
pnpm test:cross-product
```

## 今回の完了範囲と対象外

前段で未確認だった**3製品のローカルUI横断・共通ログイン・アプリ切替・共通ログアウト**を確認した。追加したのは横断試験・起動設定・文書で、今回の依頼ではアプリの業務処理や権限設計を追加変更していない。

公開3URL・実Google・実利用者・TLS／Hosting rewrite・Cloud Run image・本番SSO登録の検証はしていない。全製品の全業務・全roleの網羅試験、8時間の実時間耐久、部分的な個別製品ログアウト、停止・退職等の全例外もこのjourneyの合格には含めない。前段の個別試験と公開前ゲートを維持し、ローカル合格を本番切替済みとは扱わない。
