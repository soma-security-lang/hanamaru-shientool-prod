import {describe,it,expect} from "vitest";
import {purchasePeriod,rankPurchaseAmounts} from "./purchase-performance.js";
describe("取引実績の集計契約",()=>{
 it("同額は1,1,3、IDで安定ソート、巨大整数も正確",()=>{expect(rankPurchaseAmounts([{id:"b",amount:"9007199254740993"},{id:"a",amount:"9007199254740993"},{id:"c",amount:"9007199254740992"}]).map(row=>[row.id,row.rank])).toEqual([["a",1],["b",1],["c",3]]);});
 it("月曜開始の年跨ぎ週",()=>{expect(purchasePeriod("2026-01-01","week")).toEqual({startDate:"2025-12-29",endDate:"2026-01-04"});});
 it("閏月・12月・日次",()=>{expect(purchasePeriod("2024-02-12","month").endDate).toBe("2024-02-29");expect(purchasePeriod("2026-12-31","month").endDate).toBe("2026-12-31");expect(purchasePeriod("2026-10-13","day").startDate).toBe("2026-10-13");});
 it("実在しない日付を拒否",()=>{expect(()=>purchasePeriod("2026-02-30","day")).toThrow();});
});
