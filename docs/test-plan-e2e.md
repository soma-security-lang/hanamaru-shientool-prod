# 勤怠基準移行 P1 のローカル検証

## 最新追加：3製品UI横断

総務worktreeの `CROSS_PRODUCT_ALIGNMENT=true ... pnpm test:cross-product` で実provider・管理API・3製品の実UIを起動する。買取は本worktreeの8時間Cookie／native API／Prisma経路。Chromium／WebKitで共通ログイン1回→勤怠→買取→総務→勤怠→共通logoutを確認し、2 journey合格、失敗・skip・flaky 0。権限の製品間昇格なし、logout後の3 API 401・各画面再ログイン要求を確認した。

再現・母集団・証跡・対象外は [3製品UI横断結果](adr/2026-10-23-three-product-ui-local-verification.md)。1 journey内の5工程を別10テストとは数えない。公開URLでは未実施。

## 追加：長時間セッションと実装providerへの接続

`ALIGNMENT_BROWSER_TESTS=true ALIGNMENT_REAL_SSO_TESTS=true SOUMU_LOCAL_REPO=<専用総務worktree> pnpm test:alignment` で、従来session 8＋署名fixture 6に加え、実総務provider 6（3シナリオ×Chromium/WebKit）を確認する。前提は5GiB以上の空き容量、隔離した2DB・合成利用者のみ。通常の3100や公開サービスには接続しない。

- E2E-REAL-01：実パスワード・PKCE・コード交換、期限切れにしたprovider access token、同時6要求でrefresh一度、Prisma保存・再読込、ブラウザへのtoken不保持。
- E2E-REAL-02：日報の実フォームに未保存の合成メモを入力し、3回のサーバー更新で保持。別タブの共通ログアウト後は古いCookie拒否。
- E2E-REAL-03：承認リンク取消→更新拒否。リンクを戻しても古いCookieを復活させない。絶対期限超過で拒否。
- 単体・DB：時計注入による3時間後・8時間境界、暗号化、別process復元、CASのABA拒否、更新中logout、結果不明のrefresh再送禁止、旧tokenの遅延401で新セッションを消さない、業務writeは再送しない。

再現・フラグ・公開工程との境界は [長時間session ADR](adr/2026-10-23-long-session-real-sso-local.md)。実装本体とのlocalhost接続と、公開3URLの横断／8時間の実時間耐久を混同しない。実行結果は台帳へ別記する。

2026-10-23継続：P3〜P6のローカル経路を追加した。次節を現行計画とし、下方のP1記述は前段階の履歴とする。

## 現行：永続session・native API・Prisma・server SSO

- `ALIGNMENT_FULL_CONTRACTS=true ALIGNMENT_BROWSER_TESTS=true pnpm test:alignment` で独立PostgreSQLを作り、合成データと署名issuerだけで検証する。既存3100や通常DBは利用しない。
- 3377は実Next production build、3378はRSA署名の合成OIDC、3379は非移行API用。DBは55646。成功・失敗とも専用processと一時DBを後片付けする。
- Chromium／WebKit各3シナリオ、計6実行。390pxで画像とaxeを記録。鍵・token・認証stateは証跡へ収録せず、ブラウザ永続保存しない。

| ケース | 要件 | 操作と期待結果 |
|---|---|---|
| E2E-PERSIST-01 | REQ-03,04,05,06 | 共通ログインUI→署名/PKCE/callback→Cookie→経費日次を作成→入力値をGUI保存→再読込。ID・メモ・本人権限が同じ。HttpOnly Cookie、ブラウザBearerなし、logout後401、page errorなし |
| E2E-PERSIST-02 | REQ-04,05 | provider失効後のCookieで401。provider状態を戻しても失効Cookieは復活しない |
| E2E-PERSIST-03 | REQ-02,03,05,09 | Cookieで訪問/アップロードsessionを作成→percent-encoded object keyへPDFをPUT→確定→private fileをGET。同じbyte列とID/権限を保持。JSON writerと旧binary ownerを一度ずつ使用 |
| DB-PERSIST-01 | REQ-03,05 | 別client・別Node processから同じsessionを復元。DBは暗号化、一度だけrotation、試行上限・期限・誤鍵拒否 |
| DB-PRISMA-01 | REQ-03,04,06 | 旧pgとPrismaの型比較、SQLSTATE、rollback、pool max1での組織切替・GUC消去 |
| CONTRACT-NATIVE-01 | REQ-02,03,04,06 | 既存API統合試験92件の期待値をそのままnative経路へ適用。意図的COMMIT faultの1件は既存repositoryを使う。binary等は旧owner |
| CONTRACT-WORKER-01 | REQ-03,06,09 | Prismaで商品同定・outbox・既存のSTT retry/cancel・upload削除・運用alert復帰を検証 |

既存8件のsession防御テストもPostgreSQL storeで再実行し、通常Bearer transport3件・既存全画面offline35件＋1skipを別実行する。総務providerのDB統合12件は別製品のprovider契約確認であり、3製品の新sessionを同一browserで切り替えた検証とは区別する。

固定Hosting、実Google、3正式URLのSSO往復、全体logout、長期session、実利用者による受入は今回のローカル試験に含めない。最新実行結果は [検証記録](adr/2026-10-23-alignment-test-results.md)、実装・再現は [追加ADR](adr/2026-10-23-persistent-session-native-api-prisma-sso.md)。

- 対象：専用worktree、合成データ。外部AI・本番DBへの接続なし。
- 基準：09d6fb1432e85a8bebd5342df078c2baba18e6ad。
- E2E-01（REQ-01,04,06）：同一origin transportから読取、更新、権限拒否、409を確認。既存契約と冪等キーを保つ。
- E2E-02（REQ-05,06）：Cookie単独、別origin、偽actor、redirect、通信失敗を拒否／結果不明表示。更新を自動再送しない。
- E2E-03（REQ-07）：既存fixture画面をChromium／WebKitで検証。TechnicalDetailsのcollapse、copy、keyboard、mobile表示。
- 既存単体・隔離PostgreSQL・build・prototype E2Eを利用する。ブラウザの全業務fixture検証は実行結果で対象と未実行を分ける。
- P3以降のCookie、OIDC、Prisma、Stage、通常本番は本段階の合格対象外。計画全体の完了とは扱わない。

## 追加：ローカル専用セッションPoC

同一origin 127.0.0.1:3357 の実Nextと3358の合成APIのみを使う。ローカル専用flagは既定OFFで、本番では起動不可。既存のログインUIや業務ApiClientの切替は対象外。

| ケース | 要件 | 確認内容 |
|---|---|---|
| E2E-SESSION-01 | REQ-01,04,05 | session交換、HttpOnly Cookie、CookieのみのAPI、再読込、logout、Cookie削除 |
| E2E-SESSION-02 | REQ-04,05 | CSRF・異Origin・組織すり替え・Bearer混在を拒否。upstream到達なし |
| E2E-SESSION-03 | REQ-04,05 | API側で失効したmembershipは既存Cookieでも拒否し、復活しない |
| E2E-SESSION-04 | REQ-06 | 保存直後に接続が切れた場合、結果不明を返し、保存を再送しない |

実行：`pnpm --filter @hanamaru/web exec playwright test -c playwright.session.config.ts`。Chrome／WebKit各4、計8件。JSONは `.artifacts/alignment/session-results.json`。通常Bearer transportは `playwright.alignment.config.ts` の3ケースを別途再実行する。

初回は容量不足で中断し、その後の実ブラウザではNext内部URLをpublic originと比較していたため403を検出。固定Host・Origin検証へ修正し、偽forwarded hostの拒否も単体へ追加。修正後8件全合格。これを本番Hosting Cookieの合格とは扱わない。

## 現在の結果

E2E-01／02は `playwright.alignment.config.ts` の実Next＋合成upstreamで3件合格。E2E-03の全業務fixtureはChrome／WebKitで35合格・画像生成の重複回避1skip、89画像、21画面×8幅を完了。容量制限によりtraceだけOFF、ログ・JSON・画像・判定条件は維持。実Google認証・外部AI・本番DBの合格とは分離する。詳細は [検証記録](adr/2026-10-23-alignment-test-results.md)。
# 追加：本番対応の段階公開検証（2026-10-29）

対象は `docs/adr/2026-10-29-production-alignment.md` の PROD-01〜08。今回SHAのCIで `pnpm test:e2e:offline`、総務の同時固定SHAから `CROSS_PRODUCT_ALIGNMENT=true node e2e/cross-product/run.mjs` を実行する。最新勤怠mainを固定し、古い10月23日の横断合格を今回の合格として使わない。

- E2E-PROD-01：既存Googleと既存画面・APIの回帰。fixtureのみ、実利用者情報・外部送信なし。
- E2E-PROD-02：共通ログイン→勤怠→買取→総務→勤怠、製品内認可、製品logoutと共通logout。Chromium／WebKit。
- E2E-PROD-03：SSO期限切れ時にGoogleへ自動fallbackしない、logout通信失敗の明示、再試行。
- E2E-PROD-04：360／390／430／834／1440px、keyboard・200%・axe serious/critical 0。既存画面の本文16px・補足13px・44px操作を維持。
- Stage-PROD-01：独立DB・合成データ・同一digest、Hosting相当の入口でCookie／callback／保存を確認。既存の別セッション用 `sso-review-*` 環境を上書きしない。
- PROD-ACCEPT-01：固定3URL、実Google・停止／権限・保存再表示・Job、通常traffic read-back。実利用者データの変更は禁止。

ローカルの64重点unit・隔離DB契約の合格はブラウザ合格とは数えない。今回のCI・Stage・本番E2Eは未実行。失敗・skip・起動不能は未完了として残す。生成画像・認証state・ログはGit対象外。
