import type { ScreenSpec } from "@/lib/prototype/types";

const common = { metrics: [], sections: [] };

export const laneAScreens: ScreenSpec[] = [
  { ...common, id: "SCR-001", name: "ログイン", eyebrow: "", kind: "auth", routes: ["/login"], roles: ["assessor", "manager", "educator", "content_approver", "system_admin"], summary: "Googleアカウントで安全に業務へ入ります。", primaryAction: "Googleでログイン", pocElements: ["スタッフログイン", "権限分岐"] },
  { ...common, id: "SCR-002", name: "買取支援AI", eyebrow: "", kind: "aiHome", routes: ["/"], roles: ["assessor", "manager", "educator", "content_approver", "system_admin"], summary: "質問から現場知識と次の業務へ到達します。", primaryAction: "質問を送る", pocElements: ["ホームAI支援", "知識導線"] },
  { ...common, id: "SCR-003", name: "訪問支援", eyebrow: "", kind: "visitList", routes: ["/visits"], roles: ["assessor", "manager", "educator"], summary: "PDFから訪問を登録し、準備から振り返りまで確認します。", primaryAction: "PDFから訪問を登録", pocElements: ["訪問前チェック"] },
  { ...common, id: "SCR-004", name: "PDFから訪問を登録", eyebrow: "", kind: "visitImport", routes: ["/visits/:id/import"], roles: ["assessor", "manager"], summary: "PDF原本と抽出項目を並べて確認します。", primaryAction: "内容を確定", pocElements: ["訪問前PDF"] },
  { ...common, id: "SCR-005", name: "訪問前チェック", eyebrow: "", kind: "visitPreparation", routes: ["/visits/:id/preparation"], roles: ["assessor", "manager"], summary: "訪問前に顧客心理、法令、トーク、Q&Aを確認します。", primaryAction: "準備を完了", pocElements: ["顧客情報", "想定心理", "法令4項目", "想定トーク", "想定Q&A"] },
  { ...common, id: "SCR-006", name: "録音・文字起こし", eyebrow: "", kind: "transcription", routes: ["/visits/:id/transcription"], roles: ["assessor", "manager"], summary: "録音取込と文字起こしを一つの作業面で扱います。", primaryAction: "文字起こしを確定", pocElements: ["録音読込", "文字起こし"] },
  { ...common, id: "SCR-007", name: "振り返りを作成", eyebrow: "", kind: "reviewInput", routes: ["/visits/:id/review/input"], roles: ["assessor", "educator"], summary: "本文と分析条件を確認して振り返りを開始します。", primaryAction: "AI振り返りを作成", pocElements: ["振り返り入力", "録音選択"] },
];
