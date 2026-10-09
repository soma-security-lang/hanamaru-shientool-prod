import type { EbayCondition, EbayObservation, EbayObservationDecision } from "@hanamaru/contracts";

export interface EbayProductBasis {
  keyword: string;
  modelNumber: string | null;
}
export const EBAY_PRODUCT_MATCH_VERSION = "1.1.0";
const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function modelPresent(title: string, model: string): boolean {
  const characters = [...normalized(model).replace(/[^\p{L}\p{N}]/gu, "")];
  if (characters.length < 2) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${characters.map(escaped).join("[\\s._/-]*")}(?=$|[^\\p{L}\\p{N}])`, "u").test(title);
}
function capacities(text: string): string[] {
  return [...text.matchAll(/(?:^|[^\p{L}\p{N}])(\d+(?:\.\d+)?)\s*(tb|gb)(?=$|[^\p{L}\p{N}])/gu)]
    .map(match => String(Number(match[1]) * (match[2] === "tb" ? 1024 : 1))).sort();
}
const accessory = /(?:\b(?:case|cover|charger|battery|strap|manual|replacement|spare|adapter)\b|ケース|カバー|充電器|バッテリー|ストラップ|説明書|交換部品)/u;
const only = /(?:\b(?:box only|empty box|parts only|body cap|lens cap)\b|箱のみ|空箱|部品のみ|キャップのみ)/u;
const bundle = /(?:\b(?:bundle|kit|lot of|set of)\b|セット|まとめ売り)/u;
const regions = (text: string) => [...text.matchAll(/\b(us|usa|uk|eu|jp|japan|international)\s+(?:version|model|edition)\b/gu)]
  .map(match => match[1] === "usa" ? "us" : match[1] === "japan" ? "jp" : match[1]);
const romanGenerations: Readonly<Record<string, number>> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
function generations(text: string): number[] {
  const values: number[] = [];
  // Only explicit generation markers are evidence; never infer a generation
  // from an unrelated number, seller country or a bare Roman numeral.
  for (const match of text.matchAll(/\b(?:mark|mk|gen|generation|génération|generación|generazione)\s*[._-]?\s*(\d{1,2}|viii|vii|iii|vi|iv|ii|ix|i|v|x)(?=$|[^\p{L}\p{N}])/gu)) {
    const value = romanGenerations[match[1]!] ?? Number(match[1]);
    if (value > 0 && value <= 99) values.push(value);
  }
  for (const match of text.matchAll(/第\s*(\d{1,2})\s*世代/gu)) {
    const value = Number(match[1]);
    if (value > 0) values.push(value);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Deterministic title evidence only. Never infer product facts from location or price. */
export function assessEbayProduct(observation: EbayObservation, basis: EbayProductBasis,
  selectedConditions: readonly EbayCondition[] = []): NonNullable<EbayObservationDecision["productMatch"]> {
  const title = normalized(observation.title), expected = normalized(basis.keyword);
  const mismatch: string[] = [], unknown: string[] = [];
  const inferred = expected.split(/\s+/u).filter(token => /\p{L}/u.test(token) && /\d/u.test(token) && !/^\d+(?:\.\d+)?(?:tb|gb)$/u.test(token));
  const models = basis.modelNumber?.trim() ? [basis.modelNumber] : inferred;
  if (models.length) {
    if (models.some(model => !modelPresent(title, model))) mismatch.push("model_not_matched");
  } else {
    const words = expected.split(/\s+/u).filter(word => word.length >= 2);
    if (!words.length || !words.every(word => title.includes(word))) unknown.push("product_identity_unknown");
  }
  if ((only.test(title) && !only.test(expected)) ||
    (accessory.test(title) && !accessory.test(expected) && /(?:\bfor\b|用|対応|compatible)/u.test(title))) mismatch.push("accessory_only");
  if (bundle.test(title) && !bundle.test(expected)) mismatch.push("unexpected_bundle");
  if (bundle.test(expected) && !bundle.test(title)) unknown.push("bundle_contents_unknown");
  const wantedGeneration = generations(expected), actualGeneration = generations(title);
  if (wantedGeneration.length) {
    if (!actualGeneration.length) unknown.push("generation_unknown");
    else if (JSON.stringify(wantedGeneration) !== JSON.stringify(actualGeneration)) mismatch.push("generation_mismatch");
  } else if (actualGeneration.length) unknown.push("generation_unconfirmed");
  const wantedCapacity = capacities(expected), actualCapacity = capacities(title);
  if (wantedCapacity.length) {
    if (!actualCapacity.length) unknown.push("capacity_unknown");
    else if (JSON.stringify(wantedCapacity) !== JSON.stringify(actualCapacity)) mismatch.push("capacity_mismatch");
  }
  const wantedRegion = regions(expected), actualRegion = regions(title);
  if (wantedRegion.length) {
    if (!actualRegion.length) unknown.push("region_unknown");
    else if (JSON.stringify(wantedRegion.sort()) !== JSON.stringify(actualRegion.sort())) mismatch.push("region_mismatch");
  }
  if (selectedConditions.length) {
    if (observation.conditionGroup === "unknown") unknown.push("condition_unknown");
    else if (!selectedConditions.includes(observation.conditionGroup)) mismatch.push("condition_mismatch");
  }
  return { status: mismatch.length ? "mismatch" : unknown.length ? "unknown" : "matched",
    reasons: [...mismatch, ...unknown], version: EBAY_PRODUCT_MATCH_VERSION };
}
