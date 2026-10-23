# 勤怠基準移行：ローカル実装・検証結果

記録日：2026-10-23（JST）。判定：**追加したローカル経路の合格を記録。正式URL・Stage・通常本番の切替は未実施**。
対象はローカル専用 `feat/hanamaru-kintai-alignment-20261023`。基準は `09d6fb1432e85a8bebd5342df078c2baba18e6ad`。commit・push・Stage・本番配備は実施していない。

## 最新：3製品UI横断

2026-10-23 20:19 JST、実総務provider＋管理API＋総務Web＋勤怠Web＋買取API/Webを別process・3つの隔離DBで接続した。Chromium／WebKitの一連のjourney **2実行合格、失敗・skip・flaky 0**。共通password入力1回→勤怠→買取→総務→勤怠→複数タブの共通logoutを確認。総務管理者／勤怠MEMBER／買取assessorを維持し、logout後は3 APIが401、3 UIが再ログイン要求となった。買取は8時間Cookie・native API・Prisma経路、総務業務PrismaはON。勤怠sourceは `9b455b85e665df0a6bc7d931f7beec8a8e10a687`・追跡対象変更なし。

E2E lint・型・構文・保全検査合格。新しいアプリ業務コード・本番設定の変更なし。詳細・5工程ごとの受入・証跡・再現は [3製品UI横断の記録](2026-10-23-three-product-ui-local-verification.md)。下方の「3製品UI横断未実施」は前段の履歴。公開3URLでの検証は引き続き未実施。

## 継続：8時間セッションと実総務SSOへのローカル接続

仕様・制限・再現手順は [長時間session ADR](2026-10-23-long-session-real-sso-local.md)。買取と総務の専用worktreeだけを変更した。公開URL、既存のCloud SQL・利用者ID・権限、通常配備は未変更。commit・push・PR・デプロイなし。

| 今回の実行 | 確認結果・証跡 |
|---|---|
| 買取通常unit | **636合格・DB依存139 skip**。DB依存は別試験として区別。`long-session-unit-final.log` |
| session設定・同時更新単体 | **36合格**。3時間後・8時間上限、CSRF、同時refresh一度、logout競合、旧tokenの遅延401で新sessionを失効させない、業務write不再送。`long-targeted-unit.log` |
| 隔離Prisma/store | **8合格**。暗号化、別process復元、8時間期限、同一keyのCAS版競合・ABA拒否、既存型・RLS・rollback等。`real-sso-browser-errors-final.log` |
| native API／従来SSO契約 | **6合格**。同じ隔離DBで再実行。上記log |
| 従来session／署名fixtureのブラウザ回帰 | **8＋6合格**。Chromium／WebKit、既存JSON/PDF保存・再読込、失効、axe。`real-sso-final.log` / `session-results.json` / `persistent-browser.json` |
| 実総務provider＋実Next＋Prisma接続 | **6合格・skipなし**。パスワード・PKCE・refresh rotation、同時6要求、保存・再読込、実日報フォームの未保存値を保持した3回更新、共通logout、リンク取消、期限超過、pageerror 0。`real-sso-browser-errors-final.log` / `real-sso-browser.json` |
| 総務default回帰 | 隔離DB **17合格**、SSO **19合格（既存12＋local gate7）**。既定OFFの従来client・password・承認・失効経路を維持。総務側 `.artifacts/alignment-prisma/long-default-provider-regression.log` |
| ソース保全 | 買取183完全一致＋9レビュー済み変更＋6追加、cipher一致。総務84保護対象中83完全一致・provider1件local gateのレビュー済み変更、業務repository SQL本体一致。`long-preservation.json` / 総務保全script |
| lint・型・build | 買取 `pnpm lint` / `pnpm typecheck` 終了0（`long-session-lint-final.log` / `long-session-typecheck-final.log`）。実SSO試験script内の最終production compile/type/buildも終了0。総務SSO lint・typecheck・build終了0。コンテナbuildではない |
| 限定安全確認・後片付け | 独自scanner448ファイル・secret/非匿名メール検出0。限定secret scannerは買取server13・総務SSO9ファイルで候補0。`long-security-final.log` / `long-secrets.json` / 総務 `long-session-secrets.json`。最終test process・隔離DBのlisten停止、原checkout差分数32/22の維持を確認 |

初期試験では容量不足で安全停止し、容量確保後に実行した。初回の実接続試験で、更新前のidentity照会の401が更新後のsessionを消す競合を検出。資格情報とCAS版を照合し、安全なidentity読取だけ再評価する修正を入れた。業務write自体は再送しない。明示的な単体2ケースと上記E2Eの再実行で確認した。テスト専用の期限切れ操作を走行中の初期画面読込と衝突させないよう、実画面の読込完了を待つ。未導入だったWebKitはローカルcacheへ再取得した。

実SSOは**総務providerの実装本体**で、利用者・DB・署名鍵・passwordは合成。公開provider／実Google／3つの正式URL往復や、8時間の実時間耐久の合格ではない。8時間境界は時計注入で検査した。refreshの本番採用、固定HostingのCookie、3製品UI横断、最小権限session role・鍵運用・TLS・コンテナ実build等は公開前ゲートに残す。

以下は前段の検証履歴。今回の同一対象の最新件数は上表を優先する。

## 前段：永続session・native API・Prisma・server SSO

実装仕様・設定・再現コマンドは [追加ADR](2026-10-23-persistent-session-native-api-prisma-sso.md)。以下が継続依頼に対する結果であり、下方の17:50以前の件数・未実装記述は履歴である。

### 買取：今回実行した検証

| コマンド／証跡 | 結果と範囲 |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | 終了0。通常unit627合格。DB依存138 skipは後述の隔離DBで個別検証。`current-lint.log` / `current-typecheck.log` / `current-unit.log` |
| `TEST_POSTGRES_PORT=55643 pnpm test:db` | 終了0。従来経路のDB29、Worker31、API115合格。新Worker2件はここではskipし、下記で実行。`current-db.log` |
| `pnpm test:db:roles` | 終了0。SCRAM、NOINHERIT/NOBYPASSRLS login、API/Worker間のrole分離。`current-roles.log` |
| `pnpm build` | 終了0。通常standalone出力を含む。後の全画面E2Eでも最新sourceをproduction build。`current-build.log`、offlineの`web-build.log` |
| `ALIGNMENT_FULL_CONTRACTS=true ALIGNMENT_BROWSER_TESTS=true pnpm test:alignment` | **終了0**。Prisma/store7＋native API/SSO6＋新Worker2＋既存WorkerのPrisma再試験4＋既存API統合92、sessionブラウザ8＋SSO/GUI保存/失効/PDF binary6が合格。最終sourceの低容量production buildも終了0。`local-final.log` / `persistent-browser.json`。以前の4件は `persistent-final-3.log` |
| `playwright.alignment.config.ts` | 通常Bearer互換transport3合格。`transport-final.log` / `transport-results.json` |
| 全業務offline E2E | 終了0、35合格・1意図的skip、89画像。21画面×8幅、Chrome/WebKit、axe serious/critical 0、200% reflow、主要業務保存・再読込・権限。`.artifacts/offline-e2e/20261023T094638Z/result.json` / `playwright.log` / `screenshots/` |
| Prisma schema validate | 終了0。93 model。`prisma-validate.log`。SQL migration runner以外でDB構造を書き換えていない |
| 維持ガード | 終了0。192基準ファイルのうち183一致、9レビュー済み変更、6追加、cipher本体一致。`preservation-current.json` |
| 台帳テスト | 3合格。AST母集団は24画面・143 API・10 Job・65 migration。`inventory-current.log` |
| コンテナ定義 | Web/API/Workerのworkspace依存closureとbuild順・既定flagの静的テスト3合格。`docker-workspace-contract.log`。実image build/起動はDocker CLI未導入のため未実行 |

上表の単体・DB・API・ブラウザ件数は別実行の母集団であり、足し合わせて独立した機能数とはしない。既存API92件のうちCOMMIT故障注入1件はnative transport＋旧repository、binary等の非移行部分は旧ownerを利用する。native登録は133経路（GET50・更新83）、GET50は同一fixtureのstatus/bodyを旧経路と比較した。各経路の全状態を網羅したという意味ではない。

Worker再試験4件はSTT継続polling・品質判定再試行、取消、未完了upload削除、運用alert正常復帰。operations試験の準備・片付けだけowner poolを維持し、scan本体とprocessorはPrisma＋既存Worker roleで実行する。

offlineのskipはWebKitの重複画像生成のみ。査定員の管理画面拒否は同ケースのskip前に確認している。全89画像の目視承認・旧版pixel一致とは区別する。永続sessionの追加画像は390pxの実viewportで2枚、代表画像を目視した。

### 総務側の継続実装

作業場所は `worktrees/soumu-kintai-alignment-20261023`、基準 `204a4791a7f1abf7d726a0e89a58e816d6156cd4`。Prisma 6.19.3の業務transactionを既定OFFで追加し、public 24 tableを既存SQLへ対応付けた。日本語enumのDB値は`@map`で保持。既存session・SSO provider SQLは継続する。Nextは買取と同じ16.4.1へ限定更新。

- lint・typecheck・unit・buildは終了0。unit78合格、DB依存のskipは別実行。最終buildは容量制限用の `SOUMU_ALIGNMENT_LOW_DISK=true` で型検査・コンパイルまで実行し、standalone梱包を省略した。
- `pnpm test:postgres` は隔離DB17件・SSO provider12件合格。`soumu-db-final.log`。
- `pnpm test:prisma:local` は7件合格。読取比較、型、RLS、発注・監査・旧pgからの再表示、rollback、他拠点拒否、版競合、SQLSTATE。`soumu-prisma-final.log`。
- `node scripts/check-prisma-preservation.mjs` は84ファイル一致、repositoryの業務SQL・method本体一致。認証・API・Jobs・SSO・migration・infraを保持。`soumu-preservation.json`。
- Prismaを有効にしたブラウザ回帰は**22件全合格・skipなし・32画像**。8画面×両browser×5幅、axe serious/critical 0、keyboard、200%拡大、発注・在庫・貸与返却・文書保存/再読込を確認。今回の実行ログは `soumu-prisma-e2e.log`、総務側の `test-results/alignment-results.json` metadataは `prisma:true`。一時processは検証後に停止し、診断用の一時コピー・DBは `/tmp/soumu-parity-1GtnHp` に保持した。

### 安全確認・文書と作業状態

- 両repoの `pnpm audit --prod --json` は全severity 0、終了0。買取 `audit-current.json`、総務 `soumu-audit.json`。開発依存すべての監査ではない。
- 買取のリポジトリ独自secret/匿名fixture検査は443ファイルで検出0、限定secret scannerは買取659・総務273ファイルで候補0（この記録追記前の実行）。除外・大容量ファイルなどの限界は [限定安全確認](../../reports/security-check-2026-10-23.md) に記載する。
- docs契約snapshotは21画面・189状態でエラー0。これはAST現行台帳24画面とは母集団が異なる。Prisma schema validate、維持ガード、diff checkは合格。
- 総務のruntime boundaryは84ファイルで合格。migration/認証/API/Jobs/SSO/infraの基準一致を別guardでも確認した。
- キャッシュ約122MiBの削除は実行環境の制限で拒否され、実行されなかった。低容量設定でコンパイル・型検査を維持して検証した。ソース・既存資料・結果画像・履歴は削除していない。

### 検証中に解消した差

- Prismaとpgのtimestamp timezone、SQL time、BYTEA、bigint/Decimal、SQLSTATE、void functionの違いを修正した。未知のraw DB例外を応答へ公開しない。
- 通常JSONに`toFixed`という項目がある場合もDecimalと誤判定しないよう、両製品で関数型を確認する。入れ子配列を含むJSONを旧pgと比較した。
- JSON parserの構文不正・空body・サイズ上限を旧APIのstatus/envelopeと比較し、同じ応答へ揃えた。非JSON transportは本文を読む前に旧ownerへ割り当てる。
- BFFのpath検証がencoded slashを持つlocal upload URLを拒否していたため、private object keyだけを一度decodeして検証し、元のpathとbyte列・checksumを転送する。二重encoding・traversal・backslashは拒否。Cookie→Prisma JSON→旧binary owner→private file取得の往復を両browserへ追加した。
- Next buildのNode SDK依存解決はplatformのruntime export分離で修正。cipher関数の内容は変更していない。
- サーバーにないruntime値でログインボタンが初期表示不一致になる点を、hydration用snapshotの固定で修正した。
- WebKitのRSC先読み中断は、テストの文書移動前の待ち合わせを修正した。保存後の再読込やconsoleエラーの判定は維持。
- Chromeの縦長画像にsticky層が繰り返し写ったため、新SSO証跡は実viewportを撮影する。DOMのmainが1件、保存値、横はみ出しなしを併せて検査する。
- 実行中の検証shellを更新した回はwrapperが終了127。別のWorker再試験ではfixtureをWorker roleで準備しようとして権限拒否を検出。これらのrunを合格扱いせず、準備/業務実行を区別した最終再実行で判定した。
- Prismaの間接依存deepmerge-tsにHigh 1件を検出し、@prisma/config 6.19.3の依存だけ8.0.0へ更新した。依存監査の最終値は後述の安全確認に記録する。

### ローカル合格から除外するもの

固定Firebase Hostingでの実Googleログイン、実provider＋3正式URLのSSO往復、長期session/refresh、認証監査・分散rate limit、session専用DB role・鍵運用、サービス間identity、実image照合、性能受入値、Stage・通常本番・復旧訓練・業務受入は未実施。Cloud Run拒否・既定OFFを維持する。実AI・実Soldgraph・実領収書は使っていない。

コンテナのworkspaceコピーとbuild順は実装・静的検証済みだが、実imageのbuild/起動・standalone梱包でのDB driver解決・配備用migrationは未実行。ローカルのNext production build/起動の合格と区別する。

証跡の既定基準は専用worktreeの `.artifacts/alignment/`。既存正本の未コミット変更（買取32件・総務22件）、他PR、既存3100は保持した。公開URL・通常DB・通常traffic・利用者ID・権限設定の変更、commit・push・PR・配備は行っていない。

## 以下は同日17:50までの履歴

## 最新の追加実装・再検証（17:50 JST完了）

以下が今回の最終結果。後続の586件・25件等の表は初回段階の履歴であり、最新の追加分を含む件数ではない。

### 追加実装

- 既定OFF・localhost限定のCookie/CSRF session PoC。ID rotation、logout、絶対期限、組織固定、APIでの最新membership照会、失効中の競合、通信断での非再送。既存ログインUI／ApiClient／通常Bearerは維持。
- Next内部のRequest URLと公開Hostの不一致による403を修正。固定Host・Originで照合し、forwarded hostは信頼しない。
- 互換転送に組織選択と音声のRange／206／416を追加。既存APIが認可・保存する方式は不変。
- ASTソース台帳生成：24画面、143 API登録（API-v1 141、health 2）、10 Job種別、65 migration。全件業務の画面→API→DB/Jobマッピングや配備照合ではない。
- 買取専用worktreeでNext／eslint-config-next 16.4.1、Fastify 5.12.6、qs 6.16.0、brace-expansion 2.1.7へ更新。runtime依存変更のため下記全ゲートを再実行。総務・勤怠は今回更新していない。

### 更新後の最終ゲート

| 検査 | 結果 |
|---|---|
| lint → typecheck → unit | 全終了0。unit616件合格。DB依存skipは別のDB実行で検証 |
| AST台帳テスト | 3件合格。generic/non-generic登録、動的登録を無言で省略しないこと、最新機能を含むこと |
| 通常 `pnpm build` | 全終了0。低容量設定なし、standalone生成。ローカル低容量モードの成功だけで代用していない |
| session実Next E2E | Chrome／WebKitで8件合格。合成token/upstream、実Googleなし |
| Bearer互換transport実Next E2E | 3件合格 |
| `TEST_POSTGRES_PORT=55643 pnpm test:db` | DB29、Worker31、API115合格。65 migrationを隔離DBへ適用 |
| `pnpm test:db:roles` | 終了0。独立SCRAM login、NOINHERIT／NOBYPASSRLS、相互role変更拒否 |
| 全業務offline E2E | **35合格・1意図的skip、89画像、終了0**。Chrome／WebKit、21画面×8幅、axe serious/critical 0、経費・ランキング・相場・PDF・音声を含む |
| 業務／DB／公開設定維持ガード | 192ファイル一致、unexpected 0。runtime依存まで未変更という意味ではない |
| `pnpm test:security` | 413テキストファイル、秘密情報・非匿名メール0 |
| production依存監査 | 更新後0 advisory、終了0。dev依存／他製品全体の監査ではない |
| docs／diff | 既存snapshot21画面189状態エラー0、diff check合格。AST24画面台帳とは別母集団 |

証跡：`.artifacts/alignment/post-patch-validation.log`、`session-results.json`、`offline-results.json`、`.artifacts/offline-e2e/20261023T084655Z/result.json`／`playwright.log`／画像。最新resultはdirty working tree、Node22.23.2、offline、googleAcceptance=falseを記録している。skipはWebKitの重複画像生成のみで、同ケースの権限拒否は検査済み。全89枚の人による目視承認や旧版pixel一致は未実施。

途中の失敗：容量不足によるbuild／テスト停止と、実NextでのHost照合403があった。容量回復・修正後に全ゲートを再実行して上表で判定。失敗実行をPASSへ読み替えていない。今回は自身の再生成可能なcache約29MiBだけ削除し、過去証跡・資料は保持。最終回帰中の空き約4.4GiB。

テスト用Web/API/Worker/DBポート3317・3327・3337・3357・3358・55643・55644は終了後に待受なしを確認。既存3100は切替なし。正本のdirty件数は買取32・総務22で維持。公開URL・実データ・実権限・通常traffic・本番DBを変更していない。

### 未完了の境界

P3のsession永続化・複数instance・本番監査・固定Hosting Cookie/callback/PKCE・サービス間identity、P4業務API移植、P5 Prisma、P6 SSOは未完了。現行APIとBearerを除去しない。ローカルPoCは本番動作を拒否し、通常ログインへの結線もしていない。全体計画の完了や公開許可とは扱わない。

[限定セキュリティ確認](../../reports/security-check-2026-10-23.md)。総務の検証は前回結果を維持し、今回の再実行ではない。

## 実装

1. Tailwind CSS 4.3.0とPostCSSを導入。既存CSS Modules・semantic tokenを残し、Preflightなし、`tw:` prefixで衝突を避ける。
2. TechnicalDetailsのlayout／読み上げ用非表示クラスを移行。production CSSにgrid／gap／sr-onlyの生成を確認。
3. Nextの `/api/v1/*` に既定OFFの互換transportを追加。Bearer、DTO、status、冪等キーを維持し、認証・認可・保存・監査は既存APIへ委譲する。
4. Cookie単独、別originの更新、任意転送先・redirect、偽actor／devヘッダーを受け入れない。通信障害で更新を自動再送しない。
5. 相場・経費・ランキング・API・SSOへのno-storeヘッダーを補完。
6. P1で変更しない業務・DB・公開設定の比較ガードを追加。

これはCookie session移行、Fastify廃止、Prisma導入、SSO統一の完成ではない。BFFを本番有効化する設定も追加していない。

## 実行結果

| 対象・コマンド | 結果・範囲 |
|---|---|
| `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` | 初期実装で全コマンド終了0。通常unitは586件合格、DBが必要なケースは下記で別実行。PostCSSの匿名export警告は修正後のlintで解消 |
| `TEST_POSTGRES_PORT=55643 pnpm test:db` | 終了0。隔離PostgreSQLでdatabase 29件、Worker 31件、API 115件合格。合成seed、65 migration適用。既存認可・scopeテストを含む |
| `pnpm --filter @hanamaru/web exec vitest run src/server` | 最終の追加routeゲートを含む25件合格。既定OFF、Cloud Runでのlocalhost拒否、エラー・ヘッダー・転送・非再送など |
| `pnpm --filter @hanamaru/web exec playwright test -c playwright.alignment.config.ts` | 3件合格。実Next production server＋Chrome＋合成HTTP upstream。ブラウザPOST、409／本文／冪等キー保存、Cookieのみ拒否、異origin拒否、upstream 401保持。実Identity Platform・RLSのE2Eではない |
| 最終Web lint／typecheck | 終了0 |
| `pnpm test:security` | 最終403テキストファイルで秘密情報・非匿名メール検出0。包括的脆弱性診断ではない |
| `pnpm docs:validate` | 既存契約snapshotの21画面・21パターン・189状態でエラー0。現在の全実装画面の棚卸し数とは異なる |
| `node scripts/check-alignment-preservation.mjs` | 基準と192ファイル一致。API29、Worker18、contracts7、database86、market-price14、platform26、infra10、Hosting設定2。業務実装・DB・公開設定の未変更を確認 |
| `git diff --check` | 合格 |

検証中の修正：初回transport E2EはNextが追加する強いcache禁止ヘッダーと完全一致しないため1失敗／2合格。`private`・`no-store`必須、`public`禁止の意味で検査し直し、3合格。security scanは匿名のuserinfo付きURLをメールと認識したため1失敗。許可済み匿名domainへfixtureのみ修正し、再実行0件。

## 再開と最終ブラウザ・DB role結果

### 容量整理後の再開（2026-10-23）

ユーザーの指示により、今回導入した未使用のChromium 1234と、専用worktree内の再生成可能な `.next/cache`・未使用のstandalone梱包だけを削除した。Chromeは端末の既存版を利用し、WebKit 2336を導入した。元のcheckout、依存関係の定義、資料、ソース、過去テスト証跡は削除していない。キャッシュは再ビルドで復元可能。

トレース記録に伴う一時領域が不足したため、`OFFLINE_E2E_TRACE=off`を明示した軽量実行を追加。既定は引き続き`retain-on-failure`。検査・必要画像89枚・ログ・JSONを減らす設定ではない。テスト結果のmanifestへtraceModeを記録する。

再実行で、日次作成中の旧見出しを待って入力していたテストと、ランキングの非同期通信を残したまま切替・終了するテストの競合を確認。要求した業務日と通信応答を待ち、終了時にroute handlerを完了させるようテストのみ修正。保存・再読込の期待値、scope拒否、画像枚数は維持する。

最終実行：`OFFLINE_E2E_TRACE=off E2E_CHROMIUM_CHANNEL=chrome OFFLINE_E2E_WEB_PORT=3317 OFFLINE_E2E_API_PORT=3327 OFFLINE_E2E_WORKER_PORT=3337 OFFLINE_E2E_POSTGRES_PORT=55644 pnpm test:e2e:offline`。

- **終了0、35合格・1意図的skip、画像89枚**。証跡 `.artifacts/offline-e2e/20261023T080947Z/result.json`・`playwright.log`・`screenshots/`。集計JSONは `.artifacts/alignment/offline-results.json`。
- 21画面×8幅、Chrome／WebKit、axe serious／critical 0、200%拡大、mobile navigation、keyboard、PDF→準備、音声→文字起こし→振り返り、相場3経路、eBay合成8市場、経費・拠点締め、ランキング、保存・再読込・通信断再開を検査。外部AI・外部相場APIには接続していない。
- skipはWebKitの重複画像生成だけ。先に同ケース内で実行される査定員の管理5画面拒否は確認済み。正式画像はChromeで収録する既存設計。
- `pnpm test:db:roles`も終了0。隔離DBでSCRAM誤パスワード拒否、API／Worker別loginのNOINHERIT・NOBYPASSRLS、相互role移行拒否、実repository操作を確認。
- Web lint／typecheck、server単体25、security 403ファイル検出0、docs 21画面189状態エラー0、維持ガード192ファイル一致を再確認。
- 画像89枚の生成と自動表示検査は完了。全89枚の人による目視承認、旧版とのpixel同一性は未実施。代表画像を目視したことと区別する。

### 途中の失敗（解消履歴）

- `20261023T075333Z`：34合格・1失敗・1skip。最後の画像生成が容量不足。
- `20261023T075805Z`：2失敗・34未実行。route応答破棄の競合。
- `20261023T075924Z`：22合格・1失敗・13未実行。WebKitの日次入力が旧日次の読み込みと競合。
- `20261023T080521Z`：18合格・1失敗・17未実行。WebKitのroute処理競合、途中ログの容量不足も発生。
- これらを合格扱いにはせず、上記最終の全件再実行で判定した。各ディレクトリの残存証跡を保持する。

### 初回の環境阻害（履歴）

全業務fixture E2Eを次で起動した。

```sh
OFFLINE_E2E_WEB_PORT=3317 OFFLINE_E2E_API_PORT=3327 OFFLINE_E2E_WORKER_PORT=3337 OFFLINE_E2E_POSTGRES_PORT=55644 pnpm test:e2e:offline
```

DB初期化・Web/API/Workerのbuildと起動は成功。ただしChromium／WebKitの実行ファイルが未導入だったため、最初の2ケースがブラウザ起動エラー、残34ケースは未実行。証跡は `.artifacts/offline-e2e/20261023T074151Z`。

ブラウザ導入を試みたところ `ENOSPC: no space left on device` で停止した。端末の空きは約230MB。既存Chromeを利用した上記3件のみ追加検証できた。ユーザーの資料・既存作業・他セッションのキャッシュは削除していない。

以下は合格扱いにしない。

- 旧版との全画面pixel画像比較・人による全画像承認。
- P0の全画面→API→DB／Job→担当の完全台帳と、通常配備imageとの照合。
- Cookie／Hosting／PKCE／SSO、Prisma／pool／RLSの新経路、API業務移植。
- Stage・本番・実利用者の認証／保存操作。

## 継続手順

1. 総務のTailwind 4 UIと併せ、既存版との表示を比較する。既存localhost:3100の別作業サーバーを勝手に置き換えない。
2. 完全台帳と認証PoCを揃えてP3以降へ進む。既存Bearer・SQL実装は検証前に除去しない。
3. 端末容量は引き続き少ない。大量画像・新規依存の工程は数GB以上を推奨するが、無関係なファイルを自動削除しない。

成果は専用worktree内の未コミット変更として保持。既存正本checkoutの32件の変更、別PR、未追跡資料には触れていない。
