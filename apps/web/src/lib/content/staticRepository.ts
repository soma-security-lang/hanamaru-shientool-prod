import catalog from "@/generated/poc-content/catalog.json";
import searchIndex from "@/generated/poc-content/index.json";
import type { ContentDetail, ContentQuery, ContentRepository, ContentSummary, ContentType } from "./types";

type IndexedContent = ContentSummary & { searchText: string };
const index = searchIndex as IndexedContent[];

const chunkLoaders: Record<ContentType, () => Promise<unknown>> = {
  talk: () => import("@/generated/poc-content/talk.json"),
  flow: () => import("@/generated/poc-content/flow.json"),
  glossary: () => import("@/generated/poc-content/glossary.json"),
  price: () => import("@/generated/poc-content/price.json"),
  manual: () => import("@/generated/poc-content/manual.json"),
  legal: () => import("@/generated/poc-content/legal.json"),
  video: () => import("@/generated/poc-content/video.json"),
  roleplay: () => import("@/generated/poc-content/roleplay.json"),
};

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}

function summary(item: IndexedContent): ContentSummary {
  return { id: item.id, legacyId: item.legacyId, type: item.type, category: item.category, title: item.title, tags: item.tags, difficulty: item.difficulty, publicationState: item.publicationState };
}

export class StaticContentRepository implements ContentRepository {
  async counts() {
    return catalog.counts as Record<ContentType, number>;
  }

  async search(query: ContentQuery) {
    const normalizedQuery = normalize(query.text ?? "");
    const terms = normalizedQuery
      .split(/[\s、。,.!?！？・]|(?:から|まで|より|について|とき|場合|には|では|とは|を|が|に|で|の|へ|と|や)/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);
    const filtered = index.filter((item) => {
      if (query.type?.length && !query.type.includes(item.type)) return false;
      if (query.category?.length && !query.category.includes(item.category)) return false;
      if (query.tags?.length && !query.tags.some((tag) => item.tags.includes(tag))) return false;
      if (!normalizedQuery) return true;
      if (item.searchText.includes(normalizedQuery)) return true;
      return terms.length > 0 && terms.some((term) => item.searchText.includes(term));
    });
    const start = Math.max(0, (query.page - 1) * query.pageSize);
    return { items: filtered.slice(start, start + query.pageSize).map(summary), total: filtered.length, hasMore: start + query.pageSize < filtered.length };
  }

  async get(id: string) {
    const hit = index.find((item) => item.id === id);
    if (!hit) return null;
    const chunk = await chunkLoaders[hit.type]() as { default: ContentDetail[] };
    return chunk.default.find((item) => item.id === id) ?? null;
  }

  async related(id: string, limit: number) {
    const hit = index.find((item) => item.id === id);
    if (!hit) return [];
    return index
      .filter((item) => item.id !== id && item.type === hit.type && item.category === hit.category)
      .slice(0, limit)
      .map(summary);
  }
}

export const contentRepository = new StaticContentRepository();
