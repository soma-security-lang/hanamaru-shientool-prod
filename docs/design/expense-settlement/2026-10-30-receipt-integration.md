# 領収書取込・AI読取の接続仕様

更新日: 2026-10-30。既存の支出・日次・拠点締めを拡張する。ソース実装、ローカル、Stage、本番、顧客受入を別々に判定する。本書追加時点では本番未反映。

## 業務・認可の境界

- 本人入力、organization/branch/membership/scope、冪等性、楽観ロック、監査を再利用する。領収書経路を代理入力や役職者権限の追加根拠にしない。
- AIは支払日・支払先・支払総額・通貨・印字された用途の手掛かりだけを候補にする。支払元・費目・承認・残高・締め・返金を確定しない。
- OCR候補、人が確認した下書き、登録した経費を分離する。未登録候補は合計外。確認登録だけが既存expense_itemsへ一度書き込む。
- 画像添付と証憑承認は別。個人立替を会社財布から控除しない。締め後の追加・訂正は既存の役職者経路を維持する。

expense_settlementフラグに加え、組織別expense_receipt_policiesを必要とする。保存日数・承認者・承認日時がなければ収集とAI読取を拒否し、手入力を維持する。migrationで既存組織を自動有効化しない。本番の保存日数は推測で設定しない。

この保存方針は画像・OCR候補の技術的な期限であり、法令適合・紙原本の廃棄可否の保証ではない。経費明細・監査の既存保存方針は上書きしない。

## 画面と遷移

既存の `/expense-settlement?dayId=...` に追加する。

1. 撮影または複数選択。JPEG/PNG/WebP、20画像・1枚10MB・合計100MB以内。
2. 同じ1件の領収書が複数画像なら明示して最大5枚をまとめる。画像枚数分の金額を足さない。
3. 画像ごとに取込を確定し、未完了分は同じ操作キーで再開する。
4. Google Cloudへ画像を送信することを確認してAI読取を開始する。部分失敗は他の領収書へ波及させない。
5. 原画像・AI候補・印字根拠と、人の確認欄を分ける。読めない値はnull。撮影日・入力日・今日の日付から補完しない。
6. 確認内容を下書き保存し、確認済み分だけ選択登録する。途中成功分を再登録しない。
7. 日次合計・再読込で登録結果を確認する。未確認領収書を拠点の入力完了・締めへ短絡させない。

1画像に複数の領収書がある場合は再撮影とし、自動分割・登録しない。不要な候補は理由付きで登録対象外にする。HEICは初版の許容形式に含めずJPEG変換を案内する。対応済みと表示しない。

経費登録は正の整数のJPYだけ。海外通貨・小数額を自動換算しない。支払日と対象業務日の不一致は拒否する。同日・同額・同じ支払先は重複候補として、人が別支出と確認する。同額の正当な別支出を自動削除しない。

## 状態と復帰

| 対象 | 状態 | 保存・再開 |
|---|---|---|
| 画像 | 未取込→取込済み | サイズ/hash/signature検証、private Storageの世代固定 |
| 領収書 | uploading→uploaded→reading→review_required | batch内で独立、Jobと正規化画像がcheckpoint |
| 失敗 | failed | 対象だけ再試行、または人による手入力 |
| 人の確認 | review_json | OCR原候補と分離し版付き保存 |
| 登録 | registered | item IDを一意に保持し同操作再送で増やさない |
| 対象外 | excluded | 理由を保持。登録済み経費の取消には使わない |
| 期限 | deleting→deleted | holdのない期限超過画像・OCR/確認下書きを削除。会計記録は保持 |

保存結果不明と、保存成功後の一覧再取得失敗を区別する。操作キー・種別・対象日・開始日時だけsessionStorageに置き、画像・金額・支払先・本文・認証情報は永続保存しない。48時間経過や照会不能を成功/未保存と断定せず、新キーで自動再登録しない。

結果のDB確定後にJob完了だけ失った場合、同一Jobのcheckpointを使いAIを再呼出ししない。旧失敗Jobを新しい成功後も永続アラートにしない。画面離脱後は後続の画像追加送信・保存を開始せず、既に保存した処理は保持する。

## API・DB・Worker

| API（/api/v1配下） | 責務 |
|---|---|
| GET /expense-receipt-options | 組織方針・形式・上限 |
| GET /expense-days/:id/receipts | 状態・候補・人の確認・画像一覧 |
| POST /expense-days/:id/receipt-batches | 本人の日次の取込バッチ |
| POST /expense-receipt-batches/:id/images | 画像宣言、同日/本人scopeの同一hash検出 |
| GET /expense-receipt-images/:id/upload-access | 再認可した短命write-onceアップロード権限 |
| POST /expense-receipt-images/:id/renew | 保存期限内の未完了画像だけアップロード期限を再発行。サイズ/hashは不変 |
| POST /expense-receipt-images/:id/complete | 内容検証と原画像確定 |
| GET /expense-receipt-images/:id/file | scope・期限付き参照。Native JSON経路から除外 |
| POST /expense-receipts/:id/analyze | AI送信の確認を要する専用Job |
| PATCH /expense-receipts/:id/review | 人が確認した下書き保存 |
| POST /expense-receipts/:id/register | 明示確認・JPY・日付・版・重複候補を検証して登録 |
| POST /expense-receipts/:id/exclude | 未登録候補を理由付き除外 |
| GET /expense-receipt-operations/:key | 本人の操作結果を現在scope・フラグで照会 |

0072は追加migration。既存migrationを編集しない。4テーブルにorganization RLSを強制する。Workerに利用者全体のSELECTを追加せず、現在依頼者の有効性だけをbooleanで確認する関数を使う。運用用関数は現在Job IDだけを返し、画像・OCR・金額は返さない。

Jobはexpense_receipt_reading。PDF抽出Jobを転用しない。原画像を保持し、EXIFをコピーせず最大辺2048pxのWebPへ正規化する。画素上限、5画像・正規化合計20MB上限を設ける。JSON契約違反だけtemperature 0で1回修復し、通信失敗を修復名目で再送しない。他Providerへ黙ってfallbackしない。

既存retention scanで期限を処理する。holdは削除前に判定し、削除fence取得後の後付け変更を拒否する。失敗はdeletingから再開する。監査は対象ID・件数・同意確認等のみ。本文・OCR全文・画像・署名URL・Provider raw responseを通常ログへ複製しない。

## 受入条件と証跡

| ID | 受入条件 | 主な検査 |
|---|---|---|
| RC-01 | 方針未承認・権限外・system_admin拒否 | API/DB/RLS |
| RC-02 | 重複画像・形式偽装・上限超過 | Provider/API |
| RC-03 | 原画像保持・EXIF除去・対応関係 | Worker/DB/ブラウザ |
| RC-04 | 未確認値は合計外、支払元を推定しない | Provider/API/UI |
| RC-05 | 部分失敗・再試行・checkpoint | Worker/ブラウザ |
| RC-06 | 日付・通貨・預り金/釣銭の訂正 | 構造化検査/合成証憑の正式Provider接続 |
| RC-07 | 選択登録・二重クリック・応答喪失 | API/UI/ブラウザ |
| RC-08 | 同額の別支出の明示確認 | API/UI |
| RC-09 | 未確認領収書を入力完了・締めへ短絡しない | 支店API/DB |
| RC-10 | 期限・hold・部分削除・会計記録保持 | Worker/最小権限DB |
| RC-11 | 再読込・離脱・390/1440px・axe | Chromium/WebKit |
| RC-12 | 実顧客データなしのStage→同digest公開 | manifest/合成証憑証跡 |

fixtureは「読取不能・全値null」を明示して手入力への復旧を検証する。任意画像へ架空の金額を付けない。fixture/SDK mock合格を実Vertex合格へ転記しない。最新の実行・未実行は最終納品台帳へ記録する。
