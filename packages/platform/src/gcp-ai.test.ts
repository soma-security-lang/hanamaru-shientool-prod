import {describe,expect,it} from "vitest";
import {prepareVertexTranscriptQualityInput,retryableReviewContractError,retryableTranscriptQualityContractError,VERTEX_QUALITY_MAX_PROMPT_CHARACTERS,vertexExtractionOutputSchema,vertexReviewGenerationConfig,vertexReviewOutputSchema,vertexReviewPrompt,vertexTranscriptQualityOutputSchema} from "./gcp.js";

describe("Vertex AI extraction contract",()=>{
  it("keeps the model response schema separate from the business form schema",()=>{
    expect(vertexExtractionOutputSchema()).toEqual({
      type:"OBJECT",
      required:["fields"],
      properties:{fields:{type:"ARRAY",items:{
        type:"OBJECT",
        required:["key","value","page","excerpt","confidence"],
        properties:{
          key:{type:"STRING"},
          value:{type:"STRING"},
          page:{type:"INTEGER",nullable:true},
          excerpt:{type:"STRING",nullable:true},
          confidence:{type:"NUMBER",nullable:true},
        },
      }}},
    });
  });
});

describe("Vertex AI review parity contract",()=>{
  it("requires exactly the six review areas and the PoC rubric",()=>{const schema=vertexReviewOutputSchema() as {required:string[];properties:{findings:{minItems:number;maxItems:number;items:{properties:{category:{enum:string[]}}}},complianceChecks:{required:string[]}}};expect(schema.properties.findings.minItems).toBe(6);expect(schema.properties.findings.maxItems).toBe(6);expect(schema.properties.findings.items.properties.category.enum).toEqual(["strength","improvement","talk","compliance","next_action","revisit"]);expect(schema.required).toContain("complianceChecks");expect(schema.properties.complianceChecks.required).toEqual(["notification","coolingOff","documentDelivery","pressureSelling"]);const prompt=vertexReviewPrompt({transcript:"",segments:[{id:"E0001",text:"来週またお願いします"}],criteria:{contract:"poc_review_parity_v1"}});expect(prompt).toContain("次回合意あり・決裁者不在・追加品の自己言及");expect(prompt).toContain("愛着保留・比較検討中・葛藤保留");expect(prompt).toContain("社交辞令は高シグナルに含めません");expect(prompt).toContain("notification=告知");expect(prompt).toContain("pressureSelling=押し買い");expect(prompt).toContain('"id":"E0001"');});
  it("restricts the schema and prompt to the selected review areas",()=>{const dimensions=["strength","compliance"] as const;const schema=vertexReviewOutputSchema(dimensions) as {required:string[];properties:{findings:{minItems:number;maxItems:number;items:{properties:{category:{enum:string[]}}}}}};expect(schema.properties.findings).toMatchObject({minItems:2,maxItems:2});expect(schema.properties.findings.items.properties.category.enum).toEqual(dimensions);expect(schema.required).toContain("complianceChecks");const prompt=vertexReviewPrompt({transcript:"",segments:[{id:"E0001",text:"説明しました"}],dimensions:[...dimensions]});expect(prompt).toContain("strength・compliance");expect(prompt).toContain("合計2件");expect(prompt).toContain("選択されていない観点は返さない");});
  it("retries only bounded model-contract failures",()=>{expect(retryableReviewContractError(new Error("PROVIDER_PERMANENT: model returned invalid JSON"))).toBe(true);expect(retryableReviewContractError(new Error("PROVIDER_PERMANENT: missing review evidence strength"))).toBe(true);expect(retryableReviewContractError(new Error("PROVIDER_PERMANENT: approved prompt model does not match configured model"))).toBe(false);expect(retryableReviewContractError(new Error("PROVIDER_TEMPORARY: quota"))).toBe(false);});
  it("reserves enough output for the six-area contract and lowers repair variance",()=>{expect(vertexReviewGenerationConfig(false)).toEqual({temperature:0.3,maxOutputTokens:8192});expect(vertexReviewGenerationConfig(true)).toEqual({temperature:0.1,maxOutputTokens:8192});});
});

describe("Vertex AI transcript quality bounds",()=>{
  it("constrains every evidence id to the current transcript chunk",()=>{
    const schema=vertexTranscriptQualityOutputSchema(["E0001","E0002"]) as {properties:{flags:{items:{properties:{evidenceSegmentIds:{items:{enum:string[]}}}}}}};
    expect(schema.properties.flags.items.properties.evidenceSegmentIds.items.enum).toEqual(["E0001","E0002"]);
  });
  it("repairs only model-contract failures and never retries quota or configuration errors in-process",()=>{
    expect(retryableTranscriptQualityContractError(new Error("PROVIDER_PERMANENT: model returned invalid JSON"))).toBe(true);
    expect(retryableTranscriptQualityContractError(new Error("PROVIDER_PERMANENT: transcript quality evidence references an unknown segment"))).toBe(true);
    expect(retryableTranscriptQualityContractError(new Error("PROVIDER_PERMANENT: duplicate transcript quality flag"))).toBe(true);
    expect(retryableTranscriptQualityContractError(new Error("PROVIDER_PERMANENT: transcript quality request exceeds the segment limit"))).toBe(false);
    expect(retryableTranscriptQualityContractError(new Error("PROVIDER_TEMPORARY: quota"))).toBe(false);
    expect(retryableTranscriptQualityContractError(new Error("PROVIDER_PERMANENT: approved model mismatch"))).toBe(false);
  });
  it("normalizes and truncates every segment and keeps the complete prompt under its hard limit",()=>{
    const input={durationMs:8*60*60*1000,segments:Array.from({length:160},(_,index)=>({id:`segment-${index}`,startMs:index*1000,endMs:index*1000+900,speakerLabel:`chunk-${Math.floor(index/20)}:1`,text:`  Ａ${"x".repeat(5000)}  `}))};
    const prepared=prepareVertexTranscriptQualityInput(input);
    expect(prepared.segments).toHaveLength(160);
    expect(prepared.segments.every(segment=>segment.text.length<=1000)).toBe(true);
    expect(prepared.segments[0]?.text.startsWith("A")).toBe(true);
    expect(prepared.prompt.length).toBeLessThanOrEqual(VERTEX_QUALITY_MAX_PROMPT_CHARACTERS);
    expect(input.segments[0]?.text.length).toBeGreaterThan(1000);
  });
  it("rejects an unchunked request above the segment limit",()=>{
    expect(()=>prepareVertexTranscriptQualityInput({durationMs:1,segments:Array.from({length:161},(_,index)=>({id:String(index),startMs:index,endMs:index+1,speakerLabel:null,text:"text"}))})).toThrow("segment limit");
  });
});
