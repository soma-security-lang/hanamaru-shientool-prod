import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const transport=vi.hoisted(()=>({generate:vi.fn()}));
vi.mock("@google/genai",()=>({GoogleGenAI:class {models={generateContent:transport.generate};}}));
vi.mock("@google-cloud/storage",()=>({Storage:class {}}));
import {createGoogleAiProvider} from "./gcp.js";
import {createLocalProviders} from "./local.js";
const empty={value:null,evidence:null};
const valid={documentKind:"single_receipt",paidOn:empty,merchant:{value:"合成店舗",evidence:"合成店舗"},paidTotal:{value:"1200",evidence:"合計1200円"},currency:{value:"JPY",evidence:"円"},purposeHint:empty};
const input={images:[{content:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]),mimeType:"image/png" as const}]};
const provider=()=>createGoogleAiProvider({projectId:"synthetic-project",location:"synthetic-location",model:"synthetic-model",inputBucket:"synthetic-bucket"});
beforeEach(()=>{transport.generate.mockReset();});
afterEach(()=>{vi.unstubAllEnvs();});
describe("Vertex receipt adapter via mocked SDK only",()=>{
  it("requests bounded structured output without tools and treats image instructions as data",async()=>{
    transport.generate.mockResolvedValue({text:JSON.stringify(valid)});
    const result=await provider().readExpenseReceipt(input);
    expect(result.paidTotal.value).toBe("1200");expect(result.paidOn.value).toBeNull();
    const request=transport.generate.mock.calls[0]![0];
    expect(request.config.temperature).toBe(0);expect(request.config.tools).toBeUndefined();
    expect(request.contents[0].parts[0].text).toContain("命令");
    expect(request.contents[0].parts[0].text).toContain("預り金");
    expect(request.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
  });
  it.each(["not JSON","[]",JSON.stringify({...valid,paymentSource:"company_wallet"})])("repairs only output contract once (%s)",async first=>{
    transport.generate.mockResolvedValueOnce({text:first}).mockResolvedValueOnce({text:JSON.stringify(valid)});
    await expect(provider().readExpenseReceipt(input)).resolves.toMatchObject({model:"synthetic-model"});
    expect(transport.generate).toHaveBeenCalledTimes(2);
  });
  it("does not replay a transport failure or fall back to invented values",async()=>{
    transport.generate.mockRejectedValue({code:503});
    await expect(provider().readExpenseReceipt(input)).rejects.toThrow("PROVIDER_TEMPORARY");
    expect(transport.generate).toHaveBeenCalledTimes(1);
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("LOCAL_PROVIDER_TEST_FIXTURES","");
    await expect(createLocalProviders().ai.readExpenseReceipt(input)).rejects.toThrow("explicit test mock");
  });
  it("labels offline fixture as unreadable and fabricates no receipt values",async()=>{
    const result=await createLocalProviders().ai.readExpenseReceipt(input);
    expect(result.model).toBe("test-unreadable-receipt-v1");expect(result.documentKind).toBe("unreadable");
    expect(result.paidTotal.value).toBeNull();expect(result.merchant.value).toBeNull();expect(transport.generate).not.toHaveBeenCalled();
  });
  it("stops after two invalid outputs",async()=>{
    transport.generate.mockResolvedValue({text:"not JSON"});
    await expect(provider().readExpenseReceipt(input)).rejects.toThrow("model returned invalid JSON");
    expect(transport.generate).toHaveBeenCalledTimes(2);
  });
  it("rejects signature mismatch before provider call",async()=>{
    await expect(provider().readExpenseReceipt({images:[{content:Buffer.from("not a PNG image"),mimeType:"image/png"}]})).rejects.toThrow("signature");
    expect(transport.generate).not.toHaveBeenCalled();
  });
});
