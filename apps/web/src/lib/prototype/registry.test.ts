import { describe, expect, it } from "vitest";
import { allScreens, findScreen } from "./registry";

const concreteRoutes = [
  "/login", "/", "/visits", "/visits/visit-demo/import",
  "/visits/visit-demo/preparation", "/visits/visit-demo/transcription",
  "/visits/visit-demo/review/input", "/visits/visit-demo/review", "/reviews",
  "/knowledge/talks", "/knowledge/flows", "/knowledge/reference", "/knowledge/manuals",
  "/training/videos", "/training/roleplay", "/admin/contents", "/admin/users",
  "/admin/operations", "/admin/approvals", "/admin/analytics",
];

describe("screen registry", () => {
  it("has exactly 20 unique SCR definitions and 20 canonical route patterns", () => {
    expect(allScreens).toHaveLength(20);
    expect(new Set(allScreens.map((screen) => screen.id)).size).toBe(20);
    expect(allScreens.flatMap((screen) => screen.routes)).toHaveLength(20);
  });

  it.each(concreteRoutes)("resolves %s", (route) => {
    expect(findScreen(route)?.id).toMatch(/^SCR-\d{3}$/);
  });

  it("keeps post-pilot screens behind explicit feature flags", () => {
    expect(allScreens.find((screen) => screen.id === "SCR-019")?.featureFlag).toBeTruthy();
    expect(allScreens.find((screen) => screen.id === "SCR-020")?.featureFlag).toBeTruthy();
  });

  it("does not model rankings or human-resources evaluation", () => {
    const serialized = JSON.stringify(allScreens);
    const analytics = allScreens.find((screen) => screen.id === "SCR-020");
    expect(analytics?.summary).toContain("個人ランキングなし");
    expect(serialized).not.toMatch(/人事評価スコア|employee[_-]?rank/i);
  });

  it("uses concrete parity vocabulary for the core business features",()=>{
    const names=Object.fromEntries(allScreens.map(screen=>[screen.id,screen.name]));
    expect(names).toMatchObject({
      "SCR-002":"買取支援AI","SCR-004":"PDFから訪問を登録","SCR-010":"切り返しトーク集",
      "SCR-011":"困ったときのフロー集","SCR-012":"用語集・金券買取価格表","SCR-013":"接客マニュアル・法務","SCR-015":"AIロープレ",
    });
  });
});
