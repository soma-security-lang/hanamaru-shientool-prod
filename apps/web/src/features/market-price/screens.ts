import type {ScreenSpec} from "@/lib/prototype/types";

export const marketPriceScreens:ScreenSpec[]=[{
  id:"SCR-021",
  name:"買取相場（仮）",
  eyebrow:"相場確認",
  summary:"商品を特定し、直近90日の落札候補から買取判断に使う相場を確定します。",
  routes:["/market-price"],
  kind:"marketPrice",
  roles:["assessor","manager"],
  featureFlag:"market_price_search",
  primaryAction:"相場を調べる",
  secondaryAction:"検索履歴を見る",
  pocElements:[],
  metrics:[],
  sections:[],
}];
