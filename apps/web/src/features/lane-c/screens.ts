import type { ScreenSpec } from "@/lib/prototype/types";

const common = { metrics: [], sections: [] };

export const laneCScreens: ScreenSpec[] = [
  { ...common, id: "SCR-016", name: "コンテンツ管理", eyebrow: "", kind: "contentsAdmin", routes: ["/admin/contents"], roles: ["manager", "educator"], summary: "8種別のコンテンツを一覧、編集、プレビューします。", primaryAction: "下書きを保存", pocElements: ["各コンテンツ管理"] },
  { ...common, id: "SCR-017", name: "利用者・権限", eyebrow: "", kind: "usersAdmin", routes: ["/admin/users"], roles: ["manager", "system_admin"], summary: "利用者、所属、権限、利用状態を管理します。", primaryAction: "利用者を招待", pocElements: ["スタッフ管理"] },
  { ...common, id: "SCR-018", name: "システム運用", eyebrow: "", kind: "operations", routes: ["/admin/operations"], roles: ["manager", "system_admin"], summary: "ジョブ、保存・削除、監査を一つの運用面で確認します。", primaryAction: "状態を更新", pocElements: ["管理操作"] },
  { ...common, id: "SCR-019", name: "コンテンツ承認", eyebrow: "", kind: "approval", routes: ["/admin/approvals"], roles: ["content_approver"], featureFlag: "content_approval", summary: "変更差分と基準を確認して版単位で判断します。", primaryAction: "この版を承認", pocElements: ["公開管理"] },
  { ...common, id: "SCR-020", name: "チーム分析", eyebrow: "", kind: "analytics", routes: ["/admin/analytics"], roles: ["manager", "educator"], featureFlag: "team_analytics", summary: "個人ランキングなしでチームの利用・学習傾向を確認します。", primaryAction: "期間を変更", pocElements: ["成績・利用状況"] },
];
