# デジタル庁デザインシステム活用・全21画面UI改善 実装報告

## 現況

**ローカル実装・検証完了。全21画面へ適用済み。本番未反映。**

| 項目 | 結果 |
|---|---|
| 適用範囲 | SCR-001〜021、共通Shell、ログイン、権限・エラー状態 |
| Unit | PASS: Web 182、market-price 11、platform 45、ほかworkspace test成功 |
| Lint / TypeScript | PASS |
| Next.js production build | PASS |
| Docs contract | PASS: 21画面、21 Route、189 state contracts、error 0 |
| Offline E2E | PASS: 23、意図的skip 1 |
| Browser | Chromium / WebKit PASS |
| axe | 全21画面 serious / critical 0 |
| Responsive | 320 / 360 / 390 / 430 / 768 / 834 / 1024 / 1440pxで横スクロール0 |
| 画像 | 77枚: 正式63枚＋中核14枚 |
| Deploy / push | 未実施 |

最終E2E証跡:

`/Users/riri/Documents/monocle/01_git/gcp/hanamaru-shientool-prod/.artifacts/offline-e2e/20260909T120145Z`

## 実装した変更

### 全画面共通

- DADS互換のBlue、Neutral、Success、Warning、Error、Focus tokenへ統一した。
- 日本語font stackの先頭を`Noto Sans JP`とし、system font fallbackを維持した。
- 画面見出し32px、本文・入力16px、補助14pxを基準化した。
- 業務面を不透明な白へ統一し、常用していたblur、gradient、装飾shadowを削減した。初回HITLの「枠が四角過ぎる」という指摘を受け、操作部品8px、選択Card12px、主要Panel16px、Dialog／Sheet20pxの用途別radiusへ再調整した。
- Primary、Secondary、Danger、Disabledの見た目と操作状態を統一した。
- すべてのkeyboard focusへ黒2px＋黄4pxの二重indicatorを強制適用した。
- table、form、notification、step、file uploadの表示規則を共通化した。

### Navigation / Responsive

- PC Sidebarの選択状態をBlue 50背景＋左4px indicatorへ変更した。
- Tablet railも同じ選択規則へ揃えた。
- Smartphone bottom navigationを白い固定面、12px label、上4px indicatorへ変更した。
- 320〜1440pxの8幅で全21画面の横幅を検査した。
- Smartphoneの本文13px下限、本文・入力16px、画面見出し26pxを維持した。

### SCR-021 買取相場（仮）

- 画像＋AI補助、手入力＋AI補助、手入力のみを、表示されたradioと異なるiconで明確化した。
- 商品状態を装飾pillではなく標準checkboxへ変更し、必須表示と利用方法のinfoを追加した。
- PCの5-step label崩れを修正した。
- Smartphoneは`手順 N/5：名称`＋番号stepへ縮退し、画面reader向けlabelを保持した。
- 候補tableへcaptionを追加した。
- errorとpartialをicon、title、本文、semantic borderで表現した。
- sticky action用の本文末尾余白を確保し、bottom navigationとの重なりを防いだ。
- 入力方法CardはViewport幅ではなくPanel実幅を基準に配置するContainer Queryへ変更した。狭いPCペインと360／390／430pxでは全幅の縦1列とし、タイトル1行、説明2行を基本にした。

## 検証中に検出・修正した差分

1. Tablet見出しをDADS基準の32pxへ変更したため、旧26.4px固定テストを新仕様へ同期した。
2. component側の`box-shadow: none`がfocus外周を上書きしていたため、global focusを最優先に修正した。
3. SCR-021の旧step selectorが番号だけでなくlabelへ白文字を適用し、Blue 50上でcontrast不足になっていた。labelを濃い青へ修正しaxeで再検証した。
4. SCR-021のmobile step labelが画面内で折れ・切れていた。視覚上は番号へ縮退し、accessible nameは保持した。
5. SCR-021の入力方法3件が狭いPanel内でも横3列になり、タイトルと説明が細かく折れていた。Card内部に本文Groupを設け、旧`grid-column`指定を解除し、Panel実幅に応じた1列／3列へ修正した。

## 最終E2Eの対象

- 全21 API-backed screenのrenderとaxe
- PDF登録→情報抽出→訪問前チェック確定
- 音声登録→文字起こし→話者確認→6領域AI振り返り
- 保存期間と運用healthの管理画面
- 買取相場の画像＋AI補助、手入力＋AI補助、手入力のみ
- 候補除外・復帰、外れ値再適用、相場確定、再読込、履歴
- Mobile navigation、More menu、URLで保持するlist/detail state
- DADS黒＋黄focus indicator
- Smartphone全画面の文字下限
- 200% reflowと短いkeyboard viewport
- 8 responsive幅×21画面の横幅
- Assessorの管理画面拒否
- 390 / 834 / 1440pxの21画面、360 / 430pxの中核7画面を撮影

## 目視確認

次を重点確認し、重大な崩れがないことを確認した。

- SCR-001 Login: 中央認証面、文字階層、余計な説明heroなし
- SCR-002 Home: AI入力、警告、根拠、業務入口の優先順位
- SCR-003 Visits: filter、table、detail、mobile card
- SCR-006 Transcription: 録音、warning、quality result、segment editor
- SCR-010 Knowledge: 3-pane、長文、secondary navigation
- SCR-018 Operations: health、tab、table、detail
- SCR-021 Market price: 3入力経路、step、状態checkbox、sticky action

## 未実施・境界

- GCPへはデプロイしていない。
- GitHubへcommit・pushしていない。
- 本番Feature Flagを変更していない。
- 今回はUI改善であり、API、DB、認証方式、権限、既存Routeは変更していない。
- Figmaファイルそのもののcomponentをコピーせず、デジタル庁の公式Web仕様と公開token値を既存UIへ適用した。

## 正本

設計仕様は`docs/design/2026-09-09-digital-agency-design-system-ui-refresh.md`を正本とする。
