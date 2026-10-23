# 長時間セッション・共通SSO実接続：ローカル検証

対象：買取 `feat/hanamaru-kintai-alignment-20261023`（基準 `09d6fb1432e85a8bebd5342df078c2baba18e6ad`）、総務 `feat/soumu-kintai-alignment-20261023`（基準 `204a4791a7f1abf7d726a0e89a58e816d6156cd4`）の未コミット差分。2026-10-23 JST。

継続：前段で残したローカル3製品UI横断は、実providerと3製品を起動した別試験でChromium／WebKitとも合格した。[結果・対象・再現](2026-10-23-three-product-ui-local-verification.md)。以下の単独SSO試験と分けて記録する。公開URLの検証・反映は引き続き実施していない。

公開URL・Cloud SQL・既存利用者ID・所属・権限・通常配備は変更しない。commit・push・PR・デプロイなし。実Googleログイン・実利用者・外部AI・Soldgraphは試験に使わない。

## 長時間セッションの契約

既存の5分Cookie／合成issuer試験に加え、共通SSOに限った長時間経路をローカル専用に追加する。Google/Bearer通常経路、SSOの既定クライアント登録、総務・勤怠の既存セッション仕様は切り替えない。

| 項目 | ローカル実装 |
|---|---|
| アプリの上限 | `min(発行時点＋8時間, 検証済みauth_time＋8時間)`。更新・閲覧でも延長しない |
| アクセストークン | 共通SSOの従来どおり5分。30秒前からサーバー側で更新 |
| ブラウザ | opaque HttpOnly／SameSite=Lax／host-only Cookieのみ。CSRFを維持。refresh tokenを返さない |
| サーバー保存 | 既存のAES-256-GCM暗号化payloadにrefresh token・issuer・sub・auth_time・有効期限を保持。新しい業務テーブル／本番migrationなし |
| 同時更新 | PostgreSQLのversion付きCASで同じCookieの更新権を一度だけ取得。排他leaseは20秒、待機要求は6秒で503として再操作を案内 |
| 再起動 | 暗号鍵が同じなら別processで復元。メモリ内の排他だけに依存しない |
| 更新時の本人確認 | 不変subを再解決し、元のauth_timeで共通ログアウト・停止・リンクの状態を確認。新しいtokenのiatで失効を回避しない |
| 要求ごとの認可 | 既存APIの `/me` と業務認可を引き続き利用。membership一致・組織・現役role/capabilityを再判定 |
| 更新失敗 | 結果不明のrefresh tokenを再送しない。fail closedで再ログイン要求。業務要求は認証成功前に送らず、書込後の自動再送なし |
| ログアウトとの競合 | 更新完了時も保存行と排他ownerを再確認。削除されたCookieを復活させない |

実際に8時間待った試験と、時計を注入して3時間後・8時間境界を検査した試験は区別する。実provider試験では、テスト専用操作により短命アクセストークンを実DB上で期限切れにし、同時・連続更新を検証する。これは8時間のwall-clock耐久試験を意味しない。

## 総務SSOへの接続

総務の `apps/sso/src/server.ts` を別processで起動する。discovery／署名鍵／ID・パスワード照合／PKCE／コード交換／refresh rotation／内部照会／共通ログアウトは実装本体を使い、合成issuerへ置き換えない。利用者・パスワード・承認対応・組織は合成データのみ。

現行providerの同意処理は `openid` のみ。追加の `local-session-policy.ts` は、次をすべて満たすときだけ買取への `offline_access` 同意と8時間のRefreshToken TTLを有効にする。

- `SSO_LOCAL_LONG_SESSION=true`。
- `K_SERVICE` が存在しない。
- issuerと登録製品URLはHTTPの `127.0.0.1`。
- DBは `127.0.0.1` の `soumu_alignment_test` だけ。query parameterなし。
- refresh grantを許可する登録clientは `sso-hanamaru` のみ。

通常起動は既定OFFのまま。公開側のclient metadata・Secret・DB・trafficを変更しない。固定commitに対する保全検査では、総務の保護対象84ファイル中83件完全一致、provider1件はレビュー済みのlocal gate変更としてhashを固定する。業務repository SQL、製品ID、他の認証経路は基準どおり。

## 実行と証跡

```sh
ALIGNMENT_REAL_SSO_TESTS=true \
SOUMU_LOCAL_REPO=/absolute/path/to/dedicated/soumu-worktree \
pnpm test:alignment
```

試験開始時には5GiB以上の空き容量が必要。通常の3100、既存DB、公開サービスは使わない。PostgreSQLは55646、実SSOは3381、互換APIは3382、実Nextは3383、テスト制御は3386。ポート占有は失敗として停止する。

総務側は既存のschema-only migration projectionを再利用し、歴史的な社員・マスタseedを取り込まない。試験制御口は独立した `e2e` fixture内にのみあり、secretで保護し、対象の合成subject／sessionに限定する。アプリのAPIや通常起動に含めない。trace・スクリーンショット・認証state出力は無効にする。

| ID | 試験 |
|---|---|
| E2E-REAL-01 | 実providerのパスワード＋PKCE → 同時6要求の更新1回 → Prisma保存・再読込 → ブラウザtokenなし |
| E2E-REAL-02 | 3回の期限切れ・更新で画面内未送信値維持 → 共通ログアウト → 古いCookie拒否 |
| E2E-REAL-03 | リンク取消後の更新拒否・取消復帰でも古いCookie不復活 → 絶対期限超過拒否 |

各シナリオはChromium／WebKitで実行し、JSON結果を `.artifacts/alignment/real-sso-browser.json`、起動・DB・build結果を `.artifacts/alignment/real-sso-run.log` に保存する。未実行・失敗は合格としない。

## 公開前に残す境界

この試験の「実接続」は**実際のproviderコードと製品アプリを隔離localhostで接続**する意味。公開providerや実Googleアカウントへ接続したという意味ではない。総務・勤怠の登録clientはprovider設定の整合確認対象であり、この試験だけで3つの製品UIを往復したとは扱わない。

本番clientへのrefresh grant採用・同意／TTL、固定HostingのCookie転送、3つの正式URLの往復、TLS、鍵更新・session用DB最小権限、分散要求制限、公開後切戻し、コンテナ実buildは別ゲート。本番の機能・データ・権限はそのまま保持する。

検証結果は [結果台帳](2026-10-23-alignment-test-results.md) の本工程欄に記録する。
