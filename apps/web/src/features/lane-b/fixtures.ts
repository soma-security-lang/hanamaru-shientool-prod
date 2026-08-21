export type TranscriptSpeaker = "staff" | "customer" | "unknown";

export interface TranscriptSegmentFixture {
  id: string;
  start: string;
  end: string;
  speaker: TranscriptSpeaker;
  text: string;
  needsReview?: boolean;
}

export const transcriptFixture = {
  duration: "18:24",
  version: 2,
  segments: [
    {
      id: "segment-demo-1",
      start: "00:04",
      end: "00:16",
      speaker: "staff",
      text: "本日はお時間をいただきありがとうございます。まず訪問の目的からご説明します。",
    },
    {
      id: "segment-demo-2",
      start: "00:18",
      end: "00:31",
      speaker: "customer",
      text: "今日は査定だけお願いしたいのですが、大丈夫でしょうか。",
      needsReview: true,
    },
    {
      id: "segment-demo-3",
      start: "00:33",
      end: "00:48",
      speaker: "staff",
      text: "承知しました。金額と根拠をご説明したうえで、売却するかどうかはご自身でお決めいただけます。",
    },
  ] satisfies TranscriptSegmentFixture[],
} as const;

export type ReviewTone = "strength" | "improvement" | "advice";

export interface ReviewFindingFixture {
  id: string;
  tone: ReviewTone;
  title: string;
  body: string;
  evidence: string;
  time: string;
}

export const reviewFixture = {
  summary: "説明の順序は明確でした。次回は確認質問を一つずつ区切ると、さらに安心感につながります。",
  findings: [
    {
      id: "review-demo-1",
      tone: "strength",
      title: "訪問目的を最初に説明できた",
      body: "話を始める前に、今日行うことと決定権がお客様にあることを伝えています。",
      evidence: "まず訪問の目的からご説明します。",
      time: "00:04",
    },
    {
      id: "review-demo-2",
      tone: "improvement",
      title: "確認質問を一つずつ区切る",
      body: "複数の質問を続けず、回答を待ってから次へ進むと確認しやすくなります。",
      evidence: "確認したい点が二つあります。",
      time: "05:12",
    },
    {
      id: "review-demo-3",
      tone: "advice",
      title: "次回は選択肢を先に示す",
      body: "査定のみ、持ち帰って検討、売却の三つを先に伝える練習をします。",
      evidence: "売却するかどうかはご自身でお決めいただけます。",
      time: "00:33",
    },
  ] satisfies ReviewFindingFixture[],
} as const;

export interface HistoryItemFixture {
  id: string;
  date: string;
  label: string;
  status: "確認待ち" | "完了" | "一部完了";
  theme: string;
  nextAction: string;
  detail: string;
}

export const historyFixtures: HistoryItemFixture[] = [
  {
    id: "history-demo-1",
    date: "2026-08-11",
    label: "訪問案件 DEMO-011",
    status: "確認待ち",
    theme: "説明の順序",
    nextAction: "振り返りを確認",
    detail: "文字起こしは確定済みです。振り返り結果の確認が残っています。",
  },
  {
    id: "history-demo-2",
    date: "2026-08-10",
    label: "訪問案件 DEMO-010",
    status: "完了",
    theme: "傾聴",
    nextAction: "内容を開く",
    detail: "すべての確認が完了しています。本文は個別画面でのみ表示します。",
  },
  {
    id: "history-demo-3",
    date: "2026-08-08",
    label: "訪問案件 DEMO-008",
    status: "一部完了",
    theme: "金額根拠",
    nextAction: "文字起こしを修正",
    detail: "音声は処理済みですが、要確認の発話区間が一件あります。",
  },
];

export type KnowledgeKind = "talk" | "flow" | "manual" | "legal";

export interface KnowledgeItemFixture {
  id: string;
  kind: KnowledgeKind;
  kindLabel: string;
  title: string;
  summary: string;
  body: string[];
  version: string;
  effective: string;
  keywords: string[];
}

export const knowledgeFixtures: KnowledgeItemFixture[] = [
  {
    id: "knowledge-talk-1",
    kind: "talk",
    kindLabel: "トーク",
    title: "他店と金額を比較されたとき",
    summary: "違いを否定せず、査定根拠と選択肢を順番に伝えます。",
    body: ["比較して検討されることは自然です。", "当店の金額は状態と相場の確認結果をもとにご説明します。"],
    version: "3",
    effective: "2026-08-01",
    keywords: ["比較", "金額", "切り返し"],
  },
  {
    id: "knowledge-flow-1",
    kind: "flow",
    kindLabel: "接客フロー",
    title: "盗品の疑いがある場合",
    summary: "査定を止め、責任者へ連絡するまでの手順です。",
    body: ["取引を確定しない。", "品物と状況を安全な範囲で記録する。", "責任者へ連絡する。"],
    version: "2",
    effective: "2026-07-15",
    keywords: ["盗品", "責任者", "停止"],
  },
  {
    id: "knowledge-manual-1",
    kind: "manual",
    kindLabel: "マニュアル",
    title: "訪問開始時の基本手順",
    summary: "本人確認、目的説明、同意確認の順で進めます。",
    body: ["所属と氏名を伝える。", "訪問目的と所要時間を伝える。", "録音を行う場合は別途説明する。"],
    version: "5",
    effective: "2026-08-01",
    keywords: ["訪問", "開始", "本人確認"],
  },
  {
    id: "knowledge-legal-1",
    kind: "legal",
    kindLabel: "法務・重要注意",
    title: "クーリングオフの説明",
    summary: "承認済みの説明手順と問い合わせ先を確認します。",
    body: ["適用条件を決めつけず、承認済み文面に沿って説明する。", "判断が必要な場合は法務・責任者へ確認する。"],
    version: "4",
    effective: "2026-08-01",
    keywords: ["クーリングオフ", "法務", "説明"],
  },
];

export interface GlossaryFixture {
  id: string;
  term: string;
  definition: string;
  related: string[];
  source: string;
  version: string;
}

export interface VoucherPriceFixture {
  id: string;
  name: string;
  issuer: string;
  referenceValue: string;
  unit: string;
  conditions: string;
  effective: string;
  source: string;
}

export const glossaryFixtures: GlossaryFixture[] = [
  { id: "glossary-demo-1", term: "比重", definition: "同じ体積における物質の重さを比較するための値です。", related: ["密度", "品位"], source: "研修資料・承認版", version: "2" },
  { id: "glossary-demo-2", term: "刻印", definition: "素材、品位、製造元などを示すため品物に付された表示です。", related: ["品位", "ホールマーク"], source: "用語集・承認版", version: "3" },
  { id: "glossary-demo-3", term: "インゴット", definition: "精製した金属を一定の形に固めた地金です。", related: ["地金", "品位"], source: "用語集・承認版", version: "3" },
];

export const voucherPriceFixtures: VoucherPriceFixture[] = [
  { id: "voucher-demo-1", name: "サンプル百貨店共通商品券", issuer: "発行元A", referenceValue: "額面の90%", unit: "1枚", conditions: "未使用・破損なし", effective: "2026-08-11", source: "価格表・承認版 2026.08" },
  { id: "voucher-demo-2", name: "サンプルギフトカード", issuer: "発行元B", referenceValue: "額面の88%", unit: "1枚", conditions: "未使用・番号確認済み", effective: "2026-08-11", source: "価格表・承認版 2026.08" },
  { id: "voucher-demo-3", name: "サンプルプリペイドカード", issuer: "発行元C", referenceValue: "額面の80%", unit: "1枚", conditions: "未使用・有効期限内", effective: "2026-08-11", source: "価格表・承認版 2026.08" },
];

export interface TrainingScenarioFixture {
  id: string;
  title: string;
  objective: string;
  customerMessage: string;
  choices: { id: string; label: string; feedback: string; recommended: boolean }[];
}

export const trainingFixtures = {
  scenarios: [
    {
      id: "training-demo-1",
      title: "今日は査定だけのお客様",
      objective: "決定権がお客様にあることを先に伝える練習です。",
      customerMessage: "今日は査定だけって電話でも伝えたと思うんですが。",
      choices: [
        { id: "choice-1", label: "承知しました。金額と根拠だけご説明します。", feedback: "希望を受け止め、次に行うことを具体的に伝えています。", recommended: true },
        { id: "choice-2", label: "せっかくなので、まず売却の手続きを進めましょう。", feedback: "お客様の希望より手続きを優先しています。選択肢を先に伝えましょう。", recommended: false },
      ],
    },
    {
      id: "training-demo-2",
      title: "他店の金額と比較したいお客様",
      objective: "比較を否定せず、査定根拠を順序立てて伝えます。",
      customerMessage: "他のお店の金額も見てから決めたいです。",
      choices: [
        { id: "choice-3", label: "もちろんです。当店の金額と根拠からご説明します。", feedback: "比較の意思を尊重し、説明へ自然につなげています。", recommended: true },
        { id: "choice-4", label: "今決めていただければ、この金額にします。", feedback: "決定を急かす表現です。持ち帰って検討できることを伝えましょう。", recommended: false },
      ],
    },
  ] satisfies TrainingScenarioFixture[],
  videos: [
    { id: "video-demo-1", title: "訪問時の第一声", duration: "03:00", captions: true, description: "所属、目的、所要時間を短く伝える例です。" },
    { id: "video-demo-2", title: "金額根拠の伝え方", duration: "05:20", captions: true, description: "状態と相場を分けて説明する手順です。" },
  ],
  history: [
    { id: "progress-demo-1", title: "他店の金額と比較したいお客様", status: "完了", updated: "2026-08-10", next: "査定根拠を短く伝える" },
    { id: "progress-demo-2", title: "今日は査定だけのお客様", status: "学習中", updated: "2026-08-08", next: "選択肢を先に伝える" },
  ],
} as const;
