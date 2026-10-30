# 買取相場：Yahooの0件404応答を正常な検索完了へ戻す

## 確認した問題

本番の直近のYahoo検索失敗4試行は、保存済みの安全化済みエラーからHTTP 404と確認した。従来の `YAHOO_FETCH_BLOCKED` は403だけを意味せず、通信・HTTP・一部保存失敗も含む包括的な表示である。実際の原因を確認せず、アクセス遮断と断定しない。

2026-10-30、現行本番Workerと同じ固定imageから、公開の匿名商品を1回だけ読み取り、HTTP 200・最新順100件の構造解析に成功した。別の合成検索語による0件照会では、HTTP 404ながら `__NEXT_DATA__` に最新順・100件指定・items空・totalResultsAvailable=0が存在し、既存の厳密Parserが正常解析した。実顧客情報、実領収書、Soldgraphの枠消費は使用していない。

## 修正する境界

- `createYahooMarketPriceSourceProvider` は404だけを例外的に本文検証へ進める。
- 既存ParserのCAPTCHA・HTML構造・最新順・100件・件数契約を全て維持する。
- items、sourceItemCount、parseFailureCount、totalResultsAvailableが全て0の404だけを、取得済みの空結果として返す。
- 本当のHTTP status=404をページcheckpointへ残す。HTTP 200を捏造しない。
- 一般的な404画面、本文の「商品がありません」という文章、構造不正、非0のtotal、403、CAPTCHA、429から0件を推測しない。
- Workerの既存処理で `ready / complete`、候補0件、価格null、Job成功へ進む。価格0円や相場確定と区別し、候補0件の確定は拒否する。
- 既存検索を自動再送・再登録・更新しない。過去の失敗検索は利用者が再試行した場合だけ既存経路で再開する。

## 変更しないもの

公開URL、Webの既存Google認証、API・DTO・DB schema・権限・機能フラグ、Yahooの90日・最新100件・最大20ページ・停止条件、eBayとオークファンの設定・予算・利用許可は変更しない。Proxy、Cookie偽装、CAPTCHA回避を追加しない。共通SSO/API移行の本番有効化と混ぜない。

## 検証計画

| ID | 環境 | 操作と期待結果 |
|---|---|---|
| MKT-404-01 | unit | 404＋厳密な空検索契約だけを成功として返し、HTTP 404を保持 |
| MKT-404-02 | unit | 通常404、非0total、並び順・page sizeの不一致、CAPTCHA、403を拒否 |
| MKT-404-03 | 隔離DB | 正式adapter＋合成transport→既存Worker→ページ404 checkpoint・Job成功・0件/null統計。0件確定は拒否 |
| MKT-LIVE-01 | 隔離Stage | 合成利用者で手入力→確認→実Yahoo→候補→採否→確定→再読込。0件なら価格を作らず0件表示 |
| MKT-LIVE-02 | 隔離Stage | 合成の0件検索→正常完了・0件/null・再読込。403等を成功に読み替えない |
| MKT-PROD-01 | 本番 | 検証済みWorker digest、既存設定・SA・接続先・他取得元を維持しread-back。既存利用者データへの試験書込みなし |

ブラウザ確認は既存Playwright・Chromium/WebKit・隔離Stageを使用する。保存結果、HTTP/Job、実取得とfixtureを別々に記録する。認証情報・検索語・完全URL・生HTML・価格を通常ログへ出さない。証跡は `.artifacts/market-recovery-20261030/` にGit除外で保存する。

## 公開ゲート

変更したcommitに対する既存CI相当の全20実行step、DB/role、offline E2E、Workerのproduction build・SBOM・HIGH/CRITICAL scan、固定Stageの同digest受入を必須とする。公開は監査付き手動経路でWorkerのみを対象とし、API/Web/DB/SSOを同時変更しない。GitHub課金設定は変更しない。直前の本番Worker revision・digest・設定を保持し、問題時はそのrevisionへ戻す。

この文書の作成・unit成功は、Stageや本番の成功を意味しない。各環境の実行結果は別の非公開receiptで確認する。
