import { describe, expect, it } from "vitest";
import catalog from "@/generated/poc-content/catalog.json";
import index from "@/generated/poc-content/index.json";
import { contentRepository } from "./staticRepository";
import { contentTypes } from "./types";

describe("StaticContentRepository", () => {
  it("keeps the complete 1,676-record PoC corpus split by type", async () => {
    expect(index).toHaveLength(1676);
    expect(catalog.total).toBe(1676);
    expect(await contentRepository.counts()).toEqual({
      talk: 1156, flow: 159, glossary: 107, price: 76,
      manual: 6, legal: 4, video: 0, roleplay: 168,
    });
  });

  it("resolves every indexed ID from its type chunk", async () => {
    for (const item of index) expect((await contentRepository.get(item.id))?.legacyId).toBe(item.legacyId);
  }, 30_000);

  it.each(contentTypes.filter((type) => type !== "video"))("searches and opens %s content", async (type) => {
    const result = await contentRepository.search({ type: [type], page: 1, pageSize: 1 });
    expect(result.total).toBeGreaterThan(0);
    expect((await contentRepository.get(result.items[0].id))?.type).toBe(type);
  });

  it("normalizes Japanese text search", async () => {
    const result = await contentRepository.search({ type: ["talk"], text: "査定額が安すぎる", page: 1, pageSize: 10 });
    expect(result.items.some((item) => item.title === "査定額が安すぎる")).toBe(true);
  });
});
