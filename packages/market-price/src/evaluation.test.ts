import {describe,expect,it} from "vitest";
import {summarizeMarketPriceEvaluation} from "./index.js";

describe("market-price precision and speed evaluation",()=>{
  it("requires 30 products and calculates the release-gate metrics without customer data",()=>{
    const cases=Array.from({length:30},(_,caseIndex)=>{
      const relevant=Array.from({length:50},(_,index)=>`p${caseIndex}-relevant-${index}`);
      const noise=Array.from({length:50},(_,index)=>`p${caseIndex}-noise-${index}`);
      return{relevantItemIds:relevant,baselineItemIds:[...relevant.slice(0,35),...noise.slice(0,15),...relevant.slice(35)],enhancedItemIds:[...relevant.slice(0,42),...noise.slice(0,8),...relevant.slice(42,48)],baselinePages:10,enhancedPages:7,baselineDurationMs:10_000+caseIndex,enhancedDurationMs:8_000+caseIndex};
    });
    const result=summarizeMarketPriceEvaluation(cases);
    expect(result.caseCount).toBe(30);
    expect(result.precisionTop50Improvement).toBeGreaterThanOrEqual(.1);
    expect(result.recallTop100Change).toBeGreaterThanOrEqual(-.05);
    expect(result.medianPageReduction).toBeGreaterThanOrEqual(.2);
    expect(result.enhancedMedianDurationMs).toBeLessThanOrEqual(result.baselineMedianDurationMs);
    expect(result.enhancedZeroResultRate).toBeLessThanOrEqual(result.baselineZeroResultRate);
  });

  it("refuses to report an undersized benchmark as release evidence",()=>{
    expect(()=>summarizeMarketPriceEvaluation([])).toThrow(/30 anonymized products/u);
  });
});
