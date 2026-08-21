export type VisitStatus = "準備中" | "文字起こし中" | "確認待ち" | "完了";

export interface VisitFixture {
  id: string;
  caseNumber: string;
  label: string;
  scheduledAt: string;
  branch: string;
  assignee: string;
  status: VisitStatus;
  nextAction: string;
}

export interface ExtractionFieldFixture {
  id: string;
  label: string;
  value: string;
  page: number;
  excerpt: string;
  confidence: number;
  verification: "confirmed" | "unverified" | "corrected";
}

export interface JobEventFixture {
  id: string;
  label: string;
  at: string;
  detail: string;
  tone: "complete" | "current" | "waiting" | "failed";
}

export const visitFixtures: VisitFixture[] = [
  {
    id: "visit-demo-001",
    caseNumber: "DEMO-0811-01",
    label: "訪問先A",
    scheduledAt: "2026-08-11T13:30:00+09:00",
    branch: "東京中央店",
    assignee: "山田",
    status: "準備中",
    nextAction: "PDFの抽出結果を確認",
  },
  {
    id: "visit-demo-002",
    caseNumber: "DEMO-0811-02",
    label: "訪問先B",
    scheduledAt: "2026-08-11T15:00:00+09:00",
    branch: "東京中央店",
    assignee: "山田",
    status: "文字起こし中",
    nextAction: "処理状況を確認",
  },
  {
    id: "visit-demo-003",
    caseNumber: "DEMO-0810-03",
    label: "訪問先C",
    scheduledAt: "2026-08-10T11:00:00+09:00",
    branch: "東京西店",
    assignee: "佐藤",
    status: "確認待ち",
    nextAction: "振り返りを確認",
  },
  {
    id: "visit-demo-004",
    caseNumber: "DEMO-0809-04",
    label: "訪問先D",
    scheduledAt: "2026-08-09T10:30:00+09:00",
    branch: "東京中央店",
    assignee: "山田",
    status: "完了",
    nextAction: "履歴を開く",
  },
];

export const extractionFieldFixtures: ExtractionFieldFixture[] = [
  {
    id: "visit-date",
    label: "訪問予定日時",
    value: "2026-08-11 13:30",
    page: 1,
    excerpt: "訪問予定：2026年8月11日 13時30分",
    confidence: 0.98,
    verification: "confirmed",
  },
  {
    id: "item-category",
    label: "品物カテゴリ",
    value: "要確認",
    page: 2,
    excerpt: "対象品：腕時計ほか（詳細は当日確認）",
    confidence: 0.64,
    verification: "unverified",
  },
  {
    id: "branch",
    label: "担当店舗",
    value: "東京中央店",
    page: 1,
    excerpt: "担当：東京中央店",
    confidence: 0.96,
    verification: "confirmed",
  },
  {
    id: "visit-note",
    label: "事前確認事項",
    value: "本人確認書類を当日確認",
    page: 3,
    excerpt: "当日は本人確認書類をご用意ください。",
    confidence: 0.87,
    verification: "unverified",
  },
];

export const homeQuestions = [
  "査定だけ希望されたときの伝え方は？",
  "録音同意を断られた場合は？",
  "訪問前に確認すべき項目は？",
] as const;

export const homeAnswers: Record<(typeof homeQuestions)[number], string> = {
  "査定だけ希望されたときの伝え方は？":
    "査定のみでも問題ないことを先に伝え、金額の根拠と次の選択肢を短く説明します。判断を急がせないことが重要です。",
  "録音同意を断られた場合は？":
    "録音は行わず、訪問自体は継続できます。同意を得られなかった事実だけを記録し、必要な振り返りは匿名メモで補います。",
  "訪問前に確認すべき項目は？":
    "訪問日時、担当、資料の未確認項目、注意事項を確認します。PDFから抽出した内容は必ず原本の根拠と照合してください。",
};

export const initialJobEvents: JobEventFixture[] = [
  { id: "accepted", label: "受付", at: "14:08", detail: "Jobを受け付けました", tone: "complete" },
  { id: "validated", label: "音声検証", at: "14:08", detail: "形式と保存状態を確認しました", tone: "complete" },
  { id: "retry-wait", label: "自動再試行待ち", at: "14:10", detail: "一時的な混雑のため14:15に再試行します", tone: "current" },
];
