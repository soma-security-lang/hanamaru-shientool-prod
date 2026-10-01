import type {ScreenSpec} from "@/lib/prototype/types";

export const expenseScreens:ScreenSpec[]=[{
  id:"SCR-022",name:"経費・車両金精算",eyebrow:"日次記録",
  summary:"支出を確認して日次へ集計し、未補充など次の担当が必要な事項を残します。",
  routes:["/expense-settlement"],kind:"expense",roles:["assessor","manager"],featureFlag:"expense_settlement",
  primaryAction:"支出を記録",secondaryAction:"日次と未完了事項を見る",pocElements:[],metrics:[],sections:[],
}];
