# 買取相場 eBay Soldgraph連携 実装・デプロイ計画

- 作成日：2026-10-09（Asia/Tokyo）
- 対象：買取支援ツールの既存SCR-021「買取相場」
- ゴール：eBay Soldgraphを追加し、固定Stageで検証後、Yahoo!オークション／オークファンを維持したまま本番で利用可能にする
- 関連要件：`2026-10-09-ebay-soldgraph-requirements-and-spec.md` v1.2（8市場・課金・受入条件）
- 現在の実装作業ブランチ：`feat/ebay-soldgraph-worldwide-20261009`

## 1. 完了状態

### 今回の配備範囲（2026-10-09の追加指示）

保存期間は利用者の指定により**365日**とする。今回の完了対象は実Soldgraph接続ではなく、eBay実装と追加schemaを固定Stageから本番へ配備すること。外部通信は`SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS=false`、本番eBay flagはOFFを維持し、キー登録・Usage照会・実検索・実枠消費を行わない。合成結果を本番へseedしない。Yahoo／オークファンの現在の利用条件は変更しない。

組織別365日方針の実DB登録、対象組織の有効化と予算・キー・実接続受入は後続の有効化工程とする。今回のOFF配備では架空の承認membershipを作らず、保持方針が未登録の新規取得を拒否する既存ガードを維持する。これを「eBay実取得が利用可能」とは報告しない。

実取得がないため、確定済み実結果を要求する`EBAY_RELEASE_READBACK_REQUIRED=true`の受入は今回に適用しない。既存業務の固定Stage／本番E2E、認証・権限・readiness・digest・rollback、およびローカル／CIの両browser検証は維持する。macOSのWebKit障害はLinux CIで同じsourceを検証し、成功を確認してから昇格する。外部取得を有効にする公開時には専用読取ゲートと実課金照合を必須とする。

利用者が既存の買取相場画面で商品を特定し、対象市場と検索条件を確認してからeBay検索を始める。取得後は市場別・表示通貨別の候補を確認し、参考相場を確定・再表示できる。本番では承認された対象組織だけでeBay検索を有効にし、Yahoo!オークション／オークファンの検索と履歴も引き続き利用できる。

8市場は米国、英国、カナダ、オーストラリア、ドイツ、フランス、イタリア、スペイン。全市場を選択した場合、初回は各市場1ページ、最大200行ずつを取得する。結果はページ取得時点の参考値とし、全世界の全取引や確定した決済価格を保証する表示はしない。

| Soldgraphのmarket | eBayサイト | 表示通貨 |
|---|---|---|
| `us` | ebay.com | USD |
| `uk` | ebay.co.uk | GBP |
| `ca` | ebay.ca | CAD |
| `au` | ebay.com.au | AUD |
| `de` | ebay.de | EUR |
| `fr` | ebay.fr | EUR |
| `it` | ebay.it | EUR |
| `es` | ebay.es | EUR |

## 2. 現在地と未完了点

### 外部取得OFF配備の進捗

eBay実装は`bdafa9e2ab37154b55aeb35e98e56e01e9079ef5`として`origin/main`へpushした。経費・SSOの並行変更とPR31は取り込んでいない。初回CIは依存関係auditで失敗し、対応するCloud Buildは配備前にキャンセルした。本番DB・通常配備Revisionは変更していない。

必要最小限の安全更新としてNext／eslint-config-nextを16.3.8、source-map-jsを1.2.2へ揃えた。アプリの画像previewはunoptimized、remotePatterns未設定であり、Next advisoryの攻撃条件が現行設定で成立したとは断定しない。source-mapの外部入力経路も未実証。更新後のprod auditはHIGH／CRITICAL 0・moderate 3、Web250件・型検査・lint・production build・正規source-map変換・秘密情報検査・文書検査が成功した。Linux CIとコンテナscanは別ゲートとして再実行する。検査の除外・閾値低下・無関係な依存更新は行わない。

次の表と後続追記は初回commit以前の調査履歴を含む。現在のOFF配備では、保存期間365日の合意は済んでおり、Soldgraph実接続・実使用量照合・有料試験・組織flag有効化は今回の完了対象外とする。

| 項目 | 確認結果 |
|---|---|
| 基準ブランチ | `origin/main` と一致する `6f3fb24afa2027afe3b61f9525157c8dcb03a2c5` から専用ブランチを作成 |
| 作業範囲 | eBay専用worktree。元worktreeの経費等の未コミット変更は含めていない |
| Soldgraphキー | ローカルのGit除外ファイルへ設定済み。キーの値、有効性、実アカウントの残枠は読み出していない |
| ドメイン／通信 | 8市場・市場別通貨、価格と商品一致の除外、外れ値・統計、構造化応答、固定host・再送キー・照会、任意の英語AI提案を実装。最新全unitではmarket-price 145件、platform 99件合格。実Provider契約・実データ精度は未確認 |
| DB／API／Worker | `0067_ebay_soldgraph_search.sql`と実API→Job→Worker→隔離PostgreSQLを接続。最新隔離ゲートはDB29件・Worker31件・API106件合格。RLS、最小権限ロール、冪等再送、lease／CAS、予算3scopeと期間境界、取消・unknown保持、snapshot、cache・再検索、保持方針取り消し時の送信／公開停止を検証。本番DBには未適用 |
| 保存・削除 | 組織の承認済み保持方針がない新規取得は拒否。既存retention Jobから期限超過した終端検索本文を削除し、課金・unknownと48時間の冪等tombstoneを保持。隔離fixtureの90日は本番方針ではない。実保存期間と最小課金台帳の運用は合意待ち |
| Web接続 | MP-02〜結果・履歴へ8市場・最大枠・市場別進捗・採否・追加page・取消・retry・編集再検索・確定・再読込を接続。操作結果不明から固定キーで復旧。国内確定結果との比較は明示操作・独立表示とし、合算や新しい外部検索をしない。Web unit250件合格（Stage読取ゲートの純粋検査21件を含む） |
| 最新ローカル品質 | 全unit548件合格（DB依存116件skipは別隔離ゲートで検証）。Web型検査・追加ファイルlint・リリースguardの追加回帰も成功。全体typecheck・lint・検証用production buildは先行実行、security372ファイル検出0、docs21画面／189状態error0、diff検査成功。Terraform validate・runtime contractとmock planは先行実行の結果であり、実applyではない |
| 最新ブラウザ実走 | `.artifacts/offline-e2e/20261009T123212Z/`：Chromium17シナリオ合格・81画像・axe serious／critical 0・21画面×8幅の横はみ出し検査成功。`PASS_SCOPED`／`formalBrowserGatePassed:false`／`googleAcceptance:false`。合成Provider・隔離DBの結果であり、実Soldgraph・Googleログインの合格ではない |
| 視覚確認 | 先行`20261009T122117Z`の77枚を確認。最新`20261009T123212Z`の管理SCR-018の3枚と、長いeBay・経費の390／1440pxの4枚は全区間を確認。異なる実走の証拠を区別し、最新81枚すべてを視覚受入したとは扱わない。既存画面の観測課題も残す |
| WebKit | 同revisionの独立cache・合成ページでも遷移に失敗し、macOSログでGPU processの停止を確認。下位原因は未確定。最新両browser正式ゲートは未合格。GPU無効化やゲート省略はしていない |
| 通常配備 | 読み取り照会でWeb／API／Workerのdigestが既存Buildと3/3一致、commit labelは`6f3fb24`、migrationは0066。Build source内容とGit treeの比較は未実施。今回の未commit eBay差分の配備証拠ではない |
| 承認・実接続・公開 | eBay-only commit／push／deployは承認済み。実APIは「未接続で実装」の範囲を維持。本番の保存期間、対象組織、account／組織／利用者の枠上限、限定実試験の消費承認、実Usage・結果・課金照合、固定StageのGoogle認証・rollbackと同digest本番昇格が未完了。キー値の読取、実枠消費、GCP書込、commit、push、デプロイは未実施 |

上表は最新の現在地であり、後続の追記にある少ないテスト件数や「実走中」は当時の履歴として保持する。ローカルの接続・復旧・cache・停止／保持制御は実装して検証したが、正式両browserゲートと実接続・公開は未完了。合成応答の合格を実API精度・本番利用可能性へ読み替えない。未承認の外部呼出しや、未合格ゲートを飛ばした本番操作は行わない。

### 最新の長画面確認と未完了ゲート（2026-10-09 21:43 JST）

最新Chromium実走`20261009T123212Z`の長い4画像を、原画像を変更せず、1200px以下の区間をメモリ上で切り出して全区間確認した。対象はeBay390px（高さ14,449px）・1440px（11,293px）、経費拠点390px（7,561px）・1440px（5,432px）。前ターンの末尾1200px確認と今回の連続区間確認を合わせ、区間の欠落がないことを確認した。スマホの8市場すべて、各市場の通貨・件数・価格分布・除外理由・所在地の注意書きが表示され、読み取れる。経費では補充を経費へ加算しない説明、締め時点の差異、訂正影響の確認待ち、報告時刻と登録時刻、未完了事項が区別されている。経費のコード変更は今回のeBay差分に追加していない。full-page画像内の固定ヘッダー／ナビの位置は撮影時のスクロール状態を含むため、静止画像だけを重なりの操作受入と扱わない。

この確認は最新4画像の全長確認であり、最新81枚すべての視覚受入ではない。先行77枚、最新SCR-018の3枚、今回4枚の証拠を別々に保持する。既存のPDF原本描画・実音声再生・動画空状態等の未確認事項は解消したとしない。

同時刻に、外部通信しない合成HTTPページでブラウザの阻害を再確認した。ChromiumはDOM読取まで469msで成功、同じページのWebKitは10秒の`page.goto` timeoutで失敗（10,596ms）。両ブラウザとループバックHTTPサーバーは試験後に終了した。過去の同revision独立cacheの失敗と整合し、現在もWebKit正式ゲートを通せない。今回の試験だけでGPU停止の下位原因を新たに断定しない。timeout延長・GPU無効化・ブラウザ代替による合格扱いはしていない。

配備へ進むには、保存期間、本番対象組織とaccount／組織／利用者の枠上限、実API消費承認の回答に加え、WebKitが正常に動く検証環境で最新sourceの正式両browserゲートが必要。未承認のキー読取・外部API利用や、ゲート未合格のcommit／push・Stage／本番反映は実行しない。これらの阻害が解消するまで公開完了とは報告しない。

### 固定Stage／本番の保存結果読取ゲートを追加（2026-10-09）

既存`run_live_e2e`は通常業務のroutes／real-stackを実行するが、eBay保存結果の専用確認を含まなかった。`apps/web/e2e/ebay-live-readonly.spec.ts`を追加し、専用の試験membershipと確定済み検索を明示した場合だけ、390／1440pxで保存結果の表示・再読込・同じ検索IDへの復帰・横はみ出し・未同意の最新取得button無効を検査する。ブラウザからeBay APIへの変更methodは遮断・件数検査し、GET前後で確定snapshot hash／版・page・creditの最小証跡が不変か比較する。未確定・unknownのpageを持つ検索はこの読取ゲートへ使用しない。実検索の作成、confirm、追加page、採否変更をこのテストから実行しない。

このテストは保存結果の読取検査に限定する。実Soldgraphの検索精度・受付順・課金契約、account全体で他Jobの通信が0件であること、Googleの初回ログイン、全role／scopeの本番受入を証明しない。別の実試験・Usage照合と既存認証／認可ゲートは維持する。使用するのは専用の合成試験scopeと匿名商品であり、実利用者の過去検索を指定して試験しない。

必須入力は次のとおり。値は承認・GCP読取照会から取得し、token・キーを文書やコマンド履歴へ記入しない。

| 入力 | 用途 |
|---|---|
| `LIVE_EBAY_READONLY_E2E=1` | 専用読取テストの明示起動 |
| `LIVE_EBAY_SYNTHETIC_SCOPE_CONFIRMED=1` | 試験用scope・匿名データを運用者が確認済み |
| `LIVE_EBAY_CONFIRMED_SEARCH_ID` | 実試験で保存・確定した自社検索UUID。検索語や外部request IDは指定しない |
| `LIVE_EBAY_EXPECTED_MEMBERSHIP_ID` | `/me`と一致させる承認済み試験membership UUID |
| `REAL_STACK_E2E=1`、`E2E_REMOTE=1`、`E2E_INCLUDE_WEBKIT=1` | remote実stackと両browserの構成。単一browserの実行は正式合格としない |
| `E2E_WEB_BASE_URL`、`E2E_API_BASE_URL` | 読取照合済みの固定Stage／本番Webとpilot API。HTTPSのみ、任意host・credential・query・fragmentを拒否 |
| 既存Identity Platformのmanager ID token／refresh token／local IDと公開認証設定 | 既存認証helperへ渡す。SoldgraphキーをWebテストへ渡さない |

hostの形式検査はGCP project・Revision・imageの照合の代わりではない。固定Stage／本番の実URLとdigestはリリース前に別途読み取りで一致確認する。trace・failure screenshot・videoをこのliveテストでは無効にし、tokenや商品DTOを失敗証跡へ収録しない。API transport失敗は固定の案内へ置換し、assertionも入力本文やDTOの比較表示をしない。

通常の既存リリースは変えず、**本eBay公開リリースでは`EBAY_RELEASE_READBACK_REQUIRED=true`を必ず指定する**。`scripts/release-blue-green.sh`は、その指定時に両browser・試験scope確認・2つのUUIDをデプロイ前の入力段階で検査し、同じ読取テストをStageと本番の両方の既存E2Eへ追加する。指定しない通常リリースの合格を、本eBay公開の全受入とは扱わない。初回OFF配備の通常業務確認と、実試験後のeBay読取確認を区別し、OFF配備だけでeBay利用可能とは報告しない。

ローカル結果：純粋ゲート検査21件・Web全250件・全unit548件合格、DB依存116件skipは先行隔離DBゲートと別。Web型検査、追加ファイルlint、shell構文、release-guardの正負入力／追加spec有無のmock command試験、diff検査が成功。macOS Bash 3.2のnounsetで空arrayが失敗するため、追加specなしでも安全な関数引数展開へ修正した。テストharnessのprocess substitution読取で関数が未定義となった失敗は、専用一時fixtureのsourceへ変更し再実行して解消した。秘密情報検査の初回は架空のcredential付きURLを非匿名メールと検出したため、fixture hostを`example.invalid`へ変更し、372ファイル検出0で再実行した。検査ルールは弱めていない。

未設定でのPlaywright実行は2browserともskipであり、**live E2E合格ではない**。その実行では認証・Soldgraph・GCPへ接続していない。今回の追加テストをStage／本番で実行した証拠はまだない。既存アプリ・DBの配備、実API消費、commit／pushは行っていない。

読取ゲートをさらに強化した。390／1440pxそれぞれの初回表示と再読込後について、市場別の受信行数・採用件数・最低価格・中央値・最高価格を、確定snapshotの保存値と照合する。通貨別に独立した市場articleの表示を比較し、失敗出力に価格本文を含めないboolean assertionとする。JSON decode失敗も固定メッセージへ置換する。この追加分のWeb型検査・対象lint・純粋検査21件は成功。実Stage／本番の価格表示一致は、テストの実行承認と接続後に初めて判定するもので、現時点では未実行である。

## 3. 固定する仕様

- データ取得はSoldgraphのeBay Sold Listings APIを使う。eBay URLジェネレーター、eBay直接スクレイピング、別APIへの自動切替は追加しない。
- 利用者のアプリ認証は既存方式を維持する。Soldgraphキーはサーバー側Workerだけで使い、ブラウザ、URL、ログ、監査本文へ出さない。
- 対応市場は `us / uk / ca / au / de / fr / it / es`。`gb`や未知の市場は受け付けない。各市場1リクエストずつ処理する。
- 8市場すべてを選んだ初回検索は最大8枠・1,600受信行。利用者が選んだ市場だけ開始し、予算不足時に市場数を黙って減らさない。
- 追加ページは市場別の明示操作とし、自動で続きのページを取得しない。アプリ上限案は検索全体20ページ、市場別10ページ。
- Yahoo・オークファンの90日、日本円、候補型、統計をeBayの期間・外貨へ流用しない。eBayは取得ページのsampleとして扱う。
- 通貨を混ぜた世界中央値・価格順ランキングは作らない。Best Offer成立、未確認Best Offer、価格レンジ、欠損・非正値・通貨不一致は主統計から除く。
- 所在地不明は所在地だけを理由に除外しない。出品者の国籍・発送元を推測しない。市場間で同じ出品IDは横断件数上で重複排除するが、市場別の表示価格観測は保持する。
- 課金枠は市場・ページ単位。pendingまたは応答不明では枠を保持し、同じ操作の再送は同一キーと条件で行う。結果不明の状態から新規キーで再検索しない。
- eBay機能フラグは既定OFF。Yahoo・オークファンの既定動作を変えない。
- 停止フラグは新規検索・追加pageを止める。すでに外部受付されたJobは、reserved枠の解消に必要な固定host/保存済みrequest IDへのpollだけを許すか、強制停止ならunknownとして保留して運用照会へ回す。利用者向け候補更新や新たな検索は停止中に行わない。
- 停止後のstatus pollを許す場合もrate limiterと認証・固定host検証を通す。資格情報漏えい等の緊急時には全外部通信を遮断し、台帳をunknownに保つ別の運用手順を定義する。

### Soldgraphリクエストの固定契約

- 固定hostは `https://api.soldgraph.com`、検索は `GET /v1/ebay/sold`、完了照会は `GET /v1/jobs/{request_id}?wait=20`。
- Workerだけが `Authorization: Bearer …` と検索時の固定 `Idempotency-Key` を送る。キーをquery string、ブラウザ、API応答に含めない。redirectは追わず、poll応答に任意URLがあってもアクセスしない。
- 検索語 `q` は利用者が確認した1〜200文字。`country` は許可済み1market。`item_location=worldwide`、`sort=recently_sold`、`count=200` を固定する。初回 `page=1`、続きは前ページの保存済み `next_page` だけを使う。
- 選択済み `condition` だけを指定する。販売形式は任意で1つ。初版では `min_price`、`max_price` を送らず、未検証category IDを生成・流用しない。
- HTTP statusだけでなくJSONの `status=pending|complete|failed` と `request_id` を検証する。HTTP 200のpendingを完了扱いしない。解析できない応答を成功0件に置き換えない。
- Providerの `summary` を買取相場の正本にしない。必要フィールドを検証・正規化して自社の候補集合から再計算する。`completeness=provider_page_only` と日付の年推定を結果に残す。

### 相場計算の固定条件

- 表示通貨別に集計し、米国=USD、英国=GBP、カナダ=CAD、豪州=AUD、独仏伊西=EURを基準にする。市場の違うEURをまとめず、円換算・世界中央値は初版に含めない。
- 価格はbinary floating pointで集計せず、decimalとして扱う。ゼロ件は統計値null、1〜4件は少数標本として表示し、自動外れ値判定をしない。
- 同じ市場・通貨・比較可能な状態の基準集合を固定する。5件以上のとき、中央値から20%を超えて離れ、かつ線形補間p25〜p75から1.5×IQRの範囲外なら自動除外候補にする。反復除外で基準中央値を動かさない。
- 手動採否は監査対象とし、商品不一致の除外は同一eBay出品IDの各market観測へ反映する。Best Offer成立、Best Offer状態不明、価格レンジ、欠損・非正値、market通貨と異なる価格は手動復帰させない。
- 送料は商品価格に合算せず、送料nullを0として扱わない。sold_dateは時刻を作らず、Providerが年を推定した日付として保持する。

## 4. 実装工程とゲート

| 段階 | 実装 | 完了条件 |
|---|---|---|
| A. 基礎処理の完成 | 通信テストの未合格修正、検索条件検証、応答parser、金額小数処理、候補除外、8市場の部分結果・枠計上 | ドメイン・通信の型検査、lint、合成fixtureテストが合格。実ネットワークを呼ばない |
| B. DBとmigration | 市場別検索run、ページcheckpoint、外貨観測、予算ledger、確定snapshotを追加。組織RLS、監査、保持・削除を追加 | 最新mainと他PRのmigration番号を再照合。隔離PostgreSQLで新規DB・既存Yahoo/Aucfanデータの両方を検証。feature flag初期OFF |
| C. API | 既存 `/api/v1/market-price` の認証・権限・冪等性・楽観ロックを利用。eBay用のmarket/通貨DTOを追加し、検索、状態、候補採否、次ページ、確定、履歴、結果復元を実装 | assessor／manager scope、他組織・他支店、system_admin、flag OFFをAPI統合テスト。DB値と応答値の一致 |
| D. Worker | 市場別に固定キーを保存してから送信。pendingは保存済みrequest IDでpoll。marketごとの結果を保存し、他market失敗で成功分を失わない。外部成功後の自社parse/save失敗から復元 | Worker再起動、通信断、409、429、quota、failed、parser drift、取消、停止中の課金照合を統合テスト。結果不明時の新規request禁止 |
| E. UI | MP-01〜MP-06内にeBay取得元、8市場選択、最大消費枠確認、市場別進捗、外貨候補・統計、次ページ、履歴を追加 | PCと390pxスマホの検索→結果確定→再読込をE2E。Yahoo・Aucfan表示、円建て計算、既存動線に退行なし。axe serious/critical 0 |
| F. ローカル全体検証 | `lint → typecheck → unit → DB integration/RLS → build → security → docs → Chromium/WebKit E2E → axe/visual` | すべて合格。失敗は修正し、未実行をPASSとしない。実APIを呼ばない |
| G. commit・push・ビルド | リモートmainとPRを再確認。eBay差分だけをcommitしpush。Secret・顧客データ・経費差分がないことを確認。digest固定でWeb/API/Workerをビルド | eBay差分限定、脆弱性・ビルドゲート合格、commit SHA・Cloud Build ID・各image digest記録。既存リリースのPUBLIC repo preflight fail-closedを維持 |
| H. 固定Stage | Cloud Run固定Stageと既存Identity Platform/DB scopeを確認。初回はeBay flag OFFで配備し、認証、Yahoo/Aucfan、既存業務の回帰を確認 | 同一digest、readiness、DB migration、ログ、rollback先を機械照合。未送信fixture状態では外部呼出し0件。既存request IDがある場合は課金照合だけ許すかを確認 |
| I. 実接続の限定確認 | 追加の実枠消費承認を受けた後、APIキーをSecret Managerに登録しWorkerだけにIAM付与。限られた商品・市場で契約、課金、結果、再開を確認 | 承認枠内の取得だけ実行。市場別credits・所要時間・価格欠損・一致度を報告し、消費台帳とSoldgraph usageを照合 |
| J. 本番昇格・有効化 | Stage合格digestを段階昇格。eBay flagはOFFで配備し、公開直前に承認対象組織を限定してON | Googleログイン、role/scope、既存Yahoo/Aucfan、eBay検索と保存・再読込、監視、ERRORログ、kill switch、rollbackを確認。revision/build/digest/commitを記録 |

## 5. DB・APIの構成方針

既存検索テーブルは90日固定・JPY bigint・候補必須価格などの制約を持つ。これらをeBay用に曖昧に拡張しない。既存検索IDや既存認可を使いつつ、市場別処理・外貨観測・課金記録は専用の型・保存領域に分ける案を実装時に確定する。

最低限保持する単位：

1. 親検索：確認済み商品・検索語、対象market、条件、実行version、作成者、状態。
2. 市場別run：market、固定request hash、進捗、next page、failure class、lock version。
3. ページ：固定idempotency key、外部request ID、http/status、credits、取得時刻、parse version、ページ内容hash。
4. 観測：market、eBay item ID、表示amount/ISO currency、shipping、Best Offer状態、粗いcondition、sold date精度、所在地分類、候補決定。
5. 予算ledger：reserved/pending/charged/released/unknown、credits、account/request ID対応、一意制約。
6. 確定結果：market/currencyごとの統計、採用観測ID、集計・parser version、coverage、確認者・確認日時。

生HTML、キー、Authorization、完全な外部応答は保存しない。必要な応答フィールドに限定し、自由記述seller情報・画像は最小化する。API応答・UIは商品価格をsystem_adminへ見せない現行制約を守る。migrationの具体的な連番は実装直前にopen PRを確認して決定する。

## 6. 課金・再開に関する受入条件

- 8市場初回は最大8枠を原子的に予約し、予算確認後に送信する。利用者が減市場を選んだ場合だけ予約数を減らす。
- 同じ市場・ページ・試行の再送は同じ操作key。外部request IDは一つの操作だけが所有する。
- pendingは無料確定しない。failedとcredits 0を確認した場合だけ、利用者の再実行操作に新しい試行keyを発行する。
- ネットワーク断、保存結果不明、外部ID期限切れはunknownとして枠を保持し、照会・運用確認へ回す。
- Soldgraph完了後に自社parserまたはDB保存が失敗しても、外部creditsを記録し、既存request IDの結果回復を行う。新規検索に置き換えない。
- 外部完了と自社ページ完了を分ける。正常0件、未取得、失敗、処理中を異なる状態で表示する。
- 取得済みページの再表示は外部通信・枠消費を行わない。自社cacheとSoldgraph側cacheを別に扱う。
- quota、rate limit、pending上限、上流日次上限、キー無効を別状態にし、自動課金・自動プラン変更を行わない。

## 7. テスト範囲

### 合成fixture

- 8市場ごとの通貨、言語・condition表記、所在地の明示・欠損・矛盾。
- 同じeBay出品IDが複数marketで異なる表示通貨・金額を返す例。
- Best Offer true/false/null、価格レンジ、0・負数・小数・unknown currency、売却日欠損。
- 商品不一致、部品、セット、手動除外・復帰、少数標本、中央値、四分位、外れ値。
- 8市場中6成功・1失敗・1 pending、次ページの明示実行、部分結果snapshot。
- 通信断、固定key再送、同一request ID、parse失敗後の復帰、課金枠競合、RLS・Feature Flag OFF。
- Yahoo/Aucfanの90日、JPY統計、source switchingを維持する回帰。

### 実行コマンド案

リポジトリの正式なworkspace scriptに合わせて実行し、失敗したコマンド・環境・対象範囲を記録する。

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:db:roles
pnpm build
pnpm test:e2e:offline
node scripts/security-scan.mjs
```

追加で実行する画面確認はChromiumとWebKit、PCと390pxスマホ、keyboard/focus、戻る・再読込、axeを対象とする。開発中のpackage単位テストは素早い確認に使い、上記の全体ゲートの代わりにしない。実APIの接続はfixture全体ゲートを通過してから別承認枠で実施する。

### ブラウザ・安全性

- Chromium/WebKit、390pxとPC幅、戻る・進む・再読込、keyboard、axe。
- APIキー、検索語、生応答、署名URLがHTML、URL、通常ログ、監査本文、fixtureへ漏れない。
- 停止スイッチOFF時に新規submitと追加pageを拒否し、既存取得済み結果を保持する。受理済み外部Jobは、費用照合のための限定pollだけを許す通常停止と、漏えい等で全通信を止める緊急停止を区別する。
- system_adminの本文非表示、organization/branch/self scope、利用者の既存Googleログインを検証する。

### 実API確認（別ゲート）

実APIはfixtureと混ぜず、承認された検索枠上限を超えない。要件案の「2商品×8市場＝最大16枠」は未実施の試験案であり、現時点で消費承認済みではない。実接続試験を実行するには、商品、対象market、枠上限、実行する環境、追加ページの可否を明記した承認が必要。試験結果はmarket別候補数、一致率、重複率、欠損、処理時間、usage/creditsで報告する。実試験前に精度や市場の取得成功を保証しない。

## 8. リリースと復旧

本番配備時は検証済みStageと同じdigestを使い、API/Worker/Webのrevisionを追跡可能にする。DB migrationは後方互換に追加し、rollback時に新旧アプリから読み書きできる順序を定義する。新しい列・表は必要ならExpand/Contractで反映し、データ破壊を伴うdown migrationに依存しない。

障害時の順序：

1. eBay Feature Flagで新規検索と追加pageを止める。
2. 既存Yahoo/Aucfanの利用可否を確認し、必要ならAPI/Worker/Webを直前digestへ戻す。
3. 送信済みSoldgraph request ID、予算ledger、取得済みmarket結果を保持して照合する。緊急全停止時は未照合分をunknownのまま残す。
4. unknown/pendingの照合が終わるまで、同じ条件の新しい外部requestを作らない。
5. 原因、影響market、消費枠、復旧revisionを報告してから再開する。

Feature Flagは組織単位で限定できる構成を採用する。初回の有効化対象組織と、使用してよい実検索予算は実装レビュー時に確認し、設定を推測で拡大しない。

## 9. commit・デプロイの対象制御

- 対象は本ブランチのeBay変更と、この実装計画書だけ。
- 元worktreeの経費変更、作業時間・請求、LINE履歴、クライアント資料、実商品画像・実領収書、秘密情報はcommit対象にしない。
- 他branchのPRをmergeせず、リリース直前に`origin/main`とopen PR、migration連番を再確認する。
- 既存release script、PUBLIC GitHub preflight、digest pinning、固定Stage、本番監視・rollback gateを弱めない。
- コードのデプロイとFeature Flagの有効化を別操作として記録する。実API試験と契約上限の確認前はeBayを利用可能として案内しない。

## 10. 完了報告で分ける状態

| 状態 | 必要な証跡 |
|---|---|
| ローカル実装 | commit SHA、変更範囲、migration、fixture/DB/browser test結果 |
| Stage配備 | Build ID、image digest、API/Worker/Web revision、migration、認証・権限・既存機能の回帰結果 |
| 実API試験 | 承認されたmarket・枠上限、request ID、usage/credits照合、商品一致・欠損・速度結果 |
| 本番昇格 | Stage同一digest、production revision/readiness、flag対象組織、ログ・監視・停止・rollback確認 |
| 利用開始 | 本番ログインから検索・候補採否・確定・再読込までの実E2Eと、利用対象者の確認 |

これらを一つの「完了」にまとめず、実施した証跡がある段階だけを完了として報告する。

## 11. 全受入条件一覧

以下のT01〜T26は、関連要件v1.2の受入IDを省略せず実装・試験へ割り当てる一覧。CSV・円換算などの後続機能（T17）は初版のリリース必須範囲へ含めず、実装対象になった時点で検証する。T18は実API枠の承認後だけ実施する。

| ID | 検証する条件 |
|---|---|
| SG-T01 | 現行3入力経路・型番検索・Yahoo／オークファンを維持し、利用者に追加ログインを求めない |
| SG-T02 | 8市場のcountry、worldwide、recently_sold、count=200を検証。ukを使い、gb・未知・重複・raw parameterを拒否 |
| SG-T03 | 初回各市場1ページ。保存済みnext_pageのみ追加し、二重・並行操作で二重消費しない |
| SG-T04 | 202、HTTP 200のpending/complete/failed、Worker再起動、応答消失から同じ操作で復帰 |
| SG-T05 | 同じkeyの再送、409、結果不明、Job期限超過で自動的に別keyを発行しない |
| SG-T06 | 多言語の明示国、null、都市のみ、商品タイトル内の国名、所在地矛盾を分類。不明を理由に世界対象から除外せず、国を推定しない |
| SG-T07 | 型番違い、部品、セット、容量・地域仕様、状態粒度を確認し、手動採否の理由を保存 |
| SG-T08 | Best Offer true/null、価格レンジ、欠損、0、負数、不明通貨を主統計から除外 |
| SG-T09 | 0件、1〜4件、5件以上、偶数中央値、p25/p75、20%境界、IQR、decimalを期待値と照合 |
| SG-T10 | 市場別の候補集合から統計を再計算。Provider summary、異通貨平均、EUR市場混合なし。snapshot再読込一致 |
| SG-T11 | eBayに90日完了表示なし。取得sample、推定日付、coverage、条件差を表示 |
| SG-T12 | 自社cacheの再利用は外部呼出しなし。Provider cacheの課金、poll回数とcredits、市場別cache/keyを分離 |
| SG-T13 | rate、pending上限、quota、上流日次上限を区別。キー増殖、自動購入、直接scrape fallbackなし |
| SG-T14 | organization/branch scope外、system_admin本文参照、flag OFF、停止後追加取得をAPIで拒否 |
| SG-T15 | Chromium/WebKit、390px/PC、keyboard、戻る・再読込、axe serious/critical 0 |
| SG-T16 | キー、検索語、生応答のログ漏えいなし。固定host、redirect拒否、poll IDと商品リンクの検証 |
| SG-T17 | 後続CSVのsnapshot一致、数式注入対策、将来の為替換算で元価格・rateを保持（後続機能の受入） |
| SG-T18 | 別途承認された実API検索で応答根拠、候補品質、処理時間、creditsを記録（実枠承認後のみ） |
| SG-T19 | 同一出品IDの複数market観測を保持し、横断ユニーク件数は1。市場内矛盾と市場間通貨差を区別 |
| SG-T20 | 8市場中6成功・1失敗・1待機で成功分を保持し、全体完了と誤表示しない。部分確定・再開・再読込を確認 |
| SG-T21 | 初回8枠、市場別の追加1枠、合計20ページ・市場別10ページを検証。予算不足時の無断縮退なし |
| SG-T22 | 確認済み同一検索語を適用。無断翻訳・複数query・category流用をせず、市場ごとの状態差を明示 |
| SG-T23 | pendingのcredits=0を無料扱いしない。pollと保存再開後もrequest IDごとの消費は1回 |
| SG-T24 | failedかつcredits=0確認後の利用者再試行だけ新key。unknownでは再検索禁止。成功後の自社失敗でも消費記録を保持 |
| SG-T25 | rolling 30日、新旧Free枠、追加枠方針を混同しない。利用枠不明・照合差異で新規検索を止める |
| SG-T26 | 8/10/5/6枠、未確定1枠、月間試算、同時予約、上限超過を合成値で検証。自動購入なし |

## 12. 課金予算の追加判定

Soldgraphの公開仕様上、通常完了した市場1ページは通常1 credit。正常0件やProvider cacheも原則課金対象で、pendingは結果確定前でも1枠を予約する。Provider終端failedや受付拒否は応答のcreditsを確認して扱い、pollはcreditを消費しなくてもAPI rate limitには含める。アプリはcredit、HTTP call、USD請求、GCP費用を別々に記録する。

初回8市場は最大8枠、追加ページは1市場1枠を事前予約する。共有Provider accountについて検索開始前に自社上限を原子的に確認する。`used / remaining / window` がnull・古い・解釈不明なら0や無制限に読み替えず停止する。組織、利用者、検索ごとの予算上限と、購入済み追加枠の使用を許可するかは運用設定で制御する。機能からプラン変更・追加枠購入・超過課金を実行しない。

料金の公表値だけで契約プランを推定しない。実API試験では実アカウントのplan/usage/creditsを照合するが、ユーザーが明示した検索枠上限を越えない。現在保存されたローカルAPIキーはこの計画作成・合成テストでは使用しない。

公開料金の参考値（USD。契約済みプラン・税・追加枠残高は実アカウントで未確認）：

| 公開プラン | 公開料金 | 利用枠 | 8市場×各1ページの単純換算 |
|---|---:|---:|---:|
| 新規Free | $0 | 初回100枠 | 12回分＋4枠。毎月の枠ではない |
| Lite | $9/月 | 2,000枠 | 250回分 |
| Starter | $19/月 | 5,000枠 | 625回分 |
| Pro | $49/月 | 20,000枠 | 2,500回分 |
| Business | $149/月 | 100,000枠 | 12,500回分 |
| Scale | $499/月 | 350,000枠 | 43,750回分。契約画面で選択可否要確認 |

換算値は `floor(利用枠÷8)` であり、8検索すべて成功、追加ページなし、他用途の消費なしの場合だけの容量計算。月額料金はページごとの従量料金ではない。公開仕様では新規Free枠と既存Free枠の更新方式が異なり、有料枠はrolling 30 days。請求更新日や暦月に置き換えない。

追加枠の公開仕様はプランなしが1,000枠あたり$10・最小1,000枠、有料プランが1,000枠あたり$3・最小5,000枠。買い切り・期限なしとの記載でも、アプリからの自動購入を認めない。公開額を試算に使う場合は「契約額」や「検索ごとの課金」と誤認させず、実際のusage/請求との照合前に費用を確定表示しない。

API呼出し回数は課金枠と別にアカウント全体で60 calls/分。検索・poll・usage照会を合算し、複数利用者・組織で共有する。プラン別pending上限も全体で適用する。

| 公開プラン | 同時pending上限 |
|---|---:|
| Free | 10 |
| Lite | 15 |
| Starter | 25 |
| Pro | 50 |
| Business | 100 |
| Scale | 200 |

実アカウントのプランが未確認の間は同時数をプラン上限へ張り付けず、安全な設定値で制限する。60calls/分制御、pending制御、credits予算を個別のgateとして実装・監視する。失敗分類は `invalid_api_key/account_suspended`、`rate_limited`、`too_many_pending`、`quota_exceeded`、`upstream_daily_limit`、`idempotency_conflict`、`request_not_found`、`queue_full` を区別し、上流messageを画面や通常ログへ出さない。

## 13. デプロイ後の観測・復旧条件

- Web/API/WorkerそれぞれのCloud Run revision、image digest、source commit、Build ID、migration version、release IDを記録し、相互一致を確認する。
- StageでreadinessとGoogle認証、API scope、主要な既存業務を確認してから同じdigestを本番へ昇格する。Cloud SQLをpublic IPで公開しない。
- eBay検索Job、market別完了/失敗、pending経過、parser error、重複request ID、reserved/pending/charged/released/unknown件数、usage照合差を監視対象にする。検索語・price・生応答・キーは監視ラベルに入れない。
- Stage/本番でflag OFF時に新しいSoldgraph検索・追加pageが発生しないことを確認する。受理済みJobの限定pollは課金照合にのみ使い、緊急全停止ではpollも遮断してunknownを記録する。再開は未解決unknownが照合されてから。
- 本番昇格は段階的に行い、ERRORログ、readiness、既存Yahoo/Aucfanの利用、rollback digestを観測する。観測期間を既存のrelease script既定値から短縮しない。
- 問題時はeBay flagまたはWorker kill switchで新規取得を停止。既存検索結果とledgerを保持し、取得・課金状態を照合してから旧revisionへ戻す。DB migrationは後方互換を保ち、アプリrollbackだけで破壊されないことをStageで先に確かめる。

## 14. 画面別の操作・状態・保存境界

本節は工程Eの実装対象を具体化したもの。画面追加だけで完了とせず、API・DBへの保存と復元まで確認する。

| 画面 | 操作・表示 | 保存・復帰と拒否条件 |
|---|---|---|
| MP-01 商品入力 | 画像＋AI補助、手入力＋AI補助、手入力のみ、型番優先を維持 | 画像は既存商品同定経路だけへ渡す。Soldgraphへ送らない。未確認のAI提案から検索を開始しない |
| MP-02 条件確認 | 初期選択は8市場。市場名・通貨、worldwide、確認済み検索語1本、状態複数選択、任意の販売形式1つ、除外語を表示。初回最大8枠・最大1,600受信行を確認 | 対象市場と条件hashを保存し、予算を原子的に予約。不足時は開始を拒否する。無断でUSだけに縮小、自動翻訳、複数query追加をしない |
| MP-03 取得中 | 親検索と市場別の受付・待機・解析・完了・失敗、経過時間、ページ数を表示。偽の百分率なし | 再読込は同一検索・保存済み外部Jobへ復帰。成功市場を失わない。取消は未送信と送信済みを分け、送信済みの費用を無料と断定しない |
| MP-04 候補確認 | 市場切替、通貨、型番・部品・セット・地域仕様、状態、所在地不明／矛盾、年推定付き売却日、採否理由、重複市場を表示 | 商品単位の除外と市場観測単位の除外を区別。変更は楽観ロック付き。次ページはその市場の保存済みnext_pageだけを明示取得。他市場を同時取得しない |
| MP-05 結果 | 市場別の最低・中央値・最高・p25–p75・分布・採用数、横断ユニーク出品ID数、未取得市場、取得日時・sample範囲を表示 | 部分確定では未完了市場を確認してimmutable snapshotを保存。異通貨・異市場EURの混合集計なし。Best Offer等の必須除外を手動復帰させない |
| MP-06 履歴 | 条件・市場・ページ数・採用数・消費済み／未確定枠・確定結果を表示。条件編集・同条件再検索 | 保存済み結果の表示は外部通信なし。追加取得で確定snapshotを上書きしない。unknownの再検索を新keyで自動実行しない |

画面URLは既存 `/market-price` の枠組みを維持し、商品名、検索語、金額、APIキー、外部request IDをURLへ入れない。保存済み状態は自社APIを正本として復元する。入力本文や認証情報をブラウザの永続ストレージへ保存しない。戻る・進む・再読込で対象検索を維持する。

スマホは工程別1列、PCは既存ペイン構成を維持する。本文16px、補助13px以上、操作44px以上を基準にし、国旗や色だけで市場・状態を表さない。所在地は補足情報であり、購入者国・出品者国籍と表示しない。

## 15. API・Job接続と検証の割り当て

以下は実装契約の案。実装時に既存型との整合を確認し、確定した経路・DTOを文書へ反映する。APIの存在を実装済みと読み替えない。

| 経路・処理 | 実装する責任 | 対応する主な受入ID |
|---|---|---|
| 既存同定・確認 | 3入力経路・型番・AI採否を再利用し、確認済み検索語と商品条件を引き継ぐ | SG-T01、07、22 |
| options | eBay利用可否、8市場、許可状態・形式、この操作の予算状態を返す。APIキーや契約内部情報を返さない | SG-T02、13、14、25 |
| 検索作成 | 既存市場検索の認証・scopeを再利用。選択市場1〜8件・重複なし、条件hash、冪等キー、消費確認を検証。親検索・市場処理・予約を同一トランザクションで作成 | SG-T02〜05、21、23、26 |
| 詳細・履歴 | 市場別状態、取得sample、候補・統計・消費状態を保存値から返す。旧JPY90日DTOと外貨sampleを明確に区別 | SG-T10〜12、19、20 |
| 次ページ（追加API案） | `/api/v1/market-price/searches/:id/next-page`。選択市場、保存済みnext_page、expectedLockVersion、冪等キー、検索全体20・市場10ページ上限、予算を検証 | SG-T03、05、21、26 |
| 候補・外れ値変更 | 商品単位／観測単位を区別し、理由と版を保存。必須除外をAPIでも強制して採用集合から統計を再計算 | SG-T07〜10、19 |
| 確定・再表示 | 採用ID集合、各市場統計、未完了市場、coverage、version、確認者・時刻をsnapshot化。追加取得で改変しない | SG-T10、11、20 |
| 再試行・取消 | failedかつcredits=0の明示再試行だけ新世代。unknownは照合。未送信取消と受付済み結果回復を分離 | SG-T04、05、20、23、24 |
| Worker・Provider | 固定host・固定keyでsubmit/poll。市場別checkpoint、課金先行保存、parser、共通rate・pending制限、通常停止／緊急停止を接続 | SG-T04〜06、08、12〜14、16、23〜26 |

Jobは既存のキュー・認証context・再試行基盤を使い、eBay処理をYahoo/Aucfan処理と区別する。具体的Job種別は実装時に確定する。WebからSoldgraphを直接呼ばず、APIを任意URLやraw parameterのproxyにしない。本人・manager閲覧、他支店／他組織、system_admin、flag OFFを新規経路ごとに確認する。

## 16. 保存・削除・未確定事項と対象外

正規化した観測、候補採否、結果snapshot、外部操作・使用量台帳を役割別に保存する。生JSON全体、seller_text、画像コピー、APIキーを結果テーブルへ保存しない。response hashとparser/schema versionで処理根拠を追跡する。監査は操作・対象ID・版・hash中心とし、検索語・商品本文・価格をメタデータへ複製しない。

保持・削除は既存retention基盤との適合を確認する。検索結果の削除と、未解決pending/unknownの費用照合に必要な最小台帳の扱いを分ける。保持期間、第三者データの保存・再配布許諾、削除後の台帳保持範囲が未決なら、独自の期間や法令対応済み表示を作らない。有効化前に運用・利用条件を確認する。

| 未確定事項 | 未確定中の扱い・止まる操作 |
|---|---|
| 実API試験の商品・市場・上限枠・環境 | fixture実装は継続。実Soldgraph API・usage照会・実枠消費は行わない |
| 本番有効化組織・契約プラン・usageフィールドの意味 | コード配備はOFFで検証可能。実検索の有効化、予算を無制限扱いする操作は止める |
| usageの鮮度・照合閾値・組織／利用者予算 | 設定可能なgateと合成試験を実装。実運用値は推測で固定しない |
| 保存期間・再配布・削除後の課金台帳 | 最小保存の設計を進める。有効化前に確認し、画像配信・無条件の長期保存をしない |
| migration番号・並行PRとの衝突 | 作成・リリース前に最新mainと照合。旧migrationや他PRを無断変更しない |

初版対象外はCSV、検索プリセット、円換算、世界共通中央値、複数商品一括検索、定期取得、画像コピー配信、eBay直接スクレイピング、自動課金購入。履歴からの再検索と8市場の原通貨比較は初版に含む。後続機能を外したことを、初版必須条件の省略と混同しない。

本書は要件・仕様書v1.2の原文転載ではなく実行計画である。SG-R01〜R12の初版範囲とSG-T01〜T26の割り当てを保持し、後続・未承認・未実装を明示する。詳細な外部契約と原資料の出典は関連要件を併読し、実装変更時は両文書を同期する。

### 開発中のAPI分離（2026-10-09）

既存JPY検索の型・経路を壊さないため、eBay専用DTOは `/api/v1/market-price/ebay/searches` 配下へ接続している。現在は作成・一覧・詳細・next-page・confirm・cancel・candidates・outlier-policyを追加した。これは業務画面の新Route追加ではなく、既存 `/market-price` 内から呼ぶ取得元別のAPIである。UI接続・最終契約確認はまだ未完了。第15節の汎用next-page経路は初期案であり、現在の実装経路は `/api/v1/market-price/ebay/searches/:id/next-page` となる。

予算予約はaccount行をロックし、全組織の保持枠を検査する。現段階では運用者承認の保守的な累積上限を使用し、実usage残枠の意味やrolling windowを推測して上限をリセットしない。実接続前に台帳とusageの期間・消費・予約の照合を完成させる。合成fixture値を本番usage値として保存しない。

### 取消・再送応答の追加検証

- `POST .../:id/cancel` は本人／既存scope・機能フラグ・冪等キー・楽観ロックを検証する。未送信かつleaseなしのページだけを予約解放し、送信中・受付済み・結果不明の予約は保持する。確定済みsnapshotの取消は拒否する。
- Workerは取消後の未送信ページを送らず、受付済みrequest IDは通常停止規則の下でpollしてcreditsだけを確定する。取消後の候補公開を止め、緊急全停止はpollも遮断する。取消＝無料とは扱わない。
- 統合テストで未送信8市場の並行取消・同一応答・外部call 0件・追加ページ拒否を確認。1市場の受付済みpending→取消→poll完了ではsubmit 1回・poll 1回・charged 1枠・候補0件・cancelled維持を確認した。
- 初回と冪等再送で項目名が変わる不具合を修正し、eBayの詳細・履歴・確定応答をcamelCaseへ統一した。未確定creditsのページだけをaccountの同時pending制限へ数え、取消後に照合済みのページが次の検索を永久停止しないよう修正した。
- 今回の再実行は隔離PostgreSQLのDB 5件、API／Worker 9件、API／Worker typecheck、変更ファイルeslint、`git diff --check` が合格。UI・ブラウザ・全体回帰・実API・Stage・本番の合格ではない。

### Web初期接続の検証

既存optionsに任意の`ebay.enabled`を追加し、eBayフラグとサーバー側account設定がある場合だけ選択肢を表示する。予算予約の可否は検索作成APIが最終判定し、optionsの表示だけで残枠確認済みとは扱わない。既存source mode・JPY検索DTOは変更していない。

MP-02は8市場と原通貨、eBay固有の状態、販売形式、最大消費枠の明示確認を提供する。条件変更時は確認を解除する。検索開始応答を失った場合は同じリクエストとキーをメモリ内に保持し、同一操作を再送する。別条件の重ね送信は拒否する。再読込をまたぐ操作結果照会はまだ未実装であり、完了扱いにしない。

`source=ebay`を既存`/market-price`の非機密な取得元識別子として使用し、検索語・価格・キー・外部request IDはURLへ含めない。eBay検索IDを専用詳細APIから読み込み、市場別状態・最低／中央値／最高・採用数・消費確定枠・未確定枠を表示する。候補採否、確定snapshot表示、履歴、追加取得・取消の画面操作、戻る動線の完成は後続実装として残る。

Webの合成componentテスト13件で既存3入力経路・Yahoo/Aucfan・型番導線と、新規eBayの消費確認、条件変更、少数標本、外貨表示、失われた応答の同一キー再送を検証。Web production buildも合格。実ブラウザE2E・axe・390px画像・API/Workerと接続した画面実走は未実行。

### Web候補・結果・履歴の追加接続

続く更新でUIテストを18件へ拡張し、Web typecheck・変更ファイルeslint・production buildを再実行して合格した。前節の「後続実装」のうち、候補採否、確定snapshot表示、履歴、追加取得・取消の操作は画面接続済みとなった。ただし実API/DBとブラウザを一緒に動かしたE2E合格ではない。

- MP-04：市場選択、候補の市場単位採否、同一出品IDの全市場除外／解除、理由必須、外れ値基準変更、送料不明と0円の区別、所在地・年推定付き日付、検証済み出品リンクを表示。価格・根拠の必須除外は手動採用ボタンでも拒否する。
- 追加取得：対象市場のnext pageがある場合だけ最大1枠の明示確認を要求し、既存APIへ楽観ロック・固定キーで送る。取得後はprogressへ戻りpollを再開する。APIが検索全体・市場別上限を最終判定する。
- MP-05：最新の作業統計ではなく、保存されたimmutable snapshotの統計を表示する。確定版・確定日時・部分結果を明示し、snapshotなしなら未確定と表示する。
- MP-06：eBay専用履歴を既存Yahoo/Aucfan履歴と切り替え、保存検索IDで取得状況／候補／確定結果へ戻る。履歴表示で新規外部検索を送らない。
- 復旧：操作結果不明は同じキー・bodyをメモリ内に保持して再確認。保存成功後に表示取得だけ失敗した場合は表示だけ再取得し、保存を再送しない。再読込をまたぐ復旧、期限超過時の照会は未実装。
- 部分結果にpending市場が残る間はpollを継続し、partialを外部全市場完了と読み替えない。取消は送信済み費用が無料にならない旨を確認する。
- 残る確認：実ブラウザのキーボード・focus・390px/PC・axe、全操作のAPI/DB実走、途中再起動・競合・権限、条件編集再検索・cache・retry、最新main統合後の全体ゲート。

### 消費0枠確認後の明示再試行

`POST /api/v1/market-price/ebay/searches/:id/retry` を追加。対象market・pageNumber・expectedLockVersion・consumptionConfirmedを受け、そのページの最新attemptが外部終端failed、credits=0、released、request IDあり、leaseなしの場合だけ再開する。取消済み、unknown、pending、成功済み、未確認・不正な条件は拒否する。

検索parentをロックし、新attempt・固定操作key・最大1枠予約・Job/outboxを一つのトランザクションで作成する。同じ冪等キーの並行操作は同じ202応答へ収束し、新attemptを二重作成しない。過去の失敗・0枠の台帳は改変せず保持する。

UIは最新attemptの失敗・消費0枠のページだけに、最大1枠の確認と個別再試行を表示する。新attemptがあれば過去の失敗から重ねて再試行させない。再試行後はprogressへ戻りpollする。unknownには新しいキーの再試行ボタンを出さない。

隔離PostgreSQLでDB 5件、API／Worker 11件が合格。新たに、外部失敗0枠→同一キー並行再試行→attempt 2→合成Worker成功→外貨統計の再表示、成功後のretry拒否、応答不明からの新attempt拒否を実runtimeロールで確認した。UIテスト19件、Web/API typecheck、変更ファイルeslint、差分検査、API・Worker・Webの各buildも合格。全scope・期限超過・停止復帰・実ブラウザ・実APIの網羅合格ではない。

### 同条件の最新再取得

`POST /api/v1/market-price/ebay/searches/:id/repeat` に `mode=latest`、expectedLockVersion、consumptionConfirmedを送る。認可済み検索の保存条件から新しい親検索を作り、選択市場の1ページ目と最大消費枠を原子的に予約し、新規Job/outboxへ接続する。元の検索・候補採否・snapshot・lock versionは変更しない。手動採否は新しい候補集合へ無断コピーしない。

同一操作キーの並行送信は同じ検索IDへ収束する。前回のページに未確定creditsがあれば、新しい検索を作らず409で照合を求める。予算不足は新親検索・ページ・Jobをrollbackする。保存済み結果の閲覧は別の読取操作で、新規検索枠を消費しない。

UIは「同条件で最新を再取得」と、最大市場数分の新規枠確認を表示する。保存応答に含まれる新検索IDを確認してから取得状況へ遷移し、旧検索IDの画面へ新検索の操作対象を混ぜない。自社cacheを使わないlatest経路であり、cache再利用・条件編集経路はまだ未実装。

隔離DB 5件、API／Worker 12件、UI 20件が合格。latest再検索の同一キー並行送信、旧snapshot不変、旧version不変、新規最大1枠の合成Worker完了、予算不足rollback、未確認消費拒否、unknownからのrepeat拒否、UIの新検索IDへの遷移を検証した。実Soldgraph、実ブラウザE2E、全scopeを含む全体ゲートの合格ではない。

### ページ間の価格品質・状態矛盾の隔離

ドメイン集計とWorkerのDB統合で同じ`ebayObservationsConflict`判定を使用する。価格・状態グループだけでなく元状態、Best Offer、販売形式、必須除外理由の変化を検出し、同一市場・同一観測IDを`observation_conflict`として主集計から隔離する。除外理由の順序と既存conflictマーカーによる偽の矛盾は作らず、市場間の正常な外貨差も矛盾としない。

合成テストで同額の価格品質変更、状態・形式変更、除外順序、異市場通貨差を検証した。対象ドメイン2ファイル71件、隔離DB5件、API／Worker13件が合格。実runtimeロールで、初回snapshot確定→次ページの同じ出品のBest Offer変更→候補隔離、終端2枠の課金保持、過去snapshot不変を確認した。初回の追加統合テストはfixtureの次ページIDが異なり失敗したため、意図した同一IDへ合成fixtureを修正し、新しい隔離DBで全13件を再実行した。

API・Worker・ドメインのtypecheck、変更ファイルeslintと差分検査を実施。直前のWeb20件・API/Web buildも成功を確認した。これらは変更範囲の検証であり、全体品質ゲート・ブラウザ・実API・Stage・本番の合格を意味しない。

### 商品一致判定の初期接続

検索作成時に確認済みの検索語・型番を`product_basis_json`へ保存する。未公開・隔離DB専用の0067へ追加したもので、適用済みの旧migrationや本番DBは変更していない。同条件latest再検索には同じ商品根拠を引き継ぐが、候補採否は引き継がない。

決定的なtitle根拠から型番の完全一致（NFKC・区切り正規化）、部品・付属品のみ、想定外セット、容量、明示された地域version、eBay状態を評価し、`matched / mismatch / unknown`と理由・評価versionを返す。型番接頭辞の一致を完全一致にせず、所在地から地域仕様を補完しない。unknownも初期集計から外し、根拠確認を要求する。理由付き手動採用では商品判定自体を消さず、必須価格除外は突破させない。for_parts状態と「部品だけの商品」は同一視しない。

市場別API統計と確定snapshotに判定を含め、候補画面では日本語の説明と「同一性を保証するものではない」旨を表示する。判定対象は明示表記に限定し、未対応の言語・商品属性・曖昧なセット構成を実機確認済みと扱わない。世代・詳細地域仕様・多言語カテゴリ別の精度検証や英語検索語の補助は残る。

対象ドメイン86件、隔離DB5件、API／Worker14件、UI21件が合格。新規実runtimeロールの統合検証では、確認型番X1保存→候補X2の除外→理由付き手動採用→不一致根拠付きsnapshot再表示を確認した。API／Worker／Web／ドメインtypecheck、変更ファイルeslint、Web production build、差分検査も合格。実Soldgraph・実商品精度・実ブラウザ・全体ゲート・配備の合格ではない。

### 障害分類・Retry-After・共有アカウント停止

Providerの許可済みfailure classだけをcheckpointへ保存し、自由なerror messageや未知の分類値を複製しない。接続設定、quota、上流制限、冪等衝突、外部無効、応答契約異常はページをblockedへ移し、自動再送しない。rate／pending制限と通信不安定は同じキーの復帰対象とし、Retry-Afterを`retry_not_before`へ保存する。停止や照会エラーだけでは元の外部取得が無料と証明できないため、未確定枠を維持する。既にchargedのparse失敗を再照会中に制限された場合もcreditsを解放しない。

Workerはretry_not_beforeより前のページを送らず、Jobと再配信outboxのavailable_atも同時にその時刻以降へ設定する。共有アカウントのCONFIGURATION／QUOTA／UPSTREAM_LIMIT検出時はenabledからreconcile_onlyへ移し、他利用者の新規submitも止める。既に緊急停止の場合は弱めない。これは自動停止であり、自動の予算追加・プラン変更・再有効化ではない。

市場別画面へ日本語の停止・待機理由、未確定枠の注意、再確認可能時刻を追加した。運用者の問題解消後に、blockedページを同じ操作へ安全に復帰させる明示API／画面はまだ未実装。結果不明を新しい試行キーで再購入する経路は有効化していない。

上記「まだ未実装」はこの段階の履歴である。既存受付IDが保存されている場合の明示復帰は、以下の追加実装で対応した。受付ID不明や保持期限不明の復帰は引き続き自動化していない。

対象ドメイン97件、注入transport19件、隔離DB5件、API／Worker16件、UI22件が合格。実runtimeロールで600秒Retry-Afterのcheckpoint・Job・outbox保存、早期dispatchでも外部submitなし、待機解除後に同一キー成功、quota停止と未確定枠保持・共有account停止を確認した。API／Worker／Web／platformのtypecheck、変更ファイルeslint、Worker/Web build、差分検査も合格。最初の分類テストはcontractsのdistが更新前だったため失敗し、contractsをbuildした上で再実行した。外部APIへの実通信は行っていない。

### 停止解除後の保存済み外部受付の明示復帰

`POST /api/v1/market-price/ebay/searches/:id/resume`を追加した。対象市場・ページ・expectedLockVersion・resumeConfirmedを検証し、最新試行に既存request IDがあるblocked／parse_failed／unknownだけを再確認する。対象なし、scope外、取消済み、lease保持中、Retry-After待機中は拒否する。外部受付IDはDTOやURLへ公開せず、画面へは再確認候補を示すbooleanだけを返す。

組織フラグと共有アカウントのenabledをDBの専用gateで検証する。通常停止・緊急停止はAPIでも409で拒否し、利用者の操作からアカウント・予算を復旧しない。運用担当者による復旧後、同じページ・操作キー・外部ID・試行・消費台帳を保持したままJob/outboxを作成し、既存IDのpollで再開する。追加予約は0枠だが、元の未確定取得を無料とは案内しない。同一冪等キーの並行操作は同一Jobへ収束する。

画面は「保存済み取得を再確認」と明示確認を追加し、復帰後は取得状況のpollを再開する。IDがない結果不明にはこの操作を出さず、新しいキーの検索で置き換えない。外部保持期限切れ・request_not_foundの運用照合、reloadをまたぐ自社操作結果照会は残課題である。

この変更の検証：contracts／domain／platform／database build、API／Web typecheck、変更ファイルeslint、隔離DB5件、API／Worker17件、UI23件、Web production build、diff checkが合格。新規統合テストは1 submit→pending→設定停止→停止中拒否→運用復旧→並行resume→同一IDのpoll完了を確認し、ページ数・attempt・操作キー・credit状態を維持した。system_admin・他人のassessor拒否、待機時間の拒否、IDなしunknownの拒否も確認した。実API、実ブラウザ、全体品質ゲート、Stage・本番は未検証／未反映。

### 自社保存操作の結果照会・再読込後の復帰

`GET /api/v1/market-price/ebay/operations/:key?action=...`を追加した。許可したeBay操作だけを受け付け、既存48時間の冪等記録から組織・本人・成功応答を照会する。結果は状態・操作種別・自社検索IDだけで、保存応答本文・商品・候補・価格・外部IDを返さない。現在のsearch capability／scope、対象検索、両feature flagを確認し直す。別人の操作や期限切れ・未確認はunknownとし、未保存や無料を意味する状態へ変換しない。

同一キーで保存を再送した際のキャッシュ応答にも、eBay専用の現在認可確認を追加した。既存BackendServiceへ省略可能なreplay認可callbackを追加し、他業務の既存呼出しは変更していない。eBayでは対象検索と、repeat時の元検索も再認可する。フラグOFF・現在のscope外へ変わった場合、過去成功の応答を返さない。

既存検索の候補変更・外れ値・次ページ・再試行・再開・確定・取消・repeat操作について、操作キー、自社対象ID、操作種別、開始時刻だけをsessionStorageへ保持する。本文・価格・理由・検索語・tokenは保存しない。再読込後は結果照会から同じ保存済み対象を読み直し、repeatは新検索IDへ移動する。本文が残る同一画面内の明示再送だけ同じキー・同じ本文を使い、再読込で本文を失った場合は自動再送しない。保存成功後の表示取得失敗はGETだけ再実行する。期限超過、破損metadata、storage利用不可は新規保存を止め、運用確認を案内する。

本段階では初回検索作成画面のreload復帰はまだ未接続だった。以下の追加実装で初回作成にも接続したが、全操作の実ブラウザ確認完了とはしない。24時間cache、条件編集、Provider usage／予算期間、実ブラウザ・全体品質・実接続・配備ゲートも残る。

検証：新しい隔離DB5件、API／Worker18件、UI27件、API／Web typecheck、変更箇所eslint、API／Web production build、diff checkが合格。APIは本人のminimal結果、他人unknown、system_admin拒否、未知操作拒否、フラグOFF、現在の自己scope外、期限切れunknownと同一キー再送の再認可を確認した。UIは応答消失→metadataのみ保存→component再作成→結果照会→GET（追加mutationなし）、保存成功後GET失敗、同一キー明示再送、48時間超過、破損metadata、storage無効を確認した。componentテストは実ブラウザE2E／axeの代替ではなく、実外部APIの呼出し・commit・push・Stage／本番反映は行っていない。

### 初回eBay検索開始の結果照会・表示復帰

商品確認画面の初回eBay作成にも、同じ操作キーと最小metadataによる復帰を接続した。外部取得を伴う作成APIを呼ぶ前に、操作キー・商品特定ID・create種別・開始時刻だけをsessionStorageへ保存する。検索語・商品情報・価格・確認入力本文・tokenは保存しない。商品特定IDは作成前の照会対象であり、作成後は結果照会が返す認可済みの自社検索IDへ遷移する。

同じ画面内では同一キー・同一本文のみ再送でき、条件や商品入力を変えて前のキーを流用しない。再読込後は本文がないため結果照会だけを提供し、新しい検索を自動作成しない。期限切れ・結果不明・破損metadata・storage読取不能は新しい作成を止める。storage書込不能では作成APIを呼ばず、設定復旧後に同じ確認済み操作を再開する。

作成応答から自社検索IDを確認できた後に詳細GETが失敗した場合、そのIDをメモリに保持し、復帰時はGETだけを再実行する。冪等記録の48時間を超えても、既知の保存IDへの読取を新規購入と混同しない。詳細IDの不一致では遷移せず、結果確認を要求する。

検証：対象component 2ファイル31件、Web typecheck、変更ファイルeslint、Web production build、diff checkが合格。初回応答消失→component再作成→結果照会→保存対象GET、期限切れunknown保持、保存成功後GET失敗→GETだけ再開、一時保存失敗→作成なし→保存復旧後再開を確認した。API／DBの今回の再実行、実ブラウザ・axe、実外部API、Stage・本番の合格を意味しない。

### 取消後の確定拒否・追加取得の既存scope整合

取消済み検索は、過去の成功市場に採用候補が残っていても確定APIで409を返す。取消状態、版、既存候補、消費台帳を変更せず、新しいsnapshotも作らない。送信済みページの費用記録は取消によって無料化しない。

予算予約のDB gateは作成者本人だけの条件から、既存の有効membership・role assignment・market_price:search capabilityとorganization／branch／self scopeの照合へ修正した。API側の現在scope確認も維持し、管理者が権限内で査定員の検索へ明示的に次ページを追加できる。scope外、期限切れrole、非active membership、system_adminはこのgateで許可しない。新しい業務ロールや自動的な権限拡大は導入しない。0067は未公開の追加migrationとして、新規隔離DBへ適用した。適用済みmigration、本番DB・フラグは変更していない。

新しい隔離DBでstorage5件・API／Worker20件が合格。完了候補がある検索の取消→確定拒否→状態・版・候補・1枠保持、査定員作成→scope内管理者による1ページ追加→Worker完了、逆方向の本人scope外追加拒否とページ不増加を確認した。API typecheck・変更ファイルeslint・API production buildも合格。全支店／他組織の全組合せ、正式全体ゲート、実ブラウザ・外部API・配備は引き続き未完了である。

### 市場別の中心価格帯・採用価格分布・除外内訳

最終採用集合から最大5区間の価格histogramをdecimal整数演算で計算する。下限以上・上限未満、最終区間だけ上限を含む。全値同額は1区間、採用0件は空の分布とする。区間境界・件数・populationCount・採用集合hash・ebay-histogram-v1を統計へ含め、確定snapshotにも保存する。同一候補順序の違いでhashを変えず、理由付き復帰などで集合が変わればhashも変える。市場・通貨を混合しない。

結果と候補確認でp25〜p75、重複除去後件数、除外件数、採用価格分布の表、除外の主理由を表示する。主理由は候補を二重計上せず、各候補の複数根拠とは区別する。旧snapshotにhistogramがない場合は未記録と表示し、新しい候補から旧分布を捏造しない。分布がない0件も0円相場として表示しない。スマホは表を横にはみ出させない構成とし、実ブラウザ画像検証はまだ未実行。

検証：domain3ファイル99件、component3ファイル34件、隔離DB5件、API／Worker20件が合格。API統合で8市場の各5件分布の保存、確定snapshotとの一致、追加ページ後の過去分布不変を確認した。contracts／domain build、Web・API typecheck、変更ファイルeslint、Web production build、diff checkも合格。最初の極小額testは数値の指数表記がParserで不正として除外されたため失敗し、histogramの単位境界検証には正規化済みdecimal文字列fixtureを使用して再実行した。Parserの指数表記許容は拡大していない。

所在地判定率、販売形式比率、取得元比較、cache・usage・予算期間、条件編集、保持削除、全体品質と実ブラウザ、Stage・実接続・本番ゲートは引き続き残る。実API・消費枠利用・commit・push・デプロイは今回行っていない。

### 所在地判定率・販売形式の内訳

上記の所在地・形式の残課題のうち、市場内の判定率と比率を追加した。所在地の分母は取得後の重複除去件数で、採用件数ではない。明示国、不明、矛盾の内訳を保存し、0件はnullで算出対象なしとする。販売形式は最終採用件数を分母に、auction／fixed_price／unknownを分ける。形式不明も分母へ含め、都合よく既知形式だけの比率にしない。どちらも確定snapshotへ保存し、旧版に記録がない場合は未記録とする。

同じ市場・出品の別ページで所在地の国根拠が矛盾した場合、WorkerのDB統合とメモリ集計で共通のmergeEbayLocationを使ってconflictingへ移す。countryCodeはnullにし、特定国を推測しない。未知から明示国への更新は実際の取得根拠に限る。所在地矛盾は価格矛盾と区別し、所在地だけで正常価格を除外しない。出品所在地が販売市場・購入者国・配送先ではない旨を表示する。

検証：domain3ファイル101件、component3ファイル35件、隔離DB5件、API／Worker21件が合格。統合テストは初回6出品すべて明示US→1件が次ページでJP根拠へ変化→11ユニーク中10明示・1矛盾として保存、当該価格採用保持、2枠消費保持、過去snapshotの所在地判定率不変を確認した。Web／Worker／API typecheck、変更ファイルeslint、contracts／domain build、Web production build、diff checkも合格。横断ID単位の所在地品質、取得元比較、cache・usage・予算期間、条件編集、保持削除、全体品質・実ブラウザ・Stage・実接続・本番は残る。

### 初回市場ページの24時間自社キャッシュ

初回作成の既定はreuseとし、同一確認済みリクエストの市場別1ページ目を24時間以内の保存ページから再利用する。明示acquisitionMode=latestと既存repeat=latestは再利用せず新規取得する。検索語・状態・販売形式・市場・page・count固定契約、商品根拠、除外語、外れ値設定、Parser／処理version、組織と現在のread scopeを照合する。取消済み、処理未完了、期限切れ、将来日時、不明versionのページは再利用しない。統計・商品評価は現在の純粋関数で再計算し、前の手動採否・確定snapshotは引き継がない。

再利用ページは同一組織の元ページ参照・取得時刻・正規化結果・hashを保持する。元の外部request IDや課金を新しい検索へコピーせず、今回のページはcomplete／released／0枠とし、DTOはcacheHitとcollectedAtだけを表示する。ページ内重複・矛盾は共通評価処理で整形してから候補へ保存し、候補の一意制約を破らない。外部データの価格・所在地・必須除外は保持する。

3市場cache＋5市場未取得では5枠だけ予約・Job化する。8市場すべてcacheなら外部Job/outboxを作らずreadyとする。最大枠の事前確認は維持し、予算不足で市場を無断縮小しない。画面では自社保存結果・新規枠0・元取得時刻を表示し、最新取引を取得した結果ではないと案内する。Soldgraph側cacheの課金はこれとは別に保持する。

検証：新規隔離DB5件、API／Worker22件、component3ファイル36件が合格。実runtime roleで3cache＋5予約→外部call5回・確定5枠、全8cache→jobなし0枠、latest→8枠、25時間経過→8枠、旧processing version→再取得、assessor本人scope外→再利用0件を確認した。API／Worker／Web typecheck、変更ファイルeslint、contracts／domain／API build、Web production build、diff checkも合格。テスト用アカウント予算は合成シナリオ累積に合わせ1000枠へ設定し、別テストで0枠の予算拒否は維持している。実アカウント設定・消費は変更していない。

現段階の再利用対象は初回1ページ目である。明示次ページの自社cache、cache元参照を含む保持・削除、組織横断を含む全scope組合せ、usage・予算期間、条件編集、実ブラウザ・正式全体ゲート・実API・Stage／本番は残る。cache元参照があるため、削除設計では元ページだけを先に消す処理を行わない。

### 明示次ページのキャッシュ・取得方針の保持

上記は初回接続時の履歴であり、明示次ページにも同じreusePage照合処理を接続した。検索へacquisition_modeを保存し、初回reuseなら追加ページも再利用を許可する。latestと同条件latest再検索は追加ページもcacheを使わない。旧・内部作成の既定は保守的にlatestとし、利用者確認済み初回でだけreuseを明示保存する。

追加取得は保存済みnext_pageの対象市場だけを扱い、最大1枠の確認・20／10ページ上限・scope・楽観ロック・冪等性を維持する。初回と追加で組織、現在の閲覧scope、同一共有account、商品・除外・外れ値条件、リクエスト、24時間鮮度、Parser／処理versionを共通照合する。自分自身のページをcache元へ指定せず、連鎖cacheから取得時刻を更新しない。

cache成功時は追加予約と外部Jobなしでページ・候補・next_pageを保存し、作業中の統計を再計算する。ページ内重複と既存候補との価格・所在地矛盾は共通判定を使い、手動採否は保持する。既存snapshotは変更しない。cacheがない場合だけ既存の1枠予約・Jobを使う。scope内管理者の明示追加も同じ処理を通す。

隔離DB5件・API／Worker23件が合格。新規統合ではlatestの初回・2ページ目を各1枠取得→reuse検索の初回だけ0枠コピー→相場確定→同一キー並行の明示次ページが0枠・Jobなしへ収束→2ページ・12受信行・外部call0回、過去snapshot不変を確認した。cache候補が存在する同条件のlatest検索を追加し、初回・次ページとも外部1枠、cacheHitなしで完了することも再実行で確認した。API／Web typecheck・変更ファイルeslint・API／Web build、component3ファイル36件、diff checkも合格。課金期間・usage、保持削除、条件編集、全scope組合せ、実ブラウザ・正式全体ゲート・実API・配備は未完了である。

### 条件編集による新検索・再確認

既存repeat APIへmode=editedを追加し、検索語・市場・状態・販売形式・除外語・外れ値基準・reuse/latestを確認して新しい親検索を作成する。旧商品同定IDと確認済み型番を保持し、旧検索・採否・snapshot・lock versionを書き換えない。別商品の調査は商品入力へ戻る。単一検索語の正規化と市場・状態のcanonical orderは既存ドメインを使う。除外語は最大20語・各100文字を検証・正規化・重複除去し、自由記述本文は監査メタデータへ複製しない。

変更後も消費確認、現在のscope／flag、楽観ロック、前回unknown消費の拒否を維持する。同一キー並行再送は1検索へ収束し、同じキーで変更した条件を送ると409とする。reuseは共通cache照合で未再利用市場だけを予約し、全市場cacheなら0枠・Jobなし。latestはcacheを使わない。latestのみの従来リクエストに編集項目を混ぜることは禁止する。

結果・取得画面に折り畳みの条件編集を追加した。検索語・除外語・外れ値・取得方法・市場・状態・形式の変更で消費同意を解除する。入力本文はメモリのみで、既存操作キー復帰経路を使い、保存成功後の表示失敗では再購入しない。除外語を詳細DTOへ追加し、保存済み条件から初期表示する。React Lintで判明した復帰表示の同期effect更新・ref直接描画・操作オブジェクトの破壊的変更も修正し、品質規則の無効化は行っていない。

今回の最終再実行：新規隔離PostgreSQLのDB5件、API／Worker24件、Web component3ファイル37件が合格。編集新検索の並行冪等性、旧確定snapshotと型番の不変、未知条件の拒否、変更条件での同キー409、8市場cacheの0枠・Jobなし、画面の同意解除・新ID遷移を検証した。最初の追加テストはcanonical状態順の期待値不一致で失敗し、正規化仕様に合わせて期待値を訂正後に再実行した。API／Web typecheck、変更ファイルeslint、contracts／API／Web production build、diff checkも合格。全モノレポ正式ゲート、実ブラウザ・axe、課金期間・usage、保持削除、実API、Stage／本番は未完了。commit・push・外部API呼出し・本番変更は行っていない。

### 応答受信中の停止と、課金済み結果の非公開保持

外部応答後の候補公開トランザクションへ、Worker専用のsoldgraph_publication_allowedを追加した。同じ組織と現在のleaseを検証し、共有accountの実行modeと2機能flagをFOR SHAREで確認する。許可された公開トランザクション中のaccount／flag更新と直列化し、APIやPUBLICには関数実行権を付与しない。共有契約情報をDTOへ開示しない。

応答中にemergency_stop／reconcile_only／flag OFFになった場合、既に保存した外部request ID・確定credits・正規化結果を保持するが、候補へ反映せずページと市場runをblockedへ移す。未送信扱いへの巻き戻しや払い戻しの捏造はしない。設定復旧後の明示resumeでは、正規化結果と確定creditsが揃うページをcompleteへ戻し、保存済み結果から公開する。外部再購入・poll・新しいキー発行・新規枠予約は不要。結果が未保存の既存resumeは従来の同request ID照合を維持する。

今回の新規隔離DB再実行はDB5件・API／Worker25件が合格。3停止パターンで応答取得1回→候補0件・charged1枠保持→設定復旧・明示resume→候補保存・外部呼出し計1回・同キー／同request ID／1枠不変を実runtime roleで確認した。DBテストはWorkerだけの関数実行権、他組織・誤leaseの拒否、既定停止での公開拒否も確認した。API／Worker typecheck、変更ファイルeslint、API／Worker build、diff checkも合格。0067は未配備の作業migrationとして新しい隔離DBにのみ適用した。本番DB・実外部API・commit・push・配備は変更していない。実運用の停止検証、usageと期間別予算、保持削除、全体品質・実ブラウザ・Stage／本番は残る。

### 公式Usage契約と、外部未接続の照会アダプター

公開[Usage and billing](https://soldgraph.com/docs/api/usage)と[OpenAPI](https://soldgraph.com/openapi.json)を再読取し、Usageのrequiredフィールド（plan、used、limit、remaining、extra_requests、window、shared_allowance、rate_limit_per_minute）へ型・純粋Parserを対応させた。公開資料の照会だけで、認証付きusageや検索APIは実行していない。取得レスポンスの実アカウント適合は未確認である。

非負のsafe integer、limitとremainingのnull対応、remaining=max(limit-used,0)、one_time／rolling_30_days、shared_allowanceのbooleanを検証する。calendar monthやbilling renewalを枠更新と解釈せず、未知・欠損・不整合は固定エラーへ変換する。追加の自由記述フィールドは保存型へ写さない。購入済み追加枠は自社のallowExtraRequestsがtrueの場合だけ利用可能枠へ加え、null/unlimitedは運用方針未確認としてnullを保持する。通常枠と追加枠のsafe integer合計も検査する。

Providerへusage()を追加し、固定https://api.soldgraph.com/v1/usage・GET・Bearer headerのみ・redirect拒否・timeout／応答上限・sanitized errorを既存通信処理で共通化した。usageはHTTP200の正式スキーマだけを受け付け、202 pendingを結果として扱わない。明示allowExternalRequests=falseならキー設定済みでもtransportを呼ばない。APIキーの読取・実usage呼出しは行わず、既定Providerへの有効化もしていない。

合成検証はdomain4ファイル121件とProvider transport24件が合格。新規20件は新旧Free／有料rolling、追加枠許可、null、欠損、数値型・不整合・不正window・unsafe加算を扱い、transport追加5件はusage固定endpoint・権限OFF・欠損／pending／redirectの拒否を扱う。ambient fetchは各transportテストで呼出し0を確認した。contracts／domain／platform build、platform typecheck、変更ファイルeslint、diff checkが合格。DBのusage同期、Provider予約と自社予約の重複控除防止、期間別・組織別・利用者別予算、実アカウント照合、GCP配線、Stage／本番は未完了である。公式スキーマに明示されないpending内訳を推測して確定保存していない。

### 利用枠照合のDB接続と、二重控除防止

Workerへ明示実行用refreshSoldgraphUsageを追加した。起動時や利用者の通常取得操作から自動で実APIを呼ばない。worker_system専用のbegin／finish／fail関数を通し、60秒leaseでusage I/O中の新規予約・送信を制御する。HTTPはDBトランザクション外で実行する。usage呼出しも共有call台帳へ1回記録し、60 calls／分制御へ含める。緊急停止中は照会しない。

結果不明・受付済み未確定・現在lease中のページがある場合は、Provider残枠に含まれる予約内訳を推測せず照合開始を拒否する。未送信reservedは自社予約として保持する。成功時は公式Usageの検証済み値とサーバー照合時刻、同時点の自社累積chargedを保存する。次の予約判定では、自社の承認済み累積予算と、外部残枠から照合後の自社消費・未送信予約を差し引いた余裕を別々に検査する。外部残枠に既に反映されたchargedを再度控除しない。追加枠許可は既定falseで、照会結果に追加枠があるだけでは許可しない。

照合失敗・不整合・null/unlimitedでは残枠と照合時刻を未確認にし、enabledをreconcile_onlyへ移す。emergency_stopを弱めず、自動enabled復帰も行わない。lease所有者が違う後続の照合を消さない。照合値が15分超過・未来・欠損なら既存予約ゲートで新規取得を拒否する。外部の未確定枠を照合値から独自復元しない。

最終再実行は隔離DB5件、API／Worker26件が合格。照合中409・同時照合拒否、照合済み1枠を再控除せず残枠内の2市場予約成功・上限超過拒否、usage call台帳、追加1000枠の未許可、16分経過拒否、照会失敗時の不明化・通常停止、unknown存在時のusage外部呼出し0を検証した。DBで照合3関数はworker_systemだけに実行を許可し、API system／PUBLICは拒否と確認した。最初の隔離migrationはPL/pgSQLのCASE括弧不足で失敗し、修正後は新規DBでmigration・テストを再実行して合格した。Worker typecheck、変更ファイルeslint、Worker／API build、diff checkも合格。

未達：実契約アカウントの照合、外部・linked account由来の消費差異追跡、期間別自社予算と組織／利用者予算、GCPの明示実行経路・運用監視、保持削除、正式全体ゲート・実ブラウザ・Stage／本番。現在のcredit_budgetは引き続き保守的な自社累積上限であり、rolling期間予算の完成とは扱わない。実API、実アカウント設定、本番DB、commit／push／配備は変更していない。

### アカウント・組織・検索作成者の期間別予算

未配備0067へ運用設定専用soldgraph_budgetsを追加した。共有account、organization、検索作成者membershipの有効な3予算をすべて必要とし、欠損・期限切れ・超過なら新規予約を拒否する。累積、固定30日rolling、UTCまたはAsia/Tokyoの暦月を区別する。API／Workerの通常roleへ設定表の直接読取・更新権限を与えない。予算の設定や本番での有効化は行っていない。

課金が初めて確定したサーバー時刻charged_atを保存し、復帰や更新で変更しない。課金済みの値だけを期間境界で絞り、reserved／pending／unknownは期間を理由に解放しない。releasedは集計しない。従来credit_budgetの保守的累積上限と外部usage残枠ゲートも残す。利用者別の予算帰属は検索作成者であり、管理者が他人の検索へ追加取得しても帰属を移さない。別の課金帰属方式を承認済みと解釈しない。

並行する異なるキーの予約試験で、外部キーKEY SHAREとaccountのFOR UPDATEが競合し片側500になる問題を検出した。非キー更新のaccountロックをFOR NO KEY UPDATEへ変更し、予約・送信・usage照合の直列化を保ったまま競合を解消した。再検証で組織上限の最後の1枠へ同時予約した2操作が202／409に収束することを確認した。

最終再実行は新規隔離PostgreSQLのDB5件・API／Worker28件が合格。membership上限・期限切れ拒否、組織の並行上限、40日前の合成課金がrolling／月次では除外・累積では計上されること、未確定予約の枠保持を確認した。履歴時刻の構築は隔離DB所有者のテスト内だけで実施し、通常roleに時刻改変経路を追加していない。DBテストは初回課金時刻の改変拒否と予算表のAPI権限拒否も確認した。API typecheck、変更テストeslint、API／Worker build、diff checkも合格した。

未達：暦月・30日境界ちょうどの固定時計試験、全組織・作成者の予算帰属組合せ、実アカウントと外部消費の照合、本番用Provider・運用実行経路、保持削除、正式全体品質ゲート・実ブラウザ・Stage／本番。実API・本番DB・commit・push・配備は変更していない。これら局所試験をデプロイ完了とは扱わない。

### GCP Providerの明示接続と運用者用Usageコマンド

gcp／local-connectedのProvider構築へ、設定済みSoldgraphアダプターを接続した。SOLDGRAPH_ALLOW_EXTERNAL_REQUESTSの既定は未設定＝OFFで、falseの場合もアダプターを設定せず、キーを参照しない。true以外の曖昧な指定は拒否する。true時はSOLDGRAPH_ACCOUNT_IDのUUIDとSOLDGRAPH_API_KEYを必須検証し、欠損時にfixtureや他取得元へfallbackしない。local-connectedのlocal由来Soldgraph fixtureも明示的に上書きして除外する。アダプター構築自体はusage／検索／pollを実行しない。通常APIに秘密キーを配置する必要はなく、実通信の許可とSecret Managerのキー注入はWorker側に限定する配備方針とする（GCP設定はまだ変更していない）。

運用者用にビルド済みWorkerの `pnpm --filter @hanamaru/worker soldgraph:usage` を追加した。実行には上記の通信許可に加えSOLDGRAPH_USAGE_REFRESH_ENABLED=true、PROVIDER_MODE=gcpまたはlocal-connected、DATABASE_URL、DATABASE_CONTEXT_ROLE=hanamaru_worker、DATABASE_SYSTEM_ROLE=hanamaru_worker_systemをすべて要求する。未承認の通常起動・画面操作からは実行しない。独立したDB接続をworker／worker_system roleで使用し、既存のusage lease・共有call台帳・会計検査を通す。失敗時の自動再試行・自動enabled復帰はなく、DB接続を閉じる。CLI出力は完了または固定の失敗案内だけで、provider例外・キー・URL・契約内容を出力しない。

局所再実行：Platform4ファイル41件、Worker2ファイル11件が合格。通信OFFで秘密値を読まないこと、不正設定の起動拒否、構築時I/Oなし、運用コマンドの許可不足ではProvider／DB／照会を一切呼ばないこと、明示照会1回と成功・失敗時の接続解放を検証した。Platform／Worker／API typecheck、変更ファイルeslint、Platform／Worker build、diff checkが合格した。初回型検査ではexactOptionalPropertyTypesと明示undefinedが不整合となり、接続型を修正して再実行した。

未達：Cloud Run上のsecret・account対応、Cloud Run Jobまたは承認済み運用実行環境からのコマンド実行、実usage照合、組織フラグ・DB実行mode・通信許可を組み合わせたStage runtime検証、運用監視・保持削除・正式全体ゲート・実ブラウザ・本番。現時点のCLIは実行しておらず、テストは注入モックのみ。実API枠消費の承認がないため、キーを読み出して照会していない。commit・push・配備も未実施である。

### ブラウザからDBまでの合成8市場E2E

offline起動へ、破棄するローカルDBと匿名組織だけのeBayフラグ・合成account・3階層予算を追加した。外部通信はfalseのままで、localの合成Providerを使う。実キー・本番設定は読み込んでいない。通常local:upの利用者確認環境はまだ同変更を接続していない。

初回はmigration後の匿名組織作成によりフラグUPDATEが0件となり、eBay選択肢待ちで2ブラウザとも失敗した。匿名組織への明示INSERTへ修正した。2回目は合成accountのusage_window_json不足を安全ゲートが409で拒否し失敗した。合成データに必要な照会状態を追加し、APIの安全判定を弱めず再実行した。

最終証跡 `.artifacts/offline-e2e/20261009T105924Z/` はChromium／WebKitの2件合格。手入力→検索条件確認→最大8枠の明示確認→8市場取得→候補確認→相場確定→再読込で確定版1を保持した。USD／GBP／CAD／AUD／EURを市場別表示し、390／1440pxで横はみ出しなし・axe serious／critical 0・pageerror 0を検証し、4画像を生成した。これは対象を絞ったfixture試験であり、全21画面・正式85画像・実Google認証・Soldgraph実接続・本番の合格ではない。画像は8市場の長い全ページ証跡で、詳細な視覚レビューは引き続き必要である。

全体lintで検出された商品確認画面の復帰effect内同期setStateを、アンマウント保護付きの非同期反映へ修正した。全体lintと画面部品3ファイル37件が合格し、offlineのpackages／API／Worker／Web production buildも成功した。現時点の証跡gitShaは親HEADの6f3fb24で、未コミット作業treeを実行している。コミット単体の合格とは扱わない。以後のresult.jsonへworkingTreeDirtyを追加して区別する。

全体typecheck（各workspaceとtypecheck:scripts）も最終再実行で合格した。

未達：全体unit・全DB／role・security／docs／全offline回帰、保存失敗復帰のブラウザ試験、追加ページ・条件編集・全scopeブラウザ試験、詳細画像確認、保持削除・運用監視、実API・Stage／本番。commit・push・配備はまだ行っていない。

### 通信断復帰・追加取得・条件編集と全体テスト

同じ合成ブラウザシナリオを拡張し、米国の次ページを明示同意後に追加（計9枠）→候補確認→確定のAPI応答受信を意図的に切断→再読込→保存操作結果の照会→確定版1の表示へ復帰することを検証した。確定POSTは1回だけで、復帰後もsnapshotは1件。条件編集は消費同意が解除され、新しい検索IDへ遷移して8市場を取得し、旧検索はconfirmed・snapshot1件のまま保持された。最初の故障注入試験ではsnapshot作成の正式応答201を200と誤期待して失敗し、API契約を確認して期待値を訂正後、再実行した。

最終合成E2E証跡 `.artifacts/offline-e2e/20261009T110735Z/` はChromium／WebKitの2件合格、4画像、390／1440pxの横はみ出しなし・axe serious／critical 0・pageerror 0。result.jsonにworkingTreeDirty=trueを記録し、親commitそのものの試験と区別する。

`pnpm test` はDomain137件、DB非接続4件、Web222件、Platform82件、Worker27件、API23件、計495件が合格。DB接続が必要な107件のskipは合格に含めない。release guardも全ケース成功した。続く `pnpm test:db` は共有seed組織のフラグをAPI試験ファイルが並行操作してeBay23件が404で失敗する干渉を検出した。共有DBを使うAPI試験ファイルを直列化（ファイル内の並行予約・冪等性試験は維持）した後に、破棄する新規DBへ全migrationを適用し再実行した。DB統合26件・Worker31件・API100件がすべて合格し、API／Worker buildと両readinessも成功した。ログはローカル `/tmp/hanamaru-ebay-db-full-rerun.log` に保持し、Gitへ含めない。

`pnpm test:db:roles` も成功し、SCRAM認証された別API／Worker loginのNOINHERIT・NOBYPASSRLS境界を確認した。これは既存runtime roleゲートであり、全eBay権限組合せの操作合格数とは別に扱う。

未達：正式全offline回帰と全scopeのブラウザ確認、security／docs／infra、詳細画像確認、保持削除・運用監視・実アカウント照合・Stage／本番。認証付き実API・本番DB・commit・push・配備は未実施。

### 全21画面回帰・運用異常の解消確認

合成の全offline回帰 `.artifacts/offline-e2e/20261009T110946Z/` はChromium／WebKit計31件合格、1件意図的skip（WebKitでの重複画像取得）となった。21画面、8幅の横はみ出し検査、axe、PDF・音声・振り返り、既存Yahoo／オークファン、経費、eBayの追加取得・確定時通信断復帰・条件編集を含む。85画像を生成した。画像の生成数と詳細な視覚レビュー完了は同一ではない。8市場を縦に表示するeBay全文画像は長く、全画像の可読性・構図の確認は残る。gitShaは親6f3fb24、workingTreeDirty=trueであり、commit単体の合格ではない。また、この実行は以下の最新商品判定・監視変更をすべて含む最終tree回帰ではない。

未確定課金・Parser失敗・blockedを本文なしで監視できるworker_system専用のSECURITY DEFINER関数を0067へ追加した。組織・membership・Job ID、failure class、severity、attempt、maxAttempts、ageだけを返す。最新Jobと各市場ページの最新試行を使用し、古い失敗が正常復帰後も警報を残さない。API system／PUBLICの実行を拒否し、Worker systemへ商品テーブルの直接SELECT権限を追加しない。既存MARKET_PRICE_BLOCKED／STALLEDのCloud Loggingフィルターを再利用する。未知課金から重大警報を作成し、隔離DBで外部確認済みの解消状態を模擬した後に警報を解消する試験が合格した。模擬解消はDB所有者のfixture操作であり、未知課金を自動解放する業務APIではない。

監視追加後の新規隔離DBの全ゲートはDB26件・Worker31件・API100件合格、両readiness成功（`/tmp/hanamaru-ebay-db-monitor.log`）。文書契約検査は21画面・189状態・error0。Terraformの固定Google Provider7.43.0をbackend接続なしで取得した後、fmt／validate／runtime contractが合格した。Secret検査の初回は不正URLを拒否するfixtureを非匿名メールと誤検知した。URLのusername/passwordを合成文字列から構築する同等の拒否試験へ直し、検査を弱めず再実行した。362ファイルのSecret／非匿名メールfinding0、該当domain61件合格。

### Worker限定Secret・明示配備設定

TerraformへSoldgraph専用設定を追加した。secret作成とruntime通信は別々の既定false。secret containerだけを作成でき、キー値やSecret versionはTerraformで生成・保存しない。実通信ONには作成許可、内部account UUID、承認済みnumeric secret versionをすべて要求する。latestの指定を拒否する。Secret Manager権限とキー注入はWorkerだけ。APIは予算予約に必要な同じ非秘密account IDのみを受け、キー・外部通信許可を受けない。Web buildにも注入しない。共有account IDだけをWorkerに設定してAPIを欠落させる構成を防ぐ。

Google ProviderをmockしたTerraform plan試験4件が合格した（`/tmp/hanamaru-ebay-terraform-mock.log`）：既定OFFでsecret／grantなし、必要設定なしの有効化拒否、Workerの固定secret版とAPIの共有account binding、latest拒否。初回は既存tfvars.exampleのGoogleキーplaceholderが形式検査に失敗したため、mock専用の架空形式値へ上書きして再実行した。GCP API、backend、実キー、applyには接続していない。実Secret配置・IAM readback・有効化・運用Usageの実行は未実施。

### 世代判定と最新ローカル再検証

商品判定1.1.0は、Mark／Mk／gen等の明示世代表記（数字・Roman numeral）と一部の欧州言語、日本語の「第N世代」を正規化する。異なる世代はmismatch、必要な世代が読めない場合はunknown、商品側で未確認の世代を候補側が示す場合もunknownとする。単なる数字・出品国から世代を推測しない。これは限定辞書による決定的検査であり、英語検索語のAI生成や全言語対応の完了ではない。cache processing versionへ商品判定versionを含め、旧判定のcacheを再採用しない。

domainの局所84件、typecheck、変更TS lintは合格。最新全体lint／typecheck／unitも成功し、unitは503件合格・107件DB接続待ちskip。DB接続は別ゲートで検証する。商品判定version変更後の全DB試験は、API1件が旧version1.0.0の固定期待値により失敗（99件合格）した。正式1.1.0の期待値へ同期し、新規DBで再実行した結果、DB26件・Worker31件・API100件、API／Worker buildとreadinessがすべて合格した（`/tmp/hanamaru-ebay-current-db-rerun.log`）。初回失敗は最終合格と分けて記録する。修正後のsecurity／docs／infra静的ゲートは成功している。

### 配備の読取確認と、公開前の残条件

2026-10-09のGCP読み取りではWeb `hanamaru-pilot-web-00156-ref`、API `hanamaru-pilot-api-00261-zet`、Worker `hanamaru-pilot-worker-00137-vot` のlatestReadyRevisionとtemplateラベルを確認した。3サービスともsource-commit `6f3fb24afa2027afe3b61f9525157c8dcb03a2c5`、Build `10d8ef56-4ded-4840-b7e6-522b31f3fa85`、migration0066。Workerの通常traffic100%も同Revisionだった。Web／APIの通常traffic・実image digestとBuildの完全照合はまだ別途必要であり、latestReadyだけを通常配備の証明にしない。eBay0067の配備済み証拠はない。origin/mainの読取も6f3fb24、PR31などの並行変更は未取込。原本worktreeの経費未コミット変更・未追跡資料は保持している。

本番反映前に残る事項：保持期間の明示決定と削除／課金台帳保持設計、運用実行環境からのUsage照合、外部APIの使用枠承認と少数実接続、英語AI支援と比較表示の要件対応、最新treeでの最終全ゲートと視覚確認、eBayのみのSecret／PII／履歴検査、承認済みcommit／push、固定Stageの認証・実API・scope・rollback・同digest昇格、配備後のRevision／digest／Build／commit照合。回答待ちの保持期間・実API消費を推測で有効化しない。今回も実API、キー読取、本番DB変更、commit／push／配備は行っていない。

### 英語検索語の任意AI補助・保存結果の参考比較

SG-R02の英語補助を、商品同定の既存API・Job・Workerへ接続した。MP-01のAI補助経路で利用者が明示選択したときだけ、英語検索語候補を要求する。日本語の利用者入力は上書きせず、候補は未確認として保存する。eBayフラグをAPI受付時とWorker開始時に再確認する。候補は最大3件、英語表記と提供された型番の保持を決定的に検査し、R6とR60／R6IIを同一視しない。容量・付属品などはプロンプトと利用者確認による補助であり、完全な属性一致を保証する検査ではない。AIはeBayアクセス・価格生成・市場別の追加検索を行わない。英語のprompt_versionは2、日本語・旧Jobは1とする。

SG-R12の比較は保存済み確定結果の読み取りに限定した。利用者が国内結果を選択し、商品入力・型番・構成・状態・期間・通貨の違いを確認してから金額を表示する。JPYと各市場の原通貨統計を分け、為替換算・混合中央値・価格差率・利益は算出しない。異なる商品同定IDは同一商品と断定しない。再取得時に未確定になった国内結果は拒否し、別結果へ自動切替しない。比較対象の保存・有料検索・新たな外部通信は実装していない。

ローカル再検証：英語候補の単体11件、Webの入力経路16件、比較表示3件が合格。新規隔離DBの全ゲートはDB26件・Worker31件・API102件合格、build／readinessも成功（`/tmp/hanamaru-ebay-english-db-rerun.log`）。初回のAPI試験では不正入力の既存422を400と期待したため1件失敗し、期待値を既存契約へ修正して再実行した。比較のテストデータでも存在しないplanプロパティを型検査が検出し、正式DTOへ修正した。修正後の全体lint・typecheck・unitは成功、unit519件合格・109件DB依存skip。skipは合格扱いせず、別のDBゲートで検証する。securityは368ファイルのfinding0、文書契約は21画面・189状態・error0。ブラウザ再検証は別途記録する。

保持削除、実API消費承認・実接続、運用照合、最終全画面回帰、Stage／本番は引き続き未完了。この局所進捗を配備完了と扱わない。

### 追加ブラウザゲートの結果（公開不可）

eBay対象の最新production buildと合成Providerによる実ブラウザ試験は、Chromiumの2シナリオが合格した。英語補助の明示送信、原入力保持、有料検索を始めないこと、8市場取得、1市場追加取得、確定後の通信断・再読込復帰、比較結果読取導線、条件編集、390／1440pxの横はみ出しとaxe serious／critical 0を検証した。比較価格の条件確認・通貨分離は前記component3件の検証であり、今回のブラウザでは国内確定結果との価格比較完走を確認していない。

WebKitは初回30秒のviewport操作タイムアウト、90秒再試行のnavigation終了を検出した。初期viewport付き独立contextへ変更して再実行しても `/market-price` のload待ちで90秒タイムアウトした。最終実行 `.artifacts/offline-e2e/20261009T114235Z/` は2件合格・1件失敗・1件未実行であり、WebKit合格や全ブラウザ合格と扱わない。原因は未特定で、アプリ不具合／実行環境のどちらとも断定しない。fail時に残したtraceを次の調査へ使用する。

Terraform fmt／validate／runtime契約、別loginによるDB role境界は成功。最終テスト変更後の対象eslint・全typecheck・diff checkも成功。Next buildが追加した検証専用dist pathと整形差分だけを元へ戻し、通常Web設定に検証用変更を残していない。origin/mainは6f3fb24でPR31は未取込。本番への昇格は保留し、キー読取・実API・commit・push・本番DB・配備を行っていない。

### WebKit切り分け・予算境界・JSON再生成の補完

アプリと無関係の一時HTTPサーバー（127.0.0.1、合成HTMLのみ）を起動し、同じPlaywrightのChromium／WebKitで読取を比較した。Chromiumはtitle取得成功、WebKitは15秒のローカルnavigationに失敗した。サーバーとブラウザは試験後に停止した。この証拠はeBay固有でないローカル読込問題の再現を示すが、OS・ネットワーク・ブラウザ内部の根本原因を特定していない。WebKit公開ゲートは未合格のまま維持する。

隔離DBへ予算境界試験3件を追加した。単一トランザクションのnow()を固定し、rolling 30日／UTC月初／Asia/Tokyo月初の直前1マイクロ秒・一致・直後1マイクロ秒を実際のassert_soldgraph_reservationで検証する。境界一致を含めて課金を計上し、1年前のunknownも期間外として解放せず枠を保持する。fixtureの履歴時刻設定だけを隔離DB所有者で行い、ゲートはhanamaru_api roleで実行する。初回はseedにeBay flag行がなくSOLDGRAPH_DISABLEDで3件失敗したため、rollbackされる試験トランザクション内に明示的な合成flagを作成して再実行した。本番のflag既定値は変更していない。全DB再実行はDB29件・Worker31件・API102件合格、API／Worker build・readiness成功（`/tmp/hanamaru-ebay-boundary-db-rerun.log`）。

Vertex商品同定の再生成では、項目不正だけでなくinvalid JSON／非object出力も1回だけ修復対象にした。2回目の不正は失敗として返し、503などの通信エラーをschema修復として再呼出ししない。実SDK境界をmockした6件が合格。初回テストhookが返したmockをVitestがcleanupとして実行して1件失敗したが、hookをvoidに修正して再実行した。実Google・Soldgraph・キーには接続していない。

最新全体lint・typecheck・unit・security・docsは成功。unit525件合格、112件DB依存skipは別ゲート扱い。カスタムNext検証distがeslint対象へ入り生成コードを検査した失敗は、生成物を既存のignored `.next/ebay-resume-evidence-20261009/` へ移動して再実行し解消した。lintルールは弱めず、生成物も削除していない。保持削除・実使用量照合・実接続・WebKit・最新全21画面回帰・Stage／本番は未完了で、配備完了ではない。

### 承認済み保持方針・eBay本文削除と最小課金アンカー

保存期間を推測で固定しないため、組織単位の`ebay_retention_policies`を追加した。日数・承認日時・承認者の製品membershipを保持し、migrationでは本番の設定行を作らない。通常API／Worker／system roleには設定表の読取・更新権限を与えず、APIは現在組織の設定有無だけを専用関数で検査する。承認済み設定がなければ初回・再検索・次ページ（cacheを使う場合も）を拒否する。課金予約のDB関数でも設定を確認する。未来の承認日時は有効な設定と扱わない。1〜3650日は設定型の技術的許容範囲であり、実際の保存期間の合意ではない。隔離fixtureの90日は本番既定値ではない。

既存`retention_scan`へ、組織別・最大100検索ずつの本文削除を接続した。保存期間は検索作成時刻からの固定日数で計算し、参照・更新だけで延長しない。期限超過した終端検索について、検索語・商品判定根拠・除外語・候補・手動採否理由・統計snapshot・正規化応答・request本文・API replay bodyを物理削除または空の値へ置換する。履歴から除外し、直接GET・更新・再送による復元を拒否する。処理中Job／有効page leaseがある検索は今回batchで削除せず次回へ送る。cache元ページのidentity anchorは残し、他の保存結果の外部キーを壊さない。本文削除済みpageはcache再利用対象にならない。

課金・予算の正本は本文と分ける。組織・作成者・account・検索／page ID・hash・市場／page番号・credit state・credits・初回課金日時・未知受付のrequest ID等、予算と照合に必要な最小アンカーを残す。purgeを課金取消・枠返却として扱わず、chargedの値・時刻は保持し、unknownも解決したとみなさない。最小課金台帳の将来の保持期限・集計アーカイブ・運用照合手順は別途合意が必要であり、法令対応済みとは表示しない。共有の商品同定レコードとその画像は既存機能の正本・削除基盤に属し、今回のeBay本文purgeで他取得元が参照する共有レコードを削除しない。

purgeはWorker-system専用のSECURITY DEFINER関数に限定し、APIにsnapshotの自由なDELETE権限を追加しない。既存の最小権限境界を維持する。削除件数だけを既存監査へ記録し、本文を監査へ複製しない。本文削除後も未知課金の運用警報は維持し、解決済みpageはpurged状態として新たなblocked警報を発生させない。

新規隔離DBの全ゲート（`/tmp/hanamaru-ebay-retention-replay-db.log`）はDB29件・Worker31件・API104件合格、API／Worker build・readiness成功。設定なしの新規検索拒否／purge未実行、期限超過した確定結果と未知課金の本文削除、実retention Jobによる実行と件数監査、二回目のpurgeが0件、replay bodyの空値化とsnapshot削除、APIの直接URL404と履歴非表示、課金値・日時不変、request ID・unknown保持、active Jobの削除回避、API purge権限拒否、解決済みと未解決の警報分離を確認した。実人物・実画像・実API・本番設定には接続していない。

冪等キーを本文と一緒に削除すると、同じ保存操作が新しい課金検索として再登録される危険がある。そのため既存48時間の保持期限まではキー・request hash・対象ID・期限の最小tombstoneを残し、応答本文だけを空にする。削除済み対象は再送時にも現在認可と存在検査を行って404とし、空の成功応答や新規検索を返さない。同一キー・同一payloadの再送拒否を隔離APIテストで確認した。48時間経過後に古い操作を自動再送しない既存UIの不明状態ガードは維持する。

全体unitは525件合格・114件DB依存skip（別DBゲート）、lint・typecheck・security・docsも検証した。最新の保持ガードを含むWebブラウザ回帰、実運用での保持方針承認・管理照会、最小課金台帳の運用合意、実API枠承認・接続・Usage照合、WebKit復旧、最終全画面回帰、Stage／本番は未完了。今回はcommit／push／本番DB変更／デプロイを行っていない。

### 保持設定の取得経路別回帰とブラウザ環境の切り分け

追加回帰（`/tmp/hanamaru-ebay-retention-acquisition-db-rerun.log`）もDB29件・Worker31件・API104件が合格した。承認済み保持設定を除去すると、初回だけでなくcache利用の新規検索・再検索・次ページも409で拒否され、保存済み検索の読取は継続できる。最初の追加テストでは再検索mode指定不足により400となったため、正しい`latest`入力へ修正して全DBゲートを再実行した。製品の拒否条件は変更していない。

WebKit v2336はアプリを含まない`data:`ページ、localhostと127.0.0.1の合成HTTPページで各10秒のnavigation timeoutになった。同じ3ページはChromiumで成功した。WebKitのheadfulでも`data:`ページは失敗した。これはeBayアプリ固有とは限らない検証ランタイム障害の証拠であり、アプリのWebKit合格を意味しない。既存cacheを変更せず同じrevisionを別ディレクトリへ導入して追加切り分けを行う。ブラウザゲートの省略・timeout延長による合格扱いはしない。

同revisionのクリーン導入先`/tmp/hanamaru-webkit-clean.S8DEgj/`でも`data:`ページのnavigationが10秒でtimeoutとなり、既存cacheだけの破損とは断定できない。ブラウザは各試験後に閉じた。WebKitの根本原因と最新treeの正式ブラウザ合格は未確定で、別browserによる代替合格として扱わない。導入は[Playwrightの公式ブラウザ導入手順](https://playwright.dev/docs/browsers)に従い、同じlock済みPlaywright／WebKit revisionを利用した。共有の既存browser cacheや依存lockは変更していない。

取得経路別テスト追加後の全lint・typecheck・unitは成功（`/tmp/hanamaru-ebay-acquisition-{lint,typecheck,unit}.log`）。unit525件合格・114件DB依存skip、別隔離DBゲートは上記164件合格。最初の検査コマンドでは存在しない`security:scan`名を指定したため、そのコマンドだけ終了1となった。正式な`test:security`を再実行し369ファイルの秘密値・非匿名メール検出0件、`docs:validate`は21画面／189状態契約のerror0、`git diff --check`も成功した。WebKit・実API・保持期間承認・Stage／本番は未完了のままである。

### 保存方針取り消し後の送信・公開フェンス

検索予約時だけの保持設定確認では、予約後に方針を取り消してもキュー済みの外部送信を止められない。そのため`admit_soldgraph_call`でも保持設定と本文削除状態を再確認する。承認がない場合は新規submitを止め、受理済みrequest IDの課金照合だけを既存reconcile-only制約で扱う。未送信の予約枠を自動返却したり、未知課金を無料確定したりしない。最後の候補公開関数も保持設定を共有ロックで再確認し、取消中に取得が完了しても課金台帳を消さず候補公開を拒否する。

キュー投入後に方針を取り消す合成試験は、検索がblockedとなり外部call台帳0件・request IDなし・予約枠維持を確認した（`/tmp/hanamaru-ebay-retention-dispatch-db.log`、DB29／Worker31／API105件合格）。取得中の取消に対する公開フェンスの追加試験は別に実行し、結果を以下へ記録する。

追加試験を含む最新隔離DBゲート（`/tmp/hanamaru-ebay-retention-publication-db.log`）はDB29件・Worker31件・API106件合格、API／Worker build・readiness成功。合成Providerの取得中に保持設定を除去すると、charged 1枠とcharged_atを保持し、pageはblocked、候補は0件となる。外部サービス・実キー・本番DBを使用していない。最新lint・typecheck・secret scanも成功（`/tmp/hanamaru-ebay-dispatch-{lint,typecheck,security}.log`）。

追加試験後の全unitも525件合格・116件DB依存skip（DB29／Worker4／API83、別の隔離DBゲートで実行済み）。`docs:validate`は21画面／189状態契約のerror0、`git diff --check`成功（`/tmp/hanamaru-ebay-dispatch-{unit,docs}.log`）。今回の新しいフェンスを含む正式Webブラウザ回帰は未実施であり、先行のChromium結果・過去の全画面結果と区別する。

WebKitの合成ページ診断では、当該試験processだけのmacOSログに`GPUProcessCrashedTooManyTimes`、GPU Processの`Unresponsive`、WebContentの終了を確認した。起動直後のabout:blankのJavaScript評価は成功し、遷移後はGPU process停止に伴い失敗した。GPU停止理由の下位原因（OS／GPUドライバ／資源等）は未確定。空き容量は約2GBだったが、これを原因と断定しない。検証用processを閉じ、GPU無効化・OS設定変更・他アプリ終了・ユーザーファイル削除はしていない。最終WebKit合格は引き続き未達。

### 通常配備のBuild・digest・コミット識別子の再照合

2026-10-09の読み取り照会で、次の通常配備3サービスは下記Revisionへ各100%のtrafficだった。各Revisionのimage digestがCloud Build `10d8ef56-4ded-4840-b7e6-522b31f3fa85`の`results.images`と3/3一致し、Build statusはSUCCESS、`_GIT_SHA`とRevisionの`source-commit`は`6f3fb24afa2027afe3b61f9525157c8dcb03a2c5`で一致した。migration labelは`0066_expense_branch_closing`。これは通常配備の識別子とイメージの対応確認であり、今回の未commit eBay差分の配備証拠ではない。Build source archiveとGit treeの内容比較はこの照会では行っていない。

| 対象 | 通常配備Revision | image digest（sha256） |
|---|---|---|
| Web | `hanamaru-pilot-web-00156-ref` | `3c60bfdbb3a95ab88230e03027a1790f143dd373370219ff88d9fd9b5cbb6013` |
| API | `hanamaru-pilot-api-00261-zet` | `6f1b683727c938a768a9cdc203454705f8de461852b1fc38e895dc6a8ae222ac` |
| Worker | `hanamaru-pilot-worker-00137-vot` | `0f61ddd65d0d75a747a83dd760faea0b491230a7c6d3bc04da5e1ea5aa92c547` |

origin/mainも同じSHA。open PR31とDependabot PRは取り込まず、GCP設定変更・本番migration・Secret読取・実API・commit・pushは行っていない。Stage／本番のeBay配備ゲートは未完了である。

### 最新Chromium全画面回帰と実画像からの修正

`OFFLINE_E2E_PROJECT=chromium`を診断用途として追加した。既定値では引き続きChromium＋WebKitの全シナリオ・85画像を要求し、単一browser・grep限定実行は`PASS_SCOPED`、`formalBrowserGatePassed:false`と記録する。単一Chromiumの全シナリオでは81画像、単一WebKitでは4画像を要求する。未対応project名はDB起動前に拒否する。正式両browserゲートや実Google受入を単一browser結果で代用しない。

初回の最新Chromium実走（`.artifacts/offline-e2e/20261009T121630Z/`）は17シナリオ合格・81画像、21画面×8幅（320／360／390／430／768／834／1024／1440px）の横はみ出し検査成功、axe serious／critical 0。PDF・音声・Yahoo／オークファン・経費・eBay・RBAC・200% reflowの操作を合成provider・隔離DBで確認した。証跡は親commit `6f3fb24`、workingTreeDirty=trueで、未commit変更の実走である。

生成したeBay結果画像はfull-pageが長いため、そのまま縮小した表示だけでは読取検査にならなかった。原画像を変えず上部viewportをメモリ上で抽出して確認したところ、比較結果selectorがブラウザ標準の小さい高さで、読込buttonとlabelが詰まっていた。比較操作を縦配置し、selectorを本文16px／高さ44px以上、条件確認labelを44px以上へ修正した。閲覧可能な国内確定結果が0件ならselectorを無効にし、別結果や新規外部検索へ自動切替しない。空のselectorのcomponent試験と、390／1440pxでの実高さ・fontのE2E検査を追加した。修正後のブラウザ結果は別実走として追記する。

修正後の最新実走（`.artifacts/offline-e2e/20261009T122117Z/`）もChromium全17シナリオ合格・81画像、所要3.7分。比較selectorの44px以上／16px以上を390・1440pxで実検査し、axe serious／critical 0、21画面×8幅の横はみ出しなし、200% reflow、キーボード表示時の重なりなしを確認した。componentはWeb228件合格、lintも成功。画像確認はeBay結果のPC／スマホ上部viewport、SCR-021入力、SCR-003・006・009・017のスマホを確認した範囲であり、81枚すべての視覚受入が完了したとは扱わない。

`result.json`は`status:PASS_SCOPED`、`formalBrowserGatePassed:false`、`browserProject:chromium`、`workingTreeDirty:true`、`googleAcceptance:false`。独立した隔離DB・合成providerで実走し、実Soldgraph／Google API・実人物・本番DBには接続していない。検証用Next buildが追加したtsconfigのdist pathと整形差分だけを元へ戻し、通常設定へ検証用差分を残していない。テスト用API／Worker／Web／DBは終了し、専用port3140／3240／3340／55439が待受していないことも確認した。正式WebKit・全画像視覚確認・保存期間合意・実API枠承認・実接続・Stage／本番は未完了。commit／pushは行っていない。

通常tsconfigへ戻した後の全typecheck・unitも成功。unit526件合格・116件DB依存skip、secret scan369ファイルの検出0件、docs21画面／189状態契約error0、bash構文・diff検査成功（`/tmp/hanamaru-ebay-browser-final-{typecheck,unit,security,docs}.log`）。DB依存は先行の隔離DB29／Worker31／API106件ゲートと分けて記録する。

### 画像棚卸し・視覚確認とeBay運用表示の補修

`.artifacts/offline-e2e/20261009T122117Z/screenshots`について、SCR-001〜021の390／834／1440pxの63枚と、SCR-003〜009の360／430pxの14枚、計77枚を表示して確認した。さらにeBay結果と経費拠点の390／1440pxの4枚は原画像を変更せず上部1000pxをメモリ上で抽出して確認した。後者は高さ5,432〜14,449pxの長い画像であり、上部確認を全区間・全文の視覚受入とは扱わない。81枚すべてが完全合格という判定はしていない。

| 観測 | 判定・対応 |
|---|---|
| SCR-001はGoogle認証設定未接続の案内 | fixtureの未接続表示確認。Googleログイン合格ではない |
| SCR-003の834px表は店舗・次の作業列が狭く縦折返しが多い | 既存画面の改善候補。横はみ出し検査成功だけで可読性合格としない。eBay-only差分へ別業務の修正を混入しない |
| SCR-004のPDF原本paneが空白 | 確認済み抽出値の表示とは別に、原本描画は画像だけでは合格としない |
| SCR-006の834／1440pxに音声ストリーム再接続案内 | fixtureの録音Job・文字起こし成功とは別に、実音声再生の受入は未確認 |
| SCR-014は動画0件、SCR-019／020は利用不可 | 空状態・既定OFFの表示確認。動画再生・承認・チーム分析の操作合格ではない |
| SCR-018に処理・対象の「未定義の状態」 | eBayのJob／entity表示定義が欠落。`market_price_ebay_search`と`ebay_market_price_search`の日本語表示だけ追加。既存Yahoo等の未定義値の対応は別課題として残す |
| eBay比較欄の390／1440px上部 | 比較selectorとbuttonの分離、空の結果の案内、消費9枠・未確定0枠、取得ページ標本の注意を確認 |

eBay運用表示の単体回帰を追加し、Web229件、Web typecheck・lintは成功（`/tmp/hanamaru-ebay-job-label-{unit,typecheck,lint}.log`）。管理画面にeBay取得Job名と対象名が表示されることをE2Eへ追加し、最新sourceから再build・Chromium全シナリオを実走中。先行81画像は表示名修正前の証拠として保持し、修正後の受入と混同しない。WebKitのGPU process障害、実API使用承認と実接続、保存期間・本番予算の合意、固定Stage／本番は未完了。外部API、実キー、commit／push、GCP書込は実行していない。

上記再実走は完了した。`.artifacts/offline-e2e/20261009T123212Z/`はChromium17シナリオ合格・81画像・3.7分、axe serious／critical 0、21画面×8幅の横はみ出し検査成功。管理画面のeBay Job名・対象名のE2E assertionが成功し、修正後SCR-018の390／834／1440px画像も確認した。eBay以外の未定義値は残っており、全Job表示の改善完了とはしない。`result.json`は引き続き`PASS_SCOPED`／`formalBrowserGatePassed:false`／`googleAcceptance:false`／`workingTreeDirty:true`。新しい81画像全部を再度視覚受入したとは扱わず、前実走の77枚＋4枚上部の観測と修正後SCR-018の3枚を区別する。

通常tsconfigで全typecheck・全unit527件合格、116件DB依存skip（先行隔離DBゲートとは別）、docs21画面／189状態error0、secret scan369ファイル検出0、`git diff --check`成功。検証buildが追加したtsconfigの検証dist path／整形差分のみを戻し、専用port3140／3240／3340／55439が終了したことを確認した。今回もcommit・push・実API・Stage／本番操作はしていない。配備ゲートは保存期間・対象組織と予算・実API試験枠の承認、実Usage／結果／課金の照合、WebKit復旧と正式両browser合格、固定Stageの認証・rollback・同digest昇格が残る。
