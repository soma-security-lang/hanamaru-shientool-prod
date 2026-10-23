# 勤怠基準移行：永続セッション・業務API・Prisma・共通SSO

更新：2026-10-23 JST。対象は `feat/hanamaru-kintai-alignment-20261023`、基準commit `09d6fb1432e85a8bebd5342df078c2baba18e6ad` と未コミット差分。

継続更新：ローカルの長時間SSOを追加した。[8時間session・実総務provider接続ADR](2026-10-23-long-session-real-sso-local.md) と [最新結果](2026-10-23-alignment-test-results.md) を参照。本書の5分は既定経路の仕様。明示的な `HANAMARU_LOCAL_LONG_SESSION=true` ＋PostgreSQL＋server SSOの場合だけ8時間上限を使う。本番は引き続き無変更。

## 実装した経路

ブラウザ → 同一originのNext Route Handler → 既存の認証・業務service → Prisma transaction → 既存PostgreSQL、というローカル経路を追加した。Workerにも同じrepositoryを選択できる専用起動口を追加した。従来経路と移行経路は同じSQL migration・ID・認可・業務処理を使う。

| 領域 | ローカル実装 | 維持する境界 |
|---|---|---|
| セッション | opaque `__session`、PostgreSQL永続store、AES-256-GCM、別processでの復元、CAS rotation・失効・期限・試行回数 | 本人・選択組織を固定。要求ごとに現行membershipとprovider状態を再検証 |
| API | 既存ルート登録から保護されたJSON業務APIをnative Request/Responseで実行。読取・更新・Job作成を同じserviceへ接続 | 未対応のbinary・直接upload・内部APIは従来実装が担当。処理エラーを契機に旧writerへ再送しない |
| Prisma | Prisma/adapter-pg/client 6.19.3、93 model、既存SQLをbound parameterで同じtransaction内から実行 | SQL migration・RLS・role・trigger・監査・冪等性が正本。ORMによるDB再生成なし |
| Worker | `apps/worker/src/alignment-local.ts` でPrisma repositoryを注入 | 既存processor・dispatcher・Job状態・outboxを利用。通常起動口は維持 |
| 共通SSO | サーバー側Authorization Code＋PKCE、署名ID token検証、state/nonce・一回性・期限、Cookieとの結合 | clientは `sso-hanamaru`。既存の不変ID対応を解決し、メールや氏名で自動統合しない |
| Web | 明示opt-in時に既存ログイン・ApiClient・uploadをCookie経路へ接続 | 通常のGoogle/Bearer経路、公開URL、通常配備設定は維持 |

今回のPrisma移行は、既存業務SQLをPrisma transactionへ載せる方式。全SQLをmodel CRUDへ書き換えたという意味ではない。Fastifyサービスや旧repositoryの廃止は今回行わない。

## セッションとSSOのデータ

- `alignment_sessions` はローカル追加schemaにだけ作成する。主キーはランダムIDのSHA-256で、credential、CSRF、PKCE verifier、nonce、flow ownerは暗号化payloadに置く。平文BearerをDB列・ブラウザストレージ・通常ログへ複製しない。
- AES-GCMは毎回異なる12-byte IVを使い、session keyをAADへ結び付ける。暗号鍵の設定不備では起動しない。鍵はテスト開始時に生成し、証跡へ出力しない。
- 既定の絶対期限は5分、同時128記録、認証交換5試行。flowも5分。継続工程でローカルSSO限定の絶対8時間・server refreshを追加した。鍵ローテーション運用と本番長期sessionの採用は別工程。
- rotationは旧versionの削除と新IDの作成を一つのtransactionで実行する。並行callbackは一度だけcode交換できる。logout・provider失効後に以前のCookieを再利用できない。
- `(issuer, sub)` の製品対応は既存APIのSSO解決・認可を利用する。未紐付け・停止・組織不一致は拒否する。既存user/membership/訪問/監査actor IDを更新しない。
- アプリ切替は既存providerの `/apps` を利用する。製品ログアウトは当該Cookieの失効であり、全製品ログアウトを追加表示しない。
- browserへ渡すruntime設定は公開接続情報とlocal opt-inだけ。SSO有効表示はhydration時のserver snapshotを固定し、初期HTMLとclientの不一致を防ぐ。

## API契約と保存の互換性

既存 `registerRoutes` と `authenticate`、`BackendService` を再利用する。DTO・path・status・scope・capability・冪等キー・楽観ロック・監査は既存実装が判定する。native側はrequest ID、query/params、JSON body上限、エラーenvelope、no-store/security header、要求制限を担当する。

ファイル本体、Range応答、直接upload、JSON以外のparser/stream、health、内部の機械間処理は従来経路に残す。対象外のルート・transportだけ、本文を読む前に従来ownerへ割り当てる。書込失敗、認証失敗、providerエラーでは別ownerへfallbackしない。JSON構文不正・空のJSON body・上限超過のstatus/envelopeも現行Fastifyのgeneric errorへ合わせる。標準4xxへの変更は移行と分ける。新旧経路へ同じ冪等キーで再送した場合も同じ業務IDを返す。

local uploadはobject key全体のpercent encodingを保持して転送する。専用prefixで一度decodeしてprivate object keyを検査し、二重encoding・`..`・backslash・空segmentを拒否する。通常APIのencoded pathは引き続き許可しない。checksum headerとstreamのbyte列を維持し、API側が既存upload sessionの組織・本人・hash・上限を最終判定する。署名付きGCSへの直接uploadではCookie・CSRF・Bearerを付けない。

実際のroute registryは143登録で、native選択は133件（GET 50、更新83）。移行対象のGET 50経路を同じfixtureのstatus・bodyで従来実装と比較し、既存API統合試験92件も実行する。ただし故意のCOMMIT失敗を注入する1件はnative transport＋既存repositoryで検査する。binary upload等の非移行部分も従来実装を使う。92件すべてがPrisma処理、または133経路それぞれの全状態が成功したことを意味しない。経路の実行時一覧は `.artifacts/alignment/native-routes.json`。

## PrismaとSQLの管理

`packages/alignment/prisma/schema.prisma` は隔離DBへ65件の既存SQL migrationを適用した構造を読み取りでintrospectした。既存92 tableとローカルsession 1 tableを対応付ける。

| 既存DBの性質 | 保持方法・比較 |
|---|---|
| UUID・FK・監査actor | 既存列・IDを利用。再採番・再紐付けなし |
| bigint・Decimal | 従来pgの文字列DTOへ変換し、JavaScript numberへの丸めを避ける |
| nullable・JSON・enum・default | 元SQLとschema mappingを保持。JSON parameterは従来と同じ内容でbind |
| timestamp・SQL time | 接続timezoneをUTCに固定。既存 `scheduled_local_time` のみHH:mm:ssへ互換変換 |
| BYTEA | PrismaのUint8ArrayをBufferへ変換し、既存暗号化token処理を維持 |
| unique・複合FK・index | 適用済みSQLを変更しない。introspectionが誤推論した6つの逆方向1対1relationは配列navigationへ修正し、新しいunique制約を追加しない |
| RLS・GRANT・check・trigger・function・式index | SQL側を唯一の管理元とする。Prisma生成物をこれらの代替にしない |
| pool・transaction | transaction内の同一connectionでSET LOCAL ROLEと組織GUCを設定。rollback後のpool再利用を比較 |
| SQLSTATE・業務エラー | 23505等と許可済みSOLDGRAPH判定コードを既存handlerへ伝える。raw SQLやparameterは応答へ返さない |

`prisma migrate`、`db push`、resetは追加しない。`local-schema.sql` は本番migration runnerの対象外。既存DBを破壊・置換する操作はない。

`scripts/check-alignment-preservation.mjs` は基準commitを維持し、183ファイル完全一致、9ファイルのレビュー済み接続変更、6追加ファイルを区別する。9変更はexport/build型情報、serviceのimport先、Workerの任意注入、cipher関数の同一内容移動、API/WorkerのDocker build依存定義。hashを固定し、さらにcipher本体の基準一致を検査する。192ファイルすべて未変更とは報告しない。

Web/API/WorkerのDockerfileは、frozen install前に必要なworkspace manifestをすべてコピーし、対象製品の依存グラフ順にbuildする。runtimeの起動口・環境変数・利用者・公開設定は変更しない。3サービスのイメージ定義の静的依存テストは `node --test scripts/alignment-docker.test.mjs`。Docker CLIがないため、コンテナ画像の実buildと起動は未実行で、公開前ゲートに残す。

## ローカルの再現

```sh
ALIGNMENT_FULL_CONTRACTS=true ALIGNMENT_BROWSER_TESTS=true pnpm test:alignment
```

上記は独立したPostgreSQLを127.0.0.1:55646で作り、合成seedと匿名教材を用い、終了時にそのDB・画像・processだけを片付ける。通常のlocalhost:3100や既存DBは使わない。Webは3357/3377、合成issuerは3378、互換APIは3379を使用する。ポート使用中は停止する。

主要なserver設定は次のとおり。テストscriptが値を生成・設定するので、実キーをファイルへ保存する必要はない。

| 設定 | 用途 |
|---|---|
| `ALIGNMENT_DATABASE_URL` | PostgreSQL loopbackの `hanamaru_alignment_` 接頭辞付きDBだけ許可 |
| `ALIGNMENT_SESSION_KEY` | 暗号化用のランダム32byte鍵。64hex、server専用 |
| `HANAMARU_BFF_ENABLED` / `HANAMARU_BFF_LOCAL` | 明示的なローカル入口 |
| `HANAMARU_LOCAL_SESSION_POC=true` / `HANAMARU_SESSION_STORE=postgres` | 永続Cookie経路 |
| `HANAMARU_LOCAL_NATIVE_API=true` | JSON業務APIのnative実行とPrisma保存 |
| `HANAMARU_SERVER_SSO=true` | server PKCE経路 |
| `HANAMARU_BFF_PUBLIC_ORIGIN` / `HANAMARU_BFF_UPSTREAM` | 異なる127.0.0.1ポートの固定接続先 |
| `SSO_ISSUER` / `SSO_INTERNAL_SECRET` | テスト用issuerと既存内部照会の秘密値 |

これらの経路はCloud Runの `K_SERVICE` が存在すれば拒否する。設定不正時は503となり、別認証へ自動切替しない。通常起動の既定はOFF。

Workerの個別起動は、上記の専用DBを準備して `HANAMARU_LOCAL_NATIVE_API=true node apps/worker/dist/alignment-local.js`。127.0.0.1:3380にだけlistenする。テストscriptの終了後に削除されたDBへは接続しない。

## 検証範囲と残る公開ゲート

最新のコマンド・件数・合否は [検証結果](2026-10-23-alignment-test-results.md) を正本とする。合成署名issuer＋実Next＋実隔離DBのブラウザ検証と、総務SSO providerの統合試験を区別して記録する。

継続工程で実総務providerコード＋合成IDのlocalhost接続と8時間上限・refreshを確認した。一方、固定Hosting上のGoogle認証・Cookie転送、公開providerと3つの正式URLを往復する試験、本番長期session、認証監査・分散rate limit、session専用最小権限DB role、鍵更新、サービス間identity、実稼働image照合・性能比較・公開後切戻し訓練は未実施。これらはStage・公開工程の条件として残る。ローカルのSSO合格を3製品本番切替完了とは扱わない。

公開URL、既存のCloud SQL、既存利用者データ・ID・権限、Hosting rewrite、通常trafficは変更していない。commit・push・PR作成・デプロイなし。

参照：[Prisma transaction](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions)、[Next serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)。Prisma依存の限定overrideは [deepmerge-ts公式advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) に基づき、@prisma/config 6.19.3からの参照だけ8.0.0へ更新した。生成・型・ビルド・DB試験で互換性を確認する。
