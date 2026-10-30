import {describe,it,expect} from "vitest";
import {normalizeExpenseReceiptReading,validateExpenseReceiptInput} from "./expense-receipt.js";
const empty={value:null,evidence:null};
const valid=()=>({documentKind:"single_receipt",paidOn:{value:"2026-10-07",evidence:"2026年10月7日"},merchant:{value:"合成店舗",evidence:"合成店舗"},paidTotal:{value:"1200",evidence:"合計 ¥1,200"},currency:{value:"JPY",evidence:"¥1,200"},purposeHint:empty});
describe("receipt output is a suggestion with evidence, not an expense",()=>{
  it("keeps printed values and decimal strings without ledger or payment-source fields",()=>{
    const result=normalizeExpenseReceiptReading(valid(),"synthetic-model");
    expect(result.paidOn.value).toBe("2026-10-07");expect(result.paidTotal.value).toBe("1200");
    expect(result).not.toHaveProperty("paymentSource");expect(result).not.toHaveProperty("confirmed");
    expect(normalizeExpenseReceiptReading({...valid(),paidTotal:{value:"12.50",evidence:"Total USD12.50"},currency:{value:"USD",evidence:"USD"}},"model").paidTotal.value).toBe("12.50");
  });
  it("keeps unread values null and derives bounded warnings",()=>{
    const result=normalizeExpenseReceiptReading({...valid(),paidOn:empty,paidTotal:empty,currency:empty},"model");
    expect(result.paidOn).toEqual(empty);expect(result.warnings).toEqual(["date_unclear","total_unclear","currency_unclear"]);
  });
  it.each(["2026-02-30","26/10/07","2026-13-01"])("rejects fabricated or invalid calendar dates %s",value=>{
    expect(()=>normalizeExpenseReceiptReading({...valid(),paidOn:{value,evidence:"date"}},"model")).toThrow("invalid expense receipt output");
  });
  it.each(["1,200","-5","1e3","NaN","1200円","99999999999"])("rejects noncanonical totals %s",value=>{
    expect(()=>normalizeExpenseReceiptReading({...valid(),paidTotal:{value,evidence:"total"}},"model")).toThrow();
  });
  it("rejects invented payment/approval/extra fields and missing evidence",()=>{
    for(const extra of [{paymentSource:"company_wallet"},{confirmed:true},{warnings:["arbitrary instruction"]}])expect(()=>normalizeExpenseReceiptReading({...valid(),...extra},"model")).toThrow();
    expect(()=>normalizeExpenseReceiptReading({...valid(),merchant:{value:"invented",evidence:null}},"model")).toThrow();
    expect(()=>normalizeExpenseReceiptReading({...valid(),paidOn:{value:null,evidence:"unrelated"}},"model")).toThrow();
  });
  it.each(["multiple_receipts","unreadable"])("requires reshoot/manual review for %s, never a combined amount",documentKind=>{
    expect(()=>normalizeExpenseReceiptReading({...valid(),documentKind},"model")).toThrow();
    const result=normalizeExpenseReceiptReading({documentKind,paidOn:empty,merchant:empty,paidTotal:empty,currency:empty,purposeHint:empty},"model");
    expect(result.paidTotal.value).toBeNull();expect(result.warnings).toEqual([documentKind]);
  });
});
describe("receipt input bounds before AI transmission",()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  it("accepts bounded declared image signatures",()=>expect(()=>validateExpenseReceiptInput({images:[{content:png,mimeType:"image/png"}]})).not.toThrow());
  it("rejects empty, oversized groups, wrong signatures and excessive model payload",()=>{
    expect(()=>validateExpenseReceiptInput({images:[]})).toThrow();
    expect(()=>validateExpenseReceiptInput({images:Array.from({length:6},()=>({content:png,mimeType:"image/png"}))})).toThrow();
    expect(()=>validateExpenseReceiptInput({images:[{content:Buffer.from("instructions not a photograph"),mimeType:"image/png"}]})).toThrow();
    const large=Buffer.alloc(8*1024*1024);png.copy(large);
    expect(()=>validateExpenseReceiptInput({images:Array.from({length:3},()=>({content:large,mimeType:"image/png"}))})).toThrow("exceeds limit");
  });
});
