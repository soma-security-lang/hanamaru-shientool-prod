/** Validation of optional English suggestions; no lookup, translation or I/O. */
export function validateEnglishMarketQueries(keywords: readonly string[], modelNumber: string | null): void {
  const normalized = (value: string) => value.normalize("NFKC").toLowerCase();
  const modelCharacters = modelNumber?.trim() ? [...normalized(modelNumber).replace(/[^\p{L}\p{N}]/gu, "")] : [];
  const protectedModel = modelCharacters.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])${modelCharacters.map(character=>character.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("[\\s._/-]*")}(?=$|[^\\p{L}\\p{N}])`,"u") : null;
  if (!keywords.length || keywords.length > 3) throw new Error("PROVIDER_PERMANENT: market English query count is invalid");
  for (const keyword of keywords) {
    if (!/[a-z]/iu.test(keyword) || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(keyword.replace(modelNumber ?? "", ""))) {
      throw new Error("PROVIDER_PERMANENT: market English query language is invalid");
    }
    if (protectedModel && !protectedModel.test(normalized(keyword))) {
      throw new Error("PROVIDER_PERMANENT: market English query changed the supplied model");
    }
  }
}

export const ENGLISH_MARKET_QUERY_INSTRUCTION = "検索語はeBay向け英語で最大3件。型番・容量・地域仕様・世代・付属品を翻訳で変更・補完しない。利用者の型番は必ずそのまま保持する。市場別の翻訳や外部検索は行わず、同じ1本を利用者が選ぶための候補だけを返す。";
