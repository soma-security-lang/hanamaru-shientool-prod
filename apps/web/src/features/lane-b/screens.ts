import type { ScreenSpec } from "@/lib/prototype/types";

const common = { metrics: [], sections: [] };

export const laneBScreens: ScreenSpec[] = [
  { ...common, id: "SCR-008", name: "AI振り返り結果", eyebrow: "", kind: "reviewResult", routes: ["/visits/:id/review"], roles: ["assessor", "educator"], summary: "発話根拠と6つの分析領域を並べて確認します。", primaryAction: "確認を完了", pocElements: ["良かった点", "改善点", "トーク", "法令", "次回助言", "再訪可能性"] },
  { ...common, id: "SCR-009", name: "振り返り履歴", eyebrow: "", kind: "reviews", routes: ["/reviews"], roles: ["assessor", "manager", "educator"], summary: "過去の振り返りを検索し、結果を見返します。", primaryAction: "検索", pocElements: ["振り返り履歴"] },
  { ...common, id: "SCR-010", name: "切り返しトーク集", eyebrow: "", kind: "talks", routes: ["/knowledge/talks"], roles: ["assessor", "manager", "educator"], summary: "1,156件のトークから状況に合う伝え方を探します。", primaryAction: "検索", pocElements: ["切り返しトーク"] },
  { ...common, id: "SCR-011", name: "困ったときのフロー集", eyebrow: "", kind: "flows", routes: ["/knowledge/flows"], roles: ["assessor", "manager", "educator"], summary: "159件の対応フローを状況から探します。", primaryAction: "検索", pocElements: ["困ったときのフロー集"] },
  { ...common, id: "SCR-012", name: "用語集・金券買取価格表", eyebrow: "", kind: "reference", routes: ["/knowledge/reference"], roles: ["assessor", "manager", "educator"], summary: "用語107件と価格76件を確認します。", primaryAction: "検索", pocElements: ["用語集", "金券価格表"] },
  { ...common, id: "SCR-013", name: "接客マニュアル・法務", eyebrow: "", kind: "manuals", routes: ["/knowledge/manuals"], roles: ["assessor", "manager", "educator"], summary: "接客マニュアルと法務・コンプライアンス情報を版付きで読みます。", primaryAction: "目次を検索", pocElements: ["接客マニュアル", "法務・コンプライアンス"] },
  { ...common, id: "SCR-014", name: "動画ライブラリ", eyebrow: "", kind: "videos", routes: ["/training/videos"], roles: ["assessor", "educator"], summary: "研修動画と文字版を確認します。", primaryAction: "再生", pocElements: ["動画ライブラリ"] },
  { ...common, id: "SCR-015", name: "AIロープレ", eyebrow: "", kind: "roleplay", routes: ["/training/roleplay"], roles: ["assessor", "educator"], summary: "168件のシナリオから自由対話で練習します。", primaryAction: "返信", pocElements: ["AIロールプレイ", "練習履歴"] },
];
