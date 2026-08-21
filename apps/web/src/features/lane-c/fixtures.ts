export type DemoUser = {
  id: string;
  name: string;
  email: string;
  branch: string;
  role: "assessor" | "manager" | "educator";
  state: "active" | "invited" | "disabled";
  sessions: number;
  activeJobs: number;
};

export const demoUsers: DemoUser[] = [
  { id: "user-demo-a", name: "査定員A", email: "user-a@example.invalid", branch: "中央店", role: "assessor", state: "active", sessions: 2, activeJobs: 1 },
  { id: "user-demo-b", name: "管理者B", email: "user-b@example.invalid", branch: "西店", role: "manager", state: "active", sessions: 1, activeJobs: 0 },
  { id: "user-demo-c", name: "教育担当C", email: "user-c@example.invalid", branch: "東店", role: "educator", state: "invited", sessions: 0, activeJobs: 0 },
];

export type DemoJobStatus = "queued" | "running" | "retry_wait" | "succeeded" | "failed" | "cancelled";

export type DemoJob = {
  id: string;
  type: string;
  entity: string;
  status: DemoJobStatus;
  age: string;
  nextRetry: string | null;
  safeError: string | null;
  attempts: { number: number; result: string; at: string }[];
  requestId: string;
};

export const demoJobs: DemoJob[] = [
  {
    id: "job-demo-8f2a",
    type: "文字起こし",
    entity: "案件 DEMO-101",
    status: "running",
    age: "4分",
    nextRetry: null,
    safeError: null,
    attempts: [{ number: 1, result: "処理中", at: "14:12" }],
    requestId: "req-demo-015-a",
  },
  {
    id: "job-demo-41c0",
    type: "PDF抽出",
    entity: "案件 DEMO-102",
    status: "retry_wait",
    age: "11分",
    nextRetry: "30秒後",
    safeError: "一時的に外部処理へ接続できませんでした。",
    attempts: [
      { number: 2, result: "30秒後に再試行", at: "14:08" },
      { number: 1, result: "一時的な外部障害", at: "14:06" },
    ],
    requestId: "req-demo-015-b",
  },
  {
    id: "job-demo-e913",
    type: "削除",
    entity: "削除要求 DEMO-028",
    status: "queued",
    age: "1分",
    nextRetry: null,
    safeError: null,
    attempts: [],
    requestId: "req-demo-015-c",
  },
];

export const contentKinds = ["talk", "flow", "glossary", "price", "manual", "legal", "video", "roleplay"] as const;
export type ContentKind = (typeof contentKinds)[number];

export type DemoContent = {
  kind: ContentKind;
  label: string;
  title: string;
  body: string;
  version: number;
  state: "draft" | "published";
  source: string;
};

export const demoContents: DemoContent[] = [
  { kind: "talk", label: "トーク", title: "初回訪問の挨拶", body: "訪問目的と所要時間を最初に説明します。", version: 4, state: "draft", source: "トーク管理" },
  { kind: "flow", label: "接客フロー", title: "訪問時の確認順序", body: "本人確認、品物確認、査定説明の順に進めます。", version: 3, state: "published", source: "接客フロー管理" },
  { kind: "glossary", label: "用語", title: "査定基準", body: "価格を決めるために確認する状態や相場の基準です。", version: 2, state: "published", source: "用語管理" },
  { kind: "price", label: "価格", title: "価格参照の注意", body: "価格は参考値です。単位、期間、状態条件を確認します。", version: 5, state: "published", source: "価格管理" },
  { kind: "manual", label: "マニュアル", title: "録音ファイルの登録", body: "同意確認後、対応形式の音声ファイルを登録します。", version: 1, state: "draft", source: "マニュアル管理" },
  { kind: "legal", label: "法令・注意", title: "クーリングオフ説明", body: "正式に承認された説明文だけを利用者へ公開します。", version: 3, state: "published", source: "法令・注意事項管理" },
  { kind: "video", label: "動画", title: "接客研修動画", body: "字幕付きの許可済み外部教材を参照します。", version: 2, state: "published", source: "動画管理" },
  { kind: "roleplay", label: "ロールプレイ", title: "初回訪問シナリオ", body: "架空のお客様設定で説明の順序を練習します。", version: 6, state: "draft", source: "ロールプレイ管理" },
];

export type DemoDeletionRequest = {
  id: string;
  state: "pending" | "held" | "partial";
  target: string;
  count: number;
  hold: boolean;
};

export const demoDeletionRequests: DemoDeletionRequest[] = [
  { id: "DEMO-028", state: "pending", target: "音声・文字起こし", count: 3, hold: false },
  { id: "DEMO-027", state: "held", target: "案件関連データ", count: 5, hold: true },
  { id: "DEMO-026", state: "partial", target: "生成済み振り返り", count: 2, hold: false },
];

export type DemoAuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  result: "成功" | "拒否" | "失敗";
  resource: string;
  requestId: string;
  jobId: string | null;
};

export const demoAuditEvents: DemoAuditEvent[] = [
  { id: "audit-demo-1", at: "14:12", actor: "匿名利用者A", action: "review.read", result: "成功", resource: "review-demo-101", requestId: "req-demo-018-a", jobId: null },
  { id: "audit-demo-2", at: "14:08", actor: "匿名利用者B", action: "transcription.request", result: "成功", resource: "visit-demo-102", requestId: "req-demo-018-b", jobId: "job-demo-8f2a" },
  { id: "audit-demo-3", at: "13:54", actor: "匿名管理者C", action: "role.assign", result: "拒否", resource: "user-demo-a", requestId: "req-demo-018-c", jobId: null },
];

export const approvalFixture = {
  item: "本人確認の説明例",
  version: "v4",
  previousVersion: "v3",
  changes: [
    { type: "追加", text: "説明前に相手の理解を確認する一文" },
    { type: "変更", text: "金額根拠を具体的に伝える表現" },
    { type: "削除", text: "終了済みキャンペーンの案内" },
  ],
  criteria: ["法令表現を確認した", "現場で再現できる", "個人情報を含まない"],
} as const;

export const analyticsFixture = [
  { label: "訪問目的の説明", value: 84, total: 38 },
  { label: "金額根拠の提示", value: 61, total: 38 },
  { label: "クーリングオフ説明", value: 76, total: 38 },
] as const;
