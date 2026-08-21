import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const docsRoot = process.env.HANAMARU_DOCS_ROOT
  ? resolve(process.env.HANAMARU_DOCS_ROOT)
  : resolve(process.cwd(), "../../../03_project-management/working-docs/hanamaru-shientool");
const screensDir = resolve(docsRoot, "05-screen-design/screens");

const screens = [
  ["001","login","ログイン","/login","中央認証Card。説明heroを置かず、認証操作だけを明確にする。","Googleログイン、認証失敗、focus復帰","全ログイン対象","スタッフ／管理ログインと権限分岐","中央1面","中央1面","中央1面"],
  ["002","home","AI支援ホーム","/","AI対話8列と根拠・業務入口4列。PoCのAIホームを主機能に戻す。","自然文質問、根拠選択、訪問・振り返り・研修への遷移","全active role","ホームAI支援、主要コンテンツ入口","AI 8列＋右rail 4列","AI＋右rail","1カラム"],
  ["003","visit-list","訪問業務","/visits","常設Filter、Table、選択案件Detailで次作業を一画面に収める。","検索、行選択、訪問登録、次作業へ遷移","assessor / manager / educator","訪問前チェックへの入口","Table 8.5列＋Detail 3.5列","一覧＋詳細","カード縮退"],
  ["004","visit-edit","PDF取込・情報確認","/visits/:id/import","PDF原本5列と抽出項目7列を並べ、人の確認を必須にする。","PDF再選択、抽出項目修正、確定","assessor / manager","訪問前PDFチェック","原本5列＋項目7列","原本／項目切替","段階表示"],
  ["005","pdf-extraction","訪問前チェック","/visits/:id/preparation","顧客情報3列、法令チェック5列、Talk・Q&A 4列を同時表示する。","法令4項目確認、関連トーク、準備完了","assessor / manager","顧客情報、想定心理、法令4項目、想定Talk、想定Q&A","3＋5＋4列","2列折返し","1カラム"],
  ["006","recording-import","録音・文字起こし","/visits/:id/transcription","録音・Job 3列とTranscript 9列。別ページへ分断しない。","同意確認、音声取込、再生、区間修正、確定","assessor / manager","録音読込、文字起こし貼付","3＋9列","録音＋本文","1カラム"],
  ["007","transcription-status","振り返り入力","/visits/:id/review/input","会話本文8列と分析条件4列。PoCの直接入力導線も保持する。","本文編集、録音変更、6観点選択、分析開始","assessor / educator","振り返り入力、録音選択","8＋4列","本文＋条件","1カラム"],
  ["008","transcript-editor","AI振り返り結果","/visits/:id/review","Transcript5列と6領域の分析7列を根拠同期で表示する。","根拠発話選択、分析領域選択、確認完了","assessor / educator","良かった点、改善点、Talk、法令、次回助言、再訪可能性","5＋7列","根拠＋結果","1カラム"],
  ["009","review-result","振り返り履歴","/reviews","履歴一覧8.5列と結果Detail3.5列。戻り位置を保持する。","期間検索、履歴選択、結果を開く","assessor / manager / educator","振り返り履歴","一覧8.5＋Detail3.5列","一覧＋詳細","カード縮退"],
  ["010","history","切り返しトーク","/knowledge/talks","Category3列、Result4列、Detail5列。1,156件へ接続する。","IME検索、カテゴリ選択、結果選択、詳細確認","assessor / manager / educator","切り返しトーク全件","3＋4＋5列","Detail上段＋Category/Result下段","段階表示"],
  ["011","talk-search","困ったときのフロー","/knowledge/flows","状況カテゴリ3列、159件一覧4列、手順詳細5列。","検索、状況選択、手順展開","assessor / manager / educator","困ったときのフロー全件","3＋4＋5列","Detail上段＋Category/Result下段","段階表示"],
  ["012","reference-search","用語・価格","/knowledge/reference","用語／価格Tab、Table7列、Detail5列。107件／76件へ接続する。","Tab切替、検索、行選択、詳細確認","assessor / manager / educator","用語集、金券価格表","Table7＋Detail5列","一覧＋詳細","カード縮退"],
  ["013","training","マニュアル・法務","/knowledge/manuals","目次3列、一覧3列、Reader6列。版と注意を読み落とさせない。","検索、目次選択、本文閲覧","assessor / manager / educator","manual 6件、legal 4件","3＋3＋6列","Reader上段＋目次/一覧下段","1カラム"],
  ["014","user-admin","動画ライブラリ","/training/videos","動画一覧4列、Player・文字版8列。未取得データは匿名サンプルに限定する。","動画選択、再生、文字版閲覧","assessor / educator","動画ライブラリ（実データ未取得）","4＋8列","一覧＋Player","1カラム"],
  ["015","job-admin","AIロールプレイ","/training/roleplay","Scenario3列、自由対話6列、Feedback3列。選択式を主にしない。","シナリオ選択、自由入力送信、観点確認","assessor / educator","roleplay 168件、練習履歴","3＋6＋3列","対話上段＋Scenario/Feedback下段","1カラム"],
  ["016","content-admin","コンテンツ管理","/admin/contents","全8種のTable4列、Editor4列、Preview4列。公開と保存を分離する。","種別切替、選択、編集、下書き保存","manager / educator","全コンテンツ管理","4＋4＋4列","Preview上段＋一覧/Editor下段","一覧24rem＋Editor＋Preview"],
  ["017","retention-delete","利用者・権限","/admin/users","利用者Table8.5列、権限Detail3.5列。変更影響を確定前に示す。","招待、行選択、所属・権限変更、停止","manager / system_admin","スタッフ管理","Table8.5＋Detail3.5列","一覧＋詳細","カード縮退"],
  ["018","audit-incident","システム運用","/admin/operations","Job／保存・削除／監査Tab、Table8列、Detail4列。本文をsystem_adminへ出さない。","Tab切替、再試行、削除要求、request ID確認","manager / system_admin","運用管理","Table8＋Detail4列","一覧＋詳細","カード縮退"],
  ["019","content-approval","コンテンツ承認","/admin/approvals","承認待ち4列、Diff・基準8列。Feature Flag既定OFF。","版選択、基準確認、承認、差戻し","content_approver","公開管理","4＋8列","一覧＋Diff","段階表示"],
  ["020","team-analytics","チーム分析","/admin/analytics","集約指標、Chart7列、同値Table5列。個人順位を作らない。Feature Flag既定OFF。","期間変更、集約値と同値表の確認","manager / educator","成績・利用状況の集約","Chart7＋Table5列","2列","1カラム"],
];

const commonStates = `| initial | 画面骨格と入力可能な初期状態。client保存から業務本文を復元しない。 |
| loading | 見出しとペイン幅を保持し、対象領域だけ静かなskeletonを表示。 |
| empty | 0件と未取得を区別し、条件変更または前工程への導線を表示。 |
| success | 選択、入力、結果、次のactionを同一workspace内で表示。 |
| partial | 利用可能な領域を残し、失敗領域だけ安全な説明と再試行を表示。 |
| failure | 入力を保持し、provider raw errorを出さず復旧導線を表示。 |
| retry | 明示操作で再試行。取得不能な進捗率を数値で偽装しない。 |
| forbidden | 本文を描画せず、所属管理者へ依頼する導線を表示。 |
| deleted | 本文・署名URLを出さず、一覧へ戻す。 |`;

function documentFor(screen) {
  const [id, slug, name, route, intent, actions, roles, poc, pc, tablet, mobile] = screen;
  const feature = id === "019" ? "`content_approval` 既定OFF" : id === "020" ? "`team_analytics` 既定OFF" : "なし";
  const isAuth = id === "001";
  const desktopGrid = isAuth ? "全幅canvas、中央368px Card、業務Shellなし" : "240px Sidebar、64px Header、32px gutter、12列・24px gap";
  const tabletGrid = isAuth ? "全幅canvas、中央368px Card、railなし" : "72px rail、24px gutter、8列";
  const mobileGrid = isAuth ? "16px gutter、中央Card、bottom navigationなし" : "16px gutter、1列、bottom navigation";
  const semanticTree = isAuth ? `main.auth-page
└─ section[aria-labelledby="login-title"]
   └─ div.login-card
      ├─ h1#login-title
      ├─ p
      ├─ a[Googleログイン]
      └─ a[ログイン支援]` : `AppShell
├─ aside[aria-label="メインナビゲーション"]
├─ header[role=banner]
└─ main#main-content
   ├─ header.page-title > h1
   ├─ nav.secondary-navigation（対象領域のみ）
   └─ section.workspace
      ├─ filter / list / source pane
      ├─ result / editor / conversation pane
      └─ detail / evidence / action pane`;
  const tableRule = isAuth ? "- 認証画面には業務Table、Sidebar、Header、Bottom Navigationを表示しない。" : "- PCのTableはMobileでlabel-value cardまたは段階表示へ縮退する。";
  return `# SCR-${id} ${name}

## 1. Context / 実装正本

- Canonical route: \`${route}\`
- 利用者: ${roles}
- Feature flag: ${feature}
- 実装: \`apps/web/src/features/web/Experience.tsx\` の専用component
- HTML: Next.js 16 App Routerが生成するsemantic HTML。local visual modeはstatic adapter、本番modeは認証付き\`/api/v1\` adapterへ接続する。
- この版は旧「案件管理中心・mobile-first」の画面定義を置き換える。旧RouteはNext.js redirectで互換維持する。

## 2. 目的とApple Webデザイン意図

${intent}

- Apple製品の外観は複製せず、Mac向け業務Webの静かな階層、即時反応、読みやすさを適用する。
- 業務画面にSCR ID、role/state、fixture、PoC、接続modeなどの開発情報を表示しない。
- 主要操作を一つにし、カードの大型縦積み、説明hero、過剰な余白、glass多重化を行わない。

## 3. 寸法付きレイアウト

| Viewport | Grid | 配置 |
| --- | --- | --- |
| PC \`1440×900\` | ${desktopGrid} | ${pc} |
| Tablet \`834×1112\` | ${tabletGrid} | ${tablet} |
| Smartphone \`390×844\` | ${mobileGrid} | ${mobile} |

- PC最小幅は1024px。PCではBottom Navigation、Sheet、Drawerを使わない。
- 200% zoom、safe area、software keyboard、縦横回転で横スクロールを生まない。

## 4. Semantic structure / component tree

\`\`\`text
${semanticTree}
\`\`\`

- DOM見出し階層と視覚階層を一致させ、各入力はvisible labelまたはaccessible nameを持つ。
${tableRule}

## 5. 表示・入力・操作

| 区分 | 詳細 |
| --- | --- |
| 優先情報 | ${intent} |
| 主要操作 | ${actions} |
| 入力 | 日本語IME composition中は検索確定しない。textareaは明示labelを持つ。 |
| 実行条件 | 必須値、権限、対象の存在、二重送信状態を確認して有効化する。 |
| 結果 | 同じworkspace内へinline表示し、選択位置とfocusを保持する。 |

全button/linkは44×44 CSS px以上、pointerdownで120ms以内のpress feedback、実行はclick/touch-upで確定する。DialogはEscape、focus trap、close後focus restoreを必須とする。

## 6. 9共通状態

| 状態 | 表示・復旧 |
| --- | --- |
${commonStates}

## 7. Role / capability / feature flag

- 許可role: ${roles}。画面表示とAPI/DB RLSの両方で同じcapabilityを強制する。
- \`system_admin\`には案件本文、録音、文字起こし、AI本文を表示しない。
- Feature flagはnavigation、route、操作の三箇所で閉じ、client flagを認可として扱わない。

## 8. Data / adapter boundary

- local visual modeは匿名訪問fixtureとdeterministic adapterを使用する。本番modeは\`ApiClient\`と\`RemoteContentRepository\`から\`/api/v1\`へ接続し、失敗時にfixtureへfallbackしない。
- コンテンツはlocal visual modeでは軽量index・型別chunk、本番modeではCloud SQLへimport済みのPoC 1,676件をAPI経由で読む。
- 正式API DTO、エラーコード、監査eventはDLV-043、DLV-044、\`packages/contracts\`、OpenAPIを正とする。未受領の正式PDF項目や法務policyは仮値のまま分離する。
- PDF正式項目、録音同意文、保存期間、承認基準は仮表示であり、法務承認済みと表示しない。

## 9. Transition / exception

- ログイン後はAI支援ホームへ入り、Global Navigationから訪問支援、振り返り、現場の知識、研修へ到達する。
- 戻る・取消で入力を黙って破棄しない。未保存変更がある場合は離脱確認を行う。
- 403は本文非表示、404/削除済みは一覧復帰、部分失敗は成功領域を残す。

## 10. Motion / accessibility

- 通常遷移120/220ms、panel 320ms。bounce、confetti、偽のprogressを禁止する。
- \`prefers-reduced-motion\`では移動量をなくしopacity中心、\`prefers-reduced-transparency\`ではchromeを不透明化、\`prefers-contrast\`では境界とfocusを強調する。
- 色だけで状態を表さず、text・icon・形状を併用する。keyboard順は視覚順と一致させる。

## 11. PoC対応

- 継承: ${poc}
- 非継承: PoCの単一HTML、DOM、CSS class、inline style、ページ切替JavaScript、絵文字依存、共通password、API key UI、公開Drive URL。
- 現在の本画面はPoC要素をスクラッチ情報設計へ再配置する。

## 12. テストシナリオ

| ID | Given / When / Then |
| --- | --- |
| SCR${id}-T01 | Given 許可role, When canonical routeへ入る, Then h1と主要workspaceが表示される。 |
| SCR${id}-T02 | Given PC 1440px, When success表示, Then ${pc}が成立しBottom Navigationは非表示。 |
| SCR${id}-T03 | Given 390px, When同じ操作, Then横スクロールなしで機能欠落なく完了できる。 |
| SCR${id}-T04 | Given failure/partial/forbidden, When表示, Then本文漏えいなく復旧導線を示す。 |
| SCR${id}-T05 | Given keyboard/reduced motion, When主要操作, Thenfocusが可視で順序・結果を理解できる。 |

## 13. HITL受入条件

- [ ] 1440pxで業務上必要な比較対象が同時に見える。
- [ ] ${actions}が実際に操作でき、次Routeへ到達する。
- [ ] user-facing画面に開発メタ情報がない。
- [ ] PoC継承要素「${poc}」を画面から利用できる。
- [ ] 実装と本書のroute、文言、状態、ペイン構成にdriftがない。
`;
}

for (const screen of screens) {
  const [id, slug] = screen;
  await writeFile(resolve(screensDir, `SCR-${id}-${slug}.md`), documentFor(screen));
}

const screenRows = screens.map(([id,,name,route,,,,,pc]) => `| SCR-${id} | ${name} | \`${route}\` | ${pc} |`).join("\n");

await writeFile(resolve(docsRoot, "05-screen-design/DLV-040-screen-design-index.md"), `# DLV-040 画面設計書 — PC/Web再構築版

## 正本条件

- 基準: PC 1440×900、240px Sidebar、64px Header、12列・24px gap。
- Tablet: 72px rail・8列。Mobile: 768px未満・1列・Bottom Navigation。
- 全20画面は \`apps/web/src/features/web/Experience.tsx\` と1:1対応する。
- local visual modeと本番API modeを分離し、Backend/DB/Worker/IaCをローカル実装済み。GCP apply/deployは未実施。

## 全画面

| SCR | 画面 | Canonical route | PC構成 |
| --- | --- | --- | --- |
${screenRows}

## 共通品質契約

- 業務画面へ開発メタ情報を表示しない。
- PCは比較対象を2〜3ペインで同時表示し、大型カード縦積みを主構成にしない。
- 9共通状態、role/capability、feature flag、keyboard、focus、reduced preferencesを全画面で扱う。
- 1,676件のContent IDはlocal visual modeでは軽量index/型別chunk、本番modeでは\`RemoteContentRepository\`から取得する。
`);

await writeFile(resolve(docsRoot, "05-screen-design/DLV-041-screen-transition.md"), `# DLV-041 画面遷移図 — PC/Web再構築版

\`\`\`mermaid
flowchart LR
  L["SCR-001 ログイン"] --> H["SCR-002 AI支援ホーム"]
  H --> V["SCR-003 訪問業務"]
  V --> I["SCR-004 PDF取込"] --> P["SCR-005 訪問前チェック"] --> T["SCR-006 録音・文字起こし"] --> RI["SCR-007 振り返り入力"] --> RR["SCR-008 AI振り返り結果"]
  H --> RH["SCR-009 振り返り履歴"] --> RR
  H --> K1["SCR-010 切り返しトーク"]
  K1 <--> K2["SCR-011 困ったときのフロー"]
  K2 <--> K3["SCR-012 用語・価格"]
  K3 <--> K4["SCR-013 マニュアル・法務"]
  H --> RP["SCR-015 AIロールプレイ"]
  RP <--> VD["SCR-014 動画ライブラリ"]
  H --> C["SCR-016 コンテンツ管理"]
  C --> U["SCR-017 利用者・権限"] --> O["SCR-018 システム運用"]
  C -. flag .-> A["SCR-019 コンテンツ承認"]
  O -. flag .-> AN["SCR-020 チーム分析"]
\`\`\`

## 旧Route互換

| 旧Route | Canonical route |
| --- | --- |
| \`/visits/:id/document\` | \`/visits/:id/import\` |
| \`/visits/:id/recording\`, \`/transcription/status\`, \`/transcript\` | \`/visits/:id/transcription\` |
| \`/history\` | \`/reviews\` |
| \`/contents/talks\` | \`/knowledge/talks\` |
| \`/contents/reference\` | \`/knowledge/reference\` |
| \`/training\` | \`/training/roleplay\` |
| \`/admin/jobs\`, \`/admin/retention\`, \`/admin/audit\` | \`/admin/operations?tab=...\` |
| \`/admin/content-approvals\` | \`/admin/approvals\` |

全旧RouteはNext.js temporary redirectでcanonical URLへ遷移する。
`);

await writeFile(resolve(docsRoot, "90-traceability/UI-IMPLEMENTATION-COVERAGE.md"), `# 全画面HTML実装カバレッジ — PC/Web再構築版

| 項目 | 結果 |
| --- | ---: |
| Canonical SCR / Route | 20 / 20 |
| 旧Route redirect | 12 / 12 |
| 共通UI状態 | 9 / 9 |
| PoCコンテンツ | 1,676 / 1,676 |
| Content ID get検証 | 1,676 / 1,676 |
| Desktop / Tablet / Mobile画像 | 60 / 60 |
| Feature default OFF | SCR-019 / SCR-020 |
| User-facing開発メタ情報 | 0件 |

| SCR | Route | HTML component | 主データ |
| --- | --- | --- | --- |
${screens.map(([id,,name,route]) => `| ${id} | \`${route}\` | WebExperience / ${name} | ${["010","011","012","013","015","016"].includes(id) ? "Static/Remote ContentRepository" : "匿名fixture/API resource"} |`).join("\n")}

Backend、DB、Worker、本番container/IaCはローカル実装済み。GCP apply、GitHub push、deployは未実施。最終GateはHTML/Backend HITL待ち。
`);

await writeFile(resolve(docsRoot, "90-traceability/POC-PARITY.md"), `# PoC機能・コンテンツ対応／移行台帳 — PC/Web接続版

## 機能対応

| PoC機能 | 新画面 | 本画面からの利用 |
| --- | --- | --- |
| staff/admin login | SCR-001 | Googleログイン操作からホームへ遷移可能 |
| home AI support | SCR-002 | 全Content indexを検索し根拠Detailを表示 |
| PDF visit check | SCR-004/005 | 原本確認、顧客心理、法令4項目、Talk、Q&Aを表示 |
| review input / analysis / history | SCR-007/008/009 | 直接入力、6分析領域、履歴Detailを操作可能 |
| talk | SCR-010 | 1,156件を検索・一覧・詳細表示 |
| flow | SCR-011 | 159件を検索・一覧・手順表示 |
| glossary / price | SCR-012 | 107件 / 76件をTab・Table・Detail表示 |
| manual / legal | SCR-013 | 6件 / 4件をReader表示 |
| video | SCR-014 | 実データ0件。匿名研修サンプルのみ、未取得を維持 |
| roleplay | SCR-015 | 168件から選択し自由入力Chatを操作可能 |
| content administration | SCR-016 | 8種別を一覧・編集・Preview可能 |
| score / usage | SCR-020 | 店舗集約のみ。個人rank・人事評価なし |

## 件数・完全性

| Type | 件数 | UI接続 |
| --- | ---: | --- |
| talk | 1,156 | index＋talk chunk |
| flow | 159 | index＋flow chunk |
| glossary | 107 | index＋glossary chunk |
| price | 76 | index＋price chunk |
| manual | 6 | index＋manual chunk |
| legal | 4 | index＋legal chunk |
| roleplay | 168 | index＋roleplay chunk |
| video | 0 | 未取得 |
| **Total** | **1,676** | **全ID取得検証済み** |

- \`legacy_id\`重複0、必須欠損0。同一原文hash 69種は削除せず移行判断対象として保持する。
- 未取得: 端末localStorage動画、localStorage追加manual、Google Sheets / GAS外部データ。推測補完しない。
- PoC DOM/CSS/inline JavaScript、共通password、API key UI、公開Drive URLは移行しない。
`);

console.log(`Synchronized ${screens.length} screen documents and cross-screen indexes.`);
