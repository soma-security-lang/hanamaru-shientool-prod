import { describe, expect, it } from "vitest";
import register from "./poc-content.json";

describe("PoC content migration fixture", () => {
  it("preserves all eight target types and the machine-audited total", () => {
    expect(Object.keys(register.counts.by_type).sort()).toEqual(["flow", "glossary", "legal", "manual", "price", "roleplay", "talk", "video"]);
    expect(register.records).toHaveLength(register.counts.total);
    expect(register.counts.total).toBe(1_676);
  });

  it("has unique new and legacy IDs with complete provenance", () => {
    expect(new Set(register.records.map((item) => item.id)).size).toBe(register.records.length);
    expect(new Set(register.records.map((item) => item.legacy_id)).size).toBe(register.records.length);
    for (const item of register.records) {
      expect(item.original_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item.source.git_commit).toBeUndefined();
      expect(item.source.source_sha256).toBe(register.source.sha256);
      expect(item.publication_state).toBe("draft");
    }
  });

  it("records sources that cannot be recovered from Git", () => {
    expect(register.counts.by_type.video).toBe(0);
    expect(register.unresolved_sources.some((source) => source.storage === "localStorage:hanamaru_video")).toBe(true);
    expect(register.validation.missing_required).toEqual([]);
    expect(register.validation.duplicate_legacy_ids).toEqual([]);
  });
});
