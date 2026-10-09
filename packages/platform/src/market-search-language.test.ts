import { describe, expect, it } from "vitest";
import { validateEnglishMarketQueries } from "./market-search-language.js";

describe("explicit English market query support", () => {
  it.each(["Canon EOS R6 body", "Canon eos-r6 camera", "Canon ＥＯＳ Ｒ６ camera"])("preserves normalized supplied model: %s", keyword => {
    expect(() => validateEnglishMarketQueries([keyword], "EOS R6")).not.toThrow();
  });
  it.each(["Canon EOS R5 camera", "Canon EOS R60 camera", "Canon EOS R6II camera", "Canon camera", "Canon EOS R6 ボディ", "カメラ EOS R6"])("rejects changed model or non-English suggestion: %s", keyword => {
    expect(() => validateEnglishMarketQueries([keyword], "EOS R6")).toThrow("market English query");
  });
  it("permits a unknown model without inventing a supplied model requirement", () => {
    expect(() => validateEnglishMarketQueries(["Synthetic camera body"], null)).not.toThrow();
  });
  it("rejects empty or over-limit sets", () => {
    expect(() => validateEnglishMarketQueries([], null)).toThrow();
    expect(() => validateEnglishMarketQueries(Array(4).fill("Synthetic camera"), null)).toThrow();
  });
});
