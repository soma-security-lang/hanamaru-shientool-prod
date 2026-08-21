import { describe, expect, it } from "vitest";
import { laneAScreens } from "./screens";

const expected = [
  ["SCR-001", "auth", "/login"],
  ["SCR-002", "aiHome", "/"],
  ["SCR-003", "visitList", "/visits"],
  ["SCR-004", "visitImport", "/visits/:id/import"],
  ["SCR-005", "visitPreparation", "/visits/:id/preparation"],
  ["SCR-006", "transcription", "/visits/:id/transcription"],
  ["SCR-007", "reviewInput", "/visits/:id/review/input"],
] as const;

describe("laneAScreens", () => {
  it("keeps SCR-001 through SCR-007 in route order", () => {
    expect(laneAScreens).toHaveLength(7);
    expect(laneAScreens.map(({ id, kind, routes }) => [id, kind, routes[0]])).toEqual(expected);
  });

  it("uses unique IDs and route patterns", () => {
    const ids = laneAScreens.map((screen) => screen.id);
    const routes = laneAScreens.flatMap((screen) => screen.routes);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("uses the approved Google login wording and no password field metadata", () => {
    const login = laneAScreens[0];
    expect(login.primaryAction).toBe("Googleでログイン");
    expect(JSON.stringify(login)).not.toMatch(/パスワード入力|メールアドレス入力|localStorageへ保存/);
  });
});
