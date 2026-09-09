# デジタル庁デザインシステム活用・全21画面UI改善仕様

## 1. 目的と適用範囲

デジタル庁デザインシステム v2.17.1 の設計原則を、買取支援ツールのログイン、査定員業務、知識、研修、管理、SCR-021「買取相場（仮）」を含む全21画面へ適用する。

目的は外観の複製ではなく、次の品質を共通化することにある。

- 日本語の読みやすさと情報階層
- 操作対象、現在位置、入力条件、結果の明確さ
- キーボード、タッチ、拡大表示に耐える操作性
- 色以外でも伝わる成功、警告、エラー、選択状態
- PCの業務密度とスマートフォンの完結性の両立

既存Route、API、DB、認証、権限、業務フローは変更しない。通常画面へデザインシステム名、実装メタ情報、provider名を表示しない。

## 2. 参照正本

- デジタル庁デザインシステム「コンポーネント」: <https://design.digital.go.jp/dads/components/>
- テキストスタイル: <https://design.digital.go.jp/dads/foundations/typography/text-style/>
- カラー: <https://design.digital.go.jp/dads/foundations/color/>
- ボタン: <https://design.digital.go.jp/dads/components/button/>
- テキスト入力: <https://design.digital.go.jp/dads/components/input-text/>
- チェックボックス: <https://design.digital.go.jp/dads/components/checkbox/>
- ノティフィケーションバナー: <https://design.digital.go.jp/dads/components/notification-banner/>
- テーブル: <https://design.digital.go.jp/dads/components/table/>
- ステップナビゲーション: <https://design.digital.go.jp/dads/components/step-navigation/>
- ファイルアップロード: <https://design.digital.go.jp/dads/components/file-upload/>
- デザインデータ更新履歴 v2.17.1: <https://design.digital.go.jp/dads/updates-design/>

公式トークンpackageはMITライセンスだが、package README上のFigma対応範囲と今回参照するv2.17.1に差がある。このためpackage依存は追加せず、公式primitiveの必要最小限を既存semantic tokenへ写像する。

## 3. 共通デザイントークン

### 色

| 用途 | 値 | 運用 |
|---|---:|---|
| Primary | `#0017c1` | 主要操作、現在位置、リンク |
| Primary hover | `#00118f` | hover、active |
| Primary subtle | `#e8f1fe` | 選択行、選択ナビ、情報補助 |
| Text | `#1a1a1a` | 見出し、本文 |
| Secondary text | `#4d4d4d` | 説明、補助情報 |
| Border | `#cccccc` | 面、表、区切り |
| Strong border | `#767676` | 入力、選択、操作境界 |
| Canvas | `#f2f2f2` | アプリ背景 |
| Success | `#197a4b` | 完了、正常 |
| Warning | `#927200` | 注意、部分取得 |
| Error | `#ce0000` | 入力・処理エラー |
| Focus outer | `#ffd43d` | フォーカス外周 |
| Focus inner | `#000000` | フォーカス内周 |

本文コントラストは4.5:1以上、非テキストUIは3:1以上を基準とする。状態は色だけでなく、アイコン、見出し、文言、境界線を併用する。

### 文字

- Font stackは`Noto Sans JP`を先頭にし、未導入環境は日本語システムフォントへ安全にfallbackする。
- PC画面見出し32px、セクション見出し20px、本文・入力16px、密度の高い補助情報14pxを基準とする。
- Smartphone画面見出し26px、本文・入力16px、主要ラベル15px、補助14px、時刻・件数等13pxを維持する。
- 本文line-heightは1.7、長文Readerは1.75とする。
- 通常業務の意味を持つ文字を13px未満にしない。スマホ下部ナビは限られた幅のため12pxを下限とする。

### 形状と面

- 業務面は白、背景はNeutral 50とし、半透明・blur・gradientを常用しない。
- 操作部品は8px、選択Cardは12px、主要Panelは16px、DialogとMobile Sheetは20pxを上限とする。明確な境界線と情報密度を保ち、全面をpill形状にはしない。
- shadowは浮遊するdialog、mobile sticky actionに限定する。
- Cardを装飾目的で増やさず、border、見出し、余白、表で情報階層を示す。

## 4. 共通コンポーネント契約

### Navigation

- PC Sidebarは白地、選択項目はBlue 50と左4pxのBlue 900 indicatorで示す。
- Tablet railは同じ選択規則をiconへ縮退して維持する。
- Smartphone下部ナビは白地、選択項目は色と上4px indicatorで示す。
- Secondary Navigationは具体的な業務名を維持し、hover時にunderlineを出す。
- すべてのnavigation itemは44px以上の操作領域を持つ。

### Button / Link

- Primaryは白文字＋Blue 900、hoverはBlue 1000。
- Secondaryは白地＋Blue 900の枠・文字。
- Dangerは白地＋Error borderから始め、hoverでError塗りへ変える。
- Disabledはopacityだけに頼らず、Neutralの文字・面・境界へ置き換える。
- テキスト操作は青色に加えunderlineを付ける。
- 戻る・取消は左、次へ・確定は右の意味順を維持する。mobile縦積みでもDOM順は変えない。

### Form

- 入力、select、textareaは原則48px以上、1px以上のStrong border、8px radius、16px文字とする。
- labelを必ず表示し、必要な項目は`※必須`、補助項目は`※任意`で示す。
- 入力条件・例・エラーはplaceholderだけに置かず、label近傍のsupport textへ置く。
- 複数選択はcheckbox、単一選択はradioを表示し、controlを視覚的に隠さない。
- IME composition中のEnterでは実行しない既存契約を維持する。

### Notification

- success、error、warning、infoはicon、短いtitle、本文を持つ。
- 左4pxのsemantic borderと淡色面を使用し、色以外でも状態を判別できるようにする。
- エラーには再試行、修正箇所、閉じる等の復旧操作を近接配置する。

### Table / List-detail

- 複数行を同じ列で比較する場合はtableとcaptionを使用する。
- 単一対象の項目名と値はdescription listを使用する。
- table headerはNeutral 50、本文は15pxを基準とする。
- smartphoneではtableをarticle＋description listへ変換し、横スクロールを主操作にしない。

### Step navigation / Progress

- 作業の段階はstep navigation、処理待ちはprogress statusとして分離する。
- stepは現在、完了、未到達を番号・check icon・文言で表す。
- smartphoneは`手順 N/全数：名称`を表示し、step bar自体は番号へ縮退する。
- 実進捗率が取れない非同期処理に数値progressを表示しない。

### File upload

- drag and dropの有無にかかわらず、常に「ファイルを選択」「画像を追加」buttonを表示する。
- 拡張子、容量、枚数、重複、失敗理由を選択前後に明示する。
- 選択済み画像の削除は44px以上にし、番号付きaccessible nameを持たせる。

## 5. 全21画面への適用

| SCR | 画面 | 主な適用内容 |
|---|---|---|
| 001 | ログイン | 白い認証面、32/26px見出し、48px認証button、明確な認証error |
| 002 | AI支援ホーム | 見出し・本文16px、warning banner、AI入力、根拠と業務入口のpanel整理 |
| 003 | 訪問業務一覧 | 常設filter、table header、選択行、mobile card、主要操作の明確化 |
| 004 | PDF取込・情報確認 | file button常設、原本・入力境界、labelと必須表示、確定操作 |
| 005 | 訪問前チェック | summary、法令確認、想定talk、Q&Aの見出し階層と通知 |
| 006 | 録音・文字起こし | 同意checkbox、upload、audio bar、発話区間の読みやすさ |
| 007 | 振り返り入力 | 入力label、分析観点checkbox、品質warning、固定操作の重なり防止 |
| 008 | AI振り返り結果 | transcript／分析split、6領域、根拠表示、確認状態 |
| 009 | 振り返り履歴 | filter、履歴table/mobile card、選択detail |
| 010 | 切り返しトーク | category、結果、detailの現在位置と長文Reader |
| 011 | 困ったときのフロー | 状況filter、手順list、detail、mobile段階表示 |
| 012 | 用語・価格 | tab、table、detail、label-value変換 |
| 013 | マニュアル・法務 | 目次、本文、注意banner、版情報 |
| 014 | 動画ライブラリ | 一覧、player、文字版、状態説明 |
| 015 | AIロールプレイ | scenario radio、対話input、feedback、履歴 |
| 016 | コンテンツ管理 | table、editor label、preview、公開状態 |
| 017 | 利用者・権限 | 利用者table、権限checkbox、変更影響notification |
| 018 | システム運用 | tab、health status、保存期間table、警告・重大表示 |
| 019 | コンテンツ承認 | 対象一覧、差分、基準checkbox、承認・差戻し |
| 020 | チーム分析 | 指標、chart、同値table、個人順位を作らない |
| 021 | 買取相場（仮） | 3入力経路、visible radio、状態checkbox、5-step、候補table＋caption、部分取得warning、sticky重なり防止 |

## 6. Responsive契約

- `1280px以上`: PC Sidebarと2〜3pane。情報密度を維持する。
- `768〜1279px`: 72px rail、1〜2pane。見出し32px、本文16px。
- `767px以下`: 1column、5項目bottom navigation、本文16px、画面見出し26px。
- `360／390／430px`: fixed/sticky actionの高さ分を本文末尾へ確保し、下部ナビと重ねない。
- `200% zoom`: 実効幅640px相当で横スクロールなし、focusされた入力は下部ナビより上へ表示する。
- `prefers-reduced-motion`: 移動・scaleをなくし、必要最小限のopacityへ縮退する。
- `prefers-reduced-transparency`: 不透明な白い面へ切り替える。
- `prefers-contrast`: border、focus、状態表現を強める。

## 7. 検証と完了条件

- TypeScript、ESLint、component test、production buildが成功する。
- Chromium／WebKitで21画面のRoute、主要操作、keyboard、focus、mobile navigationを確認する。
- axe serious／criticalを0にする。
- 360〜767pxの`main`内で意味を持つ文字が13px未満にならない。
- 390／834／1440pxの21画面画像を更新し、login、home、visit、transcript、review、knowledge、admin、market priceを重点目視する。
- Primary actionが競合せず、sticky actionが本文・下部ナビを覆わない。
- alert、error、selection、disabledを色だけに依存させない。
- Route、API、DB、認証、権限、業務DTOに意図しない差分がない。

## 8. 実装位置

- Token: `apps/web/src/styles/tokens.css`
- Global focus: `apps/web/src/app/globals.css`
- Shell／Navigation: `apps/web/src/components/shell/AppShell.module.css`
- SCR-001〜020: `apps/web/src/features/web/Experience.module.css`
- SCR-021: `apps/web/src/features/market-price/MarketPriceExperience.tsx`、`MarketPriceExperience.module.css`
- access/error/prototype state: `apps/web/src/components/prototype/ScreenHost.module.css`

本仕様はローカル実装の正本であり、GCP公開、GitHub push、本番Feature Flag変更を意味しない。
