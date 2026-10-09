import {beforeEach,describe,expect,it,vi} from "vitest";
import type {AiProvider} from "./types.js";
const transport=vi.hoisted(()=>({generate:vi.fn()}));
vi.mock("@google/genai",()=>({GoogleGenAI:class {models={generateContent:transport.generate};}}));
vi.mock("@google-cloud/storage",()=>({Storage:class {}}));
import {createGoogleAiProvider} from "./gcp.js";

const input:Parameters<AiProvider["identifyMarketProduct"]>[0]={searchLanguage:"en",inputMode:"manual_assisted",productName:"Synthetic X1 ボディ",category:null,brand:null,modelNumber:"X1",attributes:{},excludeKeywords:[],confirmedConditions:["good"],images:[]};
const valid={productCandidates:[{productName:"Synthetic X1",category:null,brand:null,modelNumber:"X1",attributes:{},confidence:.9}],searchQueries:[{keyword:"Synthetic X1 body",breadth:"standard"}],excludeKeywords:[],suggestedConditions:["good"],warnings:[]};
const provider=()=>createGoogleAiProvider({projectId:"synthetic-project",location:"synthetic-location",model:"synthetic-model",inputBucket:"synthetic-bucket"});
beforeEach(()=>{transport.generate.mockReset();});
describe("Vertex market identification via mocked SDK only",()=>{
  it("requests English proposals without applying them or overwriting input",async()=>{
    transport.generate.mockResolvedValue({text:JSON.stringify(valid)});
    const result=await provider().identifyMarketProduct(input);
    expect(transport.generate).toHaveBeenCalledTimes(1);
    expect(transport.generate.mock.calls[0]![0].config.temperature).toBe(0);
    expect(transport.generate.mock.calls[0]![0].contents[0].parts[0].text).toContain("X1");
    expect(result.searchQueries[0]).toMatchObject({keyword:"Synthetic X1 body",decision:"pending"});
    expect(input.productName).toBe("Synthetic X1 ボディ");
  });
  it.each(["not JSON","[]",JSON.stringify({...valid,searchQueries:[{keyword:"Synthetic X10 body",breadth:"standard"}]})])("repairs invalid structured output once (%s)",async first=>{
    transport.generate.mockResolvedValueOnce({text:first}).mockResolvedValueOnce({text:JSON.stringify(valid)});
    const result=await provider().identifyMarketProduct(input);
    expect(result.searchQueries[0]!.keyword).toBe("Synthetic X1 body");
    expect(transport.generate).toHaveBeenCalledTimes(2);
    const retry=transport.generate.mock.calls[1]![0];
    expect(retry.config.temperature).toBe(0);
    expect(retry.contents[0].parts[0].text).toContain("前回は出力契約違反");
  });
  it("stops after the second invalid JSON output",async()=>{
    transport.generate.mockResolvedValue({text:"not JSON"});
    await expect(provider().identifyMarketProduct(input)).rejects.toThrow("model returned invalid JSON");
    expect(transport.generate).toHaveBeenCalledTimes(2);
  });
  it("does not turn transport errors into additional schema-repair calls",async()=>{
    transport.generate.mockRejectedValue({code:503});
    await expect(provider().identifyMarketProduct(input)).rejects.toThrow("PROVIDER_TEMPORARY");
    expect(transport.generate).toHaveBeenCalledTimes(1);
  });
});
