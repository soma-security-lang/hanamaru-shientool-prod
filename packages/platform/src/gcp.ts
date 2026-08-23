import { createHash,randomUUID } from "node:crypto";
import { Storage,type Bucket,type FileMetadata } from "@google-cloud/storage";
import { CloudTasksClient } from "@google-cloud/tasks";
import { GoogleGenAI,type Part } from "@google/genai";
import { google } from "googleapis";
import { Readable,Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  AiProvider,
  DriveProvider,
  PlatformProviders,
  StorageProvider,
  TaskProvider,
  UploadDeclaration,
} from "./types.js";
import { normalizeReviewOutput, normalizeRoleplayOutput, parseModelJson } from "./model-output.js";
import {reviewDimensions,type ReviewDimension} from "./types.js";
import { createGoogleSpeechProvider } from "./google-speech.js";
import { createLocalProviders } from "./local.js";
import { probeAudioSource,probeVideoSource } from "./media.js";

type SpeechLocation = "asia-northeast1"|"us";

interface StorageConfig { projectId:string; bucket:string }
interface AiConfig { projectId:string; location:string; model:string; inputBucket:string }
interface DriveConfig { clientId:string; clientSecret:string; redirectUri:string }
interface TaskConfig { projectId:string; location:string; queue:string; workerUrl:string; serviceAccount:string }

export const VERTEX_QUALITY_MAX_SEGMENTS=160;
export const VERTEX_QUALITY_MAX_SEGMENT_TEXT_CHARACTERS=1000;
export const VERTEX_QUALITY_MAX_PROMPT_CHARACTERS=192000;

function boundedVertexQualityText(value:string):string{
  const normalized=value.normalize("NFKC").trim();
  let bounded=normalized.slice(0,VERTEX_QUALITY_MAX_SEGMENT_TEXT_CHARACTERS);
  const finalCodeUnit=bounded.charCodeAt(bounded.length-1);
  if(finalCodeUnit>=0xd800&&finalCodeUnit<=0xdbff)bounded=bounded.slice(0,-1);
  return bounded;
}

export function prepareVertexTranscriptQualityInput(input:Parameters<AiProvider["assessTranscriptQuality"]>[0]){
  if(input.segments.length>VERTEX_QUALITY_MAX_SEGMENTS)throw new Error("PROVIDER_PERMANENT: transcript quality request exceeds the segment limit");
  const aliases=new Map(input.segments.map((segment,index)=>[`E${String(index+1).padStart(4,"0")}`,segment.id]));
  const segments=input.segments.map((segment,index)=>({
    id:`E${String(index+1).padStart(4,"0")}`,
    startMs:segment.startMs,
    endMs:segment.endMs,
    speakerLabel:segment.speakerLabel,
    text:boundedVertexQualityText(segment.text),
  }));
  const prompt=`出張買取の接客録音について、音声由来の文字起こし区間だけを根拠に品質リスクを判定してください。
possible_mediaは番組、動画、ポッドキャスト、朗読、広告、演芸など接客とは別の収録済みコンテンツが混在する場合だけ返してください。
long_non_dialogueは接客会話ではない一方向の発話が長時間続く場合だけ返してください。
該当しなければflagsは空配列にしてください。推測は禁止です。各flagのevidenceSegmentIdsは入力に実在するIDを1〜5件だけ返してください。
録音時間ms:${input.durationMs}\n発話:${JSON.stringify(segments)}`;
  if(prompt.length>VERTEX_QUALITY_MAX_PROMPT_CHARACTERS)throw new Error("PROVIDER_PERMANENT: transcript quality prompt exceeds the character limit");
  return{aliases,segments,prompt};
}

const required = (key:string) => {
  const value=process.env[key];
  if(!value)throw new Error(`${key} is required`);
  return value;
};

const projectId = () => process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID ?? required("GOOGLE_CLOUD_PROJECT");
const speechLocation = ():SpeechLocation => {
  const value=required("SPEECH_LOCATION");
  if(value!=="asia-northeast1"&&value!=="us")throw new Error("SPEECH_LOCATION must be asia-northeast1 or us");
  if((process.env.SPEECH_MODEL??"chirp_3")!=="chirp_3")throw new Error("SPEECH_MODEL must be chirp_3");
  return value;
};

const googleErrorCode=(error:unknown)=>error&&typeof error==="object"&&"code" in error?Number(error.code):0;
export const pendingUploadObjectName=(logicalObjectName:string)=>`quarantine/uploads/${createHash("sha256").update(logicalObjectName).digest("hex")}`;

/**
 * GCS versioning keeps noncurrent generations after a normal object delete.
 * Privacy deletion therefore enumerates the exact object name with versions=true,
 * removes every generation with a generation-match precondition, and confirms that
 * the strongly-consistent listing is empty before returning.
 */
export async function deleteAllGcsObjectGenerations(bucket:Bucket,objectName:string):Promise<void>{
  for(let pass=0;pass<8;pass+=1){
    const [listed]=await bucket.getFiles({prefix:objectName,versions:true,autoPaginate:true});
    const exact=listed.filter(file=>file.name===objectName);
    if(!exact.length)return;
    for(const file of exact){
      const generation=String(file.metadata.generation??"");
      if(!/^\d+$/.test(generation))throw new Error("PROVIDER_PERMANENT: GCS object generation is missing");
      try{await bucket.file(objectName,{generation}).delete({ifGenerationMatch:generation});}
      catch(error){if(![404,412].includes(googleErrorCode(error)))throw error;}
    }
  }
  throw new Error("PROVIDER_TEMPORARY: GCS object generations could not be fully deleted");
}

export function vertexReviewOutputSchema(dimensions:readonly ReviewDimension[]=reviewDimensions):Record<string,unknown>{
  const required=["summary","findings",...(dimensions.includes("compliance")?["complianceChecks"]:[])];
  return{
    type:"OBJECT",required,
    properties:{
      summary:{type:"STRING"},
      findings:{type:"ARRAY",minItems:dimensions.length,maxItems:dimensions.length,items:{type:"OBJECT",required:["category","title","description","evidenceSegmentIds"],properties:{category:{type:"STRING",enum:[...dimensions]},title:{type:"STRING"},description:{type:"STRING"},recommendedAction:{type:"STRING",nullable:true},evidenceSegmentIds:{type:"ARRAY",minItems:1,maxItems:3,items:{type:"STRING"}}}}},
      ...(dimensions.includes("compliance")?{complianceChecks:{type:"OBJECT",required:["notification","coolingOff","documentDelivery","pressureSelling"],properties:Object.fromEntries(["notification","coolingOff","documentDelivery","pressureSelling"].map(key=>[key,{type:"OBJECT",required:["status","detail","evidenceSegmentIds"],properties:{status:{type:"STRING",enum:["compliant","noncompliant","unclear"]},detail:{type:"STRING"},evidenceSegmentIds:{type:"ARRAY",minItems:1,maxItems:3,items:{type:"STRING"}}}}]))}}:{}),
    },
  };
}

export function vertexReviewPrompt(input:Parameters<AiProvider["review"]>[0]):string{const dimensions=input.dimensions?.length?input.dimensions:reviewDimensions;const selectedRules=[
  dimensions.includes("talk")?"talkは最大3件をdescriptionへまとめてください。":"",
  dimensions.includes("revisit")?"revisitはお客様の実際の発言に基づき、高・中・低で判定してください。高シグナルは次回合意あり・決裁者不在・追加品の自己言及、中シグナルは愛着保留・比較検討中・葛藤保留です。社交辞令は高シグナルに含めません。":"",
  dimensions.includes("compliance")?"complianceChecksを必ず返してください。notification=告知、coolingOff=クーリングオフ、documentDelivery=書面交付、pressureSelling=押し買いです。各項目のstatusはcompliant・noncompliant・unclearのいずれか、detailは判定理由、evidenceSegmentIdsはその項目を裏付ける実在発話IDを返してください。":"",
].filter(Boolean).join("\n");return`${input.systemInstruction??"確定済み発話だけを根拠に評価してください。"}

以下は出張買取の接客の文字起こしです。PoCと同じ評価観点でJSONのみ返してください。
findingsには${dimensions.join("・")}をこの順で各1件、合計${dimensions.length}件だけ返してください。選択されていない観点は返さないでください。
summaryは1,000文字以内、各titleは80文字以内、各descriptionは800文字以内、根拠IDは各領域3件以内にしてください。
${selectedRules}
監査のため、各findingのevidenceSegmentIdsには入力に実在するEから始まる発話IDを1件以上付けてください。存在しない発話IDは作らないでください。
目的:${input.objective??"接客育成"}
評価基準:${JSON.stringify(input.criteria??{})}
発話:${JSON.stringify(input.segments)}`;}

export function retryableReviewContractError(error:unknown):boolean{
  if(!(error instanceof Error))return false;
  return /^PROVIDER_PERMANENT: (?:model output|model returned|invalid |missing review|review evidence)/u.test(error.message);
}

export function vertexReviewGenerationConfig(repair=false):Record<string,unknown>{
  return{temperature:repair?0.1:0.3,maxOutputTokens:8192};
}

export function createGcpStorageProvider(config:StorageConfig,storage=new Storage({projectId:config.projectId})):StorageProvider {
  const bucket=storage.bucket(config.bucket);
  return {
    async createUpload(input:UploadDeclaration){
      const writeHeaders={"x-goog-if-generation-match":"0","x-goog-meta-sha256":input.sha256};
      const [url]=await bucket.file(pendingUploadObjectName(input.objectName)).getSignedUrl({version:"v4",action:"write",expires:input.expiresAt,contentType:input.mimeType,extensionHeaders:writeHeaders});
      return {url,method:"PUT",headers:{"content-type":input.mimeType,...writeHeaders},expiresAt:input.expiresAt.toISOString()};
    },
    async put(input){
      const sha256=createHash("sha256").update(input.body).digest("hex");
      if(input.sha256&&input.sha256!==sha256)throw new Error("CHECKSUM_MISMATCH");
      const file=bucket.file(input.objectName);
      await file.save(input.body,{resumable:input.body.byteLength>=8*1024*1024,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:input.mimeType,cacheControl:"private, no-store",metadata:{sha256}}});
      const [metadata]=await file.getMetadata();
      return {bucket:config.bucket,objectName:input.objectName,generation:String(metadata.generation),sizeBytes:Number(metadata.size),sha256,mimeType:String(metadata.contentType??input.mimeType)};
    },
    async putStream(input){
      const file=bucket.file(input.objectName);const digest=createHash("sha256");let sizeBytes=0;let writeCompleted=false;
      const meter=new Transform({transform(chunk,_encoding,callback){const body=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);sizeBytes+=body.byteLength;digest.update(body);if(sizeBytes>input.sizeBytes)return callback(new Error("FILE_SIZE_INVALID"));callback(null,body);}});
      try{
        await pipeline(input.source,meter,file.createWriteStream({resumable:true,validation:"crc32c",preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:input.mimeType,cacheControl:"private, no-store"}}));writeCompleted=true;
        if(sizeBytes!==input.sizeBytes)throw new Error("FILE_SIZE_INVALID");const sha256=digest.digest("hex");if(input.sha256&&input.sha256!==sha256)throw new Error("CHECKSUM_MISMATCH");
        await file.setMetadata({metadata:{sha256}});const [metadata]=await file.getMetadata();
        return{bucket:config.bucket,objectName:input.objectName,generation:String(metadata.generation),sizeBytes:Number(metadata.size),sha256,mimeType:String(metadata.contentType??input.mimeType)};
      }catch(error){if(writeCompleted)await deleteAllGcsObjectGenerations(bucket,input.objectName).catch(()=>undefined);throw error;}
    },
    async openRead(objectName,generation,range){return bucket.file(objectName,{generation}).createReadStream({validation:range?false:true,...range});},
    async probeAudio(objectName,generation){const [url]=await bucket.file(objectName,{generation}).getSignedUrl({version:"v4",action:"read",expires:Date.now()+5*60_000});return probeAudioSource(url);},
    async probeVideo(objectName,generation){const [url]=await bucket.file(objectName,{generation}).getSignedUrl({version:"v4",action:"read",expires:Date.now()+5*60_000});return probeVideoSource(url);},
    async createDownload(objectName,generation,mimeType,expiresAt){
      const [url]=await bucket.file(objectName,{generation}).getSignedUrl({version:"v4",action:"read",expires:expiresAt,responseDisposition:"inline",responseType:mimeType});
      return {kind:"redirect",url,expiresAt:expiresAt.toISOString()};
    },
    async verify(input){
      const pendingName=pendingUploadObjectName(input.objectName);const finalFile=bucket.file(input.objectName);
      const matches=(metadata:FileMetadata)=>Number(metadata.size)===input.sizeBytes&&metadata.metadata?.sha256===input.sha256;
      const stored=(metadata:FileMetadata)=>({bucket:config.bucket,objectName:input.objectName,generation:String(metadata.generation),sizeBytes:Number(metadata.size),sha256:input.sha256,mimeType:String(metadata.contentType??input.mimeType)});
      try{
        const [existing]=await finalFile.getMetadata();
        if(!matches(existing)){await Promise.allSettled([deleteAllGcsObjectGenerations(bucket,pendingName),deleteAllGcsObjectGenerations(bucket,input.objectName)]);throw new Error("CHECKSUM_MISMATCH");}
        await deleteAllGcsObjectGenerations(bucket,pendingName);
        return stored(existing);
      }catch(error){if(googleErrorCode(error)!==404)throw error;}
      const pendingFile=bucket.file(pendingName);const [pendingMetadata]=await pendingFile.getMetadata();const pendingGeneration=String(pendingMetadata.generation);
      if(!/^\d+$/.test(pendingGeneration)){await deleteAllGcsObjectGenerations(bucket,pendingName).catch(()=>undefined);throw new Error("PROVIDER_PERMANENT: GCS object generation is missing");}
      if(!matches(pendingMetadata)){await deleteAllGcsObjectGenerations(bucket,pendingName).catch(()=>undefined);throw new Error("CHECKSUM_MISMATCH");}
      try{
        await bucket.file(pendingName,{generation:pendingGeneration}).copy(finalFile,{preconditionOpts:{ifGenerationMatch:0}});
      }catch(error){if(googleErrorCode(error)!==412)throw error;}
      const [finalMetadata]=await finalFile.getMetadata();
      if(!matches(finalMetadata)){await Promise.allSettled([deleteAllGcsObjectGenerations(bucket,pendingName),deleteAllGcsObjectGenerations(bucket,input.objectName)]);throw new Error("CHECKSUM_MISMATCH");}
      await deleteAllGcsObjectGenerations(bucket,pendingName);
      return stored(finalMetadata);
    },
    async deleteIncompleteUpload(objectName){
      await Promise.all([deleteAllGcsObjectGenerations(bucket,pendingUploadObjectName(objectName)),deleteAllGcsObjectGenerations(bucket,objectName)]);
    },
    async delete(objectName,generation){
      if(!/^\d+$/.test(generation))throw new Error("PROVIDER_PERMANENT: tracked GCS generation is invalid");
      await deleteAllGcsObjectGenerations(bucket,objectName);
    },
  };
}

export function createGoogleAiProvider(config:AiConfig):AiProvider {
  const genai=new GoogleGenAI({vertexai:true,project:config.projectId,location:config.location});
  const storage=new Storage({projectId:config.projectId});
  const providerFailure=(error:unknown)=>{if(error instanceof Error&&error.message.startsWith("PROVIDER_"))return error;const code=error&&typeof error==="object"&&"code" in error?Number(error.code):0;const retryable=[4,8,10,13,14,429,500,502,503,504].includes(code);return new Error(`${retryable?"PROVIDER_TEMPORARY":"PROVIDER_PERMANENT"}: Google Vertex AI処理に失敗しました${code?` (${code})`:""}`);};
  const generate=async(parts:Part[],schema:Record<string,unknown>,generationConfig:Record<string,unknown>={})=>{
    try{
      const result=await genai.models.generateContent({model:config.model,contents:[{role:"user",parts}],config:{responseMimeType:"application/json",responseSchema:schema,...generationConfig}});
      return parseModelJson(result.text??"{}");
    }catch(error){throw providerFailure(error);}
  };
  return {
    async extract(input){
      const parts:Part[]=[{text:`訪問情報を抽出し、fields配列で返してください。帳票項目定義:${JSON.stringify(input.schema)}。推測できない値は作らず、valueは文字列、pageは1始まりのページ番号、excerptは原文の短い抜粋、confidenceは0から1です。`}];
      let temporaryObject:string|undefined;
      if(input.content&&input.content.byteLength>10*1024*1024){temporaryObject=`local-validation/vertex-input/${randomUUID()}`;try{await storage.bucket(config.inputBucket).file(temporaryObject).save(input.content,{resumable:true,metadata:{contentType:input.mimeType??"application/pdf",cacheControl:"no-store"}});}catch(error){throw providerFailure(error);}parts.push({fileData:{fileUri:`gs://${config.inputBucket}/${temporaryObject}`,mimeType:input.mimeType??"application/pdf"}});}
      else if(input.content)parts.push({inlineData:{data:input.content.toString("base64"),mimeType:input.mimeType??"application/pdf"}});
      else if(input.sourceUri)parts.push({fileData:{fileUri:input.sourceUri,mimeType:input.mimeType??"application/pdf"}});
      else parts.push({text:input.text??""});
      try{const parsed=await generate(parts,vertexExtractionOutputSchema());const fields=Array.isArray((parsed as {fields?:unknown}).fields)?(parsed as {fields:Array<Record<string,unknown>>}).fields:[];const allowed=new Set(input.schema.properties&&typeof input.schema.properties==="object"?Object.keys(input.schema.properties):[]);return {model:config.model,fields:fields.map(field=>({key:String(field.key??""),value:field.value,page:typeof field.page==="number"?field.page:null,excerpt:typeof field.excerpt==="string"?field.excerpt:null,confidence:typeof field.confidence==="number"?field.confidence:null})).filter(field=>field.key&&allowed.has(field.key))};}
      finally{if(temporaryObject)await storage.bucket(config.inputBucket).file(temporaryObject).delete({ignoreNotFound:true}).catch(()=>undefined);}
    },
    async prepareVisit(input){
      const referencedItem={
        type:"OBJECT",
        required:["title","description","sourceContentIds"],
        properties:{title:{type:"STRING"},description:{type:"STRING"},sourceContentIds:{type:"ARRAY",items:{type:"STRING"}}},
      };
      const schema={
        type:"OBJECT",
        required:["customerFacts","anticipatedPsychology","legalChecks","suggestedTalks","anticipatedQuestions"],
        properties:{
          customerFacts:{type:"ARRAY",items:{type:"OBJECT",required:["label","value"],properties:{label:{type:"STRING"},value:{type:"STRING"},sourceFieldKey:{type:"STRING",nullable:true}}}},
          anticipatedPsychology:{type:"ARRAY",items:{type:"OBJECT",required:["title","description","basisFieldKeys"],properties:{title:{type:"STRING"},description:{type:"STRING"},basisFieldKeys:{type:"ARRAY",items:{type:"STRING"}}}}},
          legalChecks:{type:"ARRAY",minItems:4,maxItems:4,items:referencedItem},
          suggestedTalks:{type:"ARRAY",items:{type:"OBJECT",required:["title","script","sourceContentIds"],properties:{title:{type:"STRING"},script:{type:"STRING"},sourceContentIds:{type:"ARRAY",items:{type:"STRING"}}}}},
          anticipatedQuestions:{type:"ARRAY",items:{type:"OBJECT",required:["question","answer","sourceContentIds"],properties:{question:{type:"STRING"},answer:{type:"STRING"},sourceContentIds:{type:"ARRAY",items:{type:"STRING"}}}}},
        },
      };
      const parsed=await generate([{text:`訪問前チェックを作成します。抽出済み事実と承認済みナレッジだけを使用し、推測は推測と明記してください。法令確認は必ず4項目。すべてのsourceFieldKey/sourceContentIdsは入力に存在するIDだけを返してください。\n抽出事実:${JSON.stringify(input.extractedFields)}\nナレッジ:${JSON.stringify(input.knowledge)}`}],schema) as Record<string,unknown>;
      const objects=(key:string)=>Array.isArray(parsed[key])?(parsed[key] as Array<Record<string,unknown>>):[];
      const validContent=new Set(input.knowledge.map(item=>item.id));
      const validFields=new Set(input.extractedFields.map(field=>field.key));
      const ids=(value:unknown)=>Array.isArray(value)?value.map(String).filter(id=>validContent.has(id)):[];
      return {
        model:config.model,
        customerFacts:objects("customerFacts").map(item=>({label:String(item.label??""),value:String(item.value??""),sourceFieldKey:typeof item.sourceFieldKey==="string"&&validFields.has(item.sourceFieldKey)?item.sourceFieldKey:null})).filter(item=>item.label&&item.value),
        anticipatedPsychology:objects("anticipatedPsychology").map(item=>({title:String(item.title??""),description:String(item.description??""),basisFieldKeys:Array.isArray(item.basisFieldKeys)?item.basisFieldKeys.map(String).filter(key=>validFields.has(key)):[]})).filter(item=>item.title&&item.description),
        legalChecks:objects("legalChecks").map(item=>({title:String(item.title??""),description:String(item.description??""),sourceContentIds:ids(item.sourceContentIds)})).filter(item=>item.title&&item.description).slice(0,4),
        suggestedTalks:objects("suggestedTalks").map(item=>({title:String(item.title??""),script:String(item.script??""),sourceContentIds:ids(item.sourceContentIds)})).filter(item=>item.title&&item.script),
        anticipatedQuestions:objects("anticipatedQuestions").map(item=>({question:String(item.question??""),answer:String(item.answer??""),sourceContentIds:ids(item.sourceContentIds)})).filter(item=>item.question&&item.answer),
      };
    },
    async answerKnowledge(input){
      const schema={type:"OBJECT",required:["answer","citationIds","suggestedQuestions"],properties:{answer:{type:"STRING"},citationIds:{type:"ARRAY",items:{type:"STRING"}},suggestedQuestions:{type:"ARRAY",items:{type:"STRING"}}}};
      const parsed=await generate([{text:`出張買取の業務支援です。承認済みナレッジだけを根拠に日本語で簡潔に回答してください。根拠が無い場合は分からないと答え、推測しないでください。価格・法令は入力の内容を超えて断定しないでください。citationIdsは入力に存在するIDだけを返してください。\n質問:${input.question}\nナレッジ:${JSON.stringify(input.knowledge)}`}],schema) as Record<string,unknown>;
      const validIds=new Set(input.knowledge.map(item=>item.id));
      const citationIds=Array.isArray(parsed.citationIds)?parsed.citationIds.map(String).filter(id=>validIds.has(id)):[];
      return{model:config.model,answer:String(parsed.answer??"").trim(),citationIds:[...new Set(citationIds)],suggestedQuestions:Array.isArray(parsed.suggestedQuestions)?parsed.suggestedQuestions.map(String).map(value=>value.trim()).filter(Boolean).slice(0,3):[]};
    },
    async assessTranscriptQuality(input){
      const {aliases,prompt}=prepareVertexTranscriptQualityInput(input);
      const schema={
        type:"OBJECT",required:["flags"],
        properties:{flags:{type:"ARRAY",maxItems:2,items:{
          type:"OBJECT",required:["type","confidence","evidenceSegmentIds"],
          properties:{
            type:{type:"STRING",enum:["possible_media","long_non_dialogue"]},
            confidence:{type:"NUMBER",minimum:0,maximum:1},
            evidenceSegmentIds:{type:"ARRAY",minItems:1,maxItems:5,items:{type:"STRING"}},
          },
        }}},
      };
      const parsed=await generate([{text:prompt}],schema,{temperature:0,maxOutputTokens:2048}) as {flags?:unknown};
      if(!Array.isArray(parsed.flags))throw new Error("PROVIDER_PERMANENT: transcript quality flags are invalid");
      const seen=new Set<string>();
      const flags=parsed.flags.map((raw)=>{
        if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("PROVIDER_PERMANENT: transcript quality flag is invalid");
        const item=raw as Record<string,unknown>;
        const type=String(item.type??"");
        if(type!=="possible_media"&&type!=="long_non_dialogue")throw new Error("PROVIDER_PERMANENT: transcript quality flag type is invalid");
        if(seen.has(type))throw new Error("PROVIDER_PERMANENT: duplicate transcript quality flag");
        seen.add(type);
        const confidence=Number(item.confidence);
        if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw new Error("PROVIDER_PERMANENT: transcript quality confidence is invalid");
        if(!Array.isArray(item.evidenceSegmentIds)||!item.evidenceSegmentIds.length)throw new Error("PROVIDER_PERMANENT: transcript quality evidence is required");
        const evidenceSegmentIds=[...new Set(item.evidenceSegmentIds.map(String).map(id=>aliases.get(id)).filter((id):id is string=>Boolean(id)))];
        if(evidenceSegmentIds.length!==new Set(item.evidenceSegmentIds.map(String)).size)throw new Error("PROVIDER_PERMANENT: transcript quality evidence references an unknown segment");
        return{type:type as "possible_media"|"long_non_dialogue",confidence,evidenceSegmentIds};
      });
      return{model:config.model,flags};
    },
    async review(input){
      if(input.modelName&&input.modelName!==config.model)throw new Error("PROVIDER_PERMANENT: approved prompt model does not match configured model");
      const dimensions=input.dimensions?.length?input.dimensions:[...reviewDimensions];
      const aliasToOriginal=new Map(input.segments.map((segment,index)=>[`E${String(index+1).padStart(4,"0")}`,segment.id]));
      const aliasedInput={...input,segments:input.segments.map((segment,index)=>({...segment,id:`E${String(index+1).padStart(4,"0")}`}))};
      const run=async(repair:boolean)=>{
        const repairInstruction=repair?"\n前回の応答は契約検証に失敗しました。文字数を抑え、必須項目をすべて埋め、evidenceSegmentIdsには上記発話のidを一字一句そのまま使用してください。":"";
        const parsed=await generate([{text:`${vertexReviewPrompt(aliasedInput)}${repairInstruction}`}],vertexReviewOutputSchema(dimensions),vertexReviewGenerationConfig(repair));
        const normalized=normalizeReviewOutput(parsed,config.model,dimensions);
        const findings=normalized.findings.map(finding=>({...finding,evidenceSegmentIds:finding.evidenceSegmentIds.map(id=>{const original=aliasToOriginal.get(id);if(!original)throw new Error("PROVIDER_PERMANENT: review evidence references an unknown segment");return original;})}));
        return{...normalized,findings};
      };
      try{return await run(false);}catch(error){if(!retryableReviewContractError(error))throw error;return run(true);}
    },
    async roleplay(input){
      const schema={type:"OBJECT",required:["customerReply","feedback"],properties:{customerReply:{type:"STRING"},feedback:{type:"ARRAY",minItems:1,items:{type:"OBJECT",required:["category","message"],properties:{category:{type:"STRING"},message:{type:"STRING"}}}}}};
      const run=async(repair:boolean)=>{const repairInstruction=repair?"\n前回はフィードバック契約に違反しました。feedbackを最低1件返してください。":"";const parsed=await generate([{text:`出張買取の接客研修です。顧客役として1回だけ返答し、スタッフへの短いfeedbackを最低1件返してください。点数・順位・人事評価は禁止です。シナリオ:${input.scenarioTitle}\n顧客像:${input.customerProfile}\n会話:${JSON.stringify(input.messages)}${repairInstruction}`}],schema,{temperature:repair?0.2:0.5,maxOutputTokens:1024});return normalizeRoleplayOutput(parsed,config.model);};
      try{return await run(false);}catch(error){if(!(error instanceof Error)||!error.message.startsWith("PROVIDER_PERMANENT: missing roleplay feedback"))throw error;return run(true);}
    },
  };
}

export function vertexExtractionOutputSchema():Record<string,unknown>{
  return {
    type:"OBJECT",
    required:["fields"],
    properties:{
      fields:{
        type:"ARRAY",
        items:{
          type:"OBJECT",
          required:["key","value","page","excerpt","confidence"],
          properties:{
            key:{type:"STRING"},
            value:{type:"STRING"},
            page:{type:"INTEGER",nullable:true},
            excerpt:{type:"STRING",nullable:true},
            confidence:{type:"NUMBER",nullable:true},
          },
        },
      },
    },
  };
}

export function createGoogleDriveProvider(config:DriveConfig):DriveProvider {
  const oauth=()=>new google.auth.OAuth2(config.clientId,config.clientSecret,config.redirectUri);
  const inspect=async(accessToken:string,fileId:string)=>{
    const client=oauth();client.setCredentials({access_token:accessToken});
    const drive=google.drive({version:"v3",auth:client});
    const meta=await drive.files.get({fileId,fields:"id,name,mimeType,size,modifiedTime,md5Checksum,version"});
    const mimeType=String(meta.data.mimeType??"");
    if(!mimeType.startsWith("audio/"))throw new Error("PROVIDER_PERMANENT: 音声ファイルを選択してください");
    const sizeBytes=Number(meta.data.size??0);
    if(!Number.isFinite(sizeBytes)||sizeBytes<=0||sizeBytes>1_000_000_000)throw new Error("PROVIDER_PERMANENT: Drive音声のサイズを確認してください");
    const sourceVersion=meta.data.version!=null?String(meta.data.version):String(meta.data.md5Checksum??"");
    if(!sourceVersion)throw new Error("PROVIDER_PERMANENT: Driveファイルの版を確認できません");
    return{client,drive,name:meta.data.name??null,mimeType,sizeBytes,sourceVersion,modifiedTime:meta.data.modifiedTime??null};
  };
  return {
    async exchangeAuthorizationCode(code){
      const client=oauth();
      const {tokens}=await client.getToken(code);
      if(!tokens.refresh_token||!tokens.access_token)throw new Error("PROVIDER_PERMANENT: Drive refresh token missing");
      const scopes=String(tokens.scope??"").split(" ").filter(Boolean);
      const driveFileScope="https://www.googleapis.com/auth/drive.file";
      if(!scopes.includes(driveFileScope))throw new Error("PROVIDER_PERMANENT: drive.file scope is required");
      if(scopes.some(scope=>scope!==driveFileScope))throw new Error("PROVIDER_PERMANENT: Drive scope exceeds the approved minimum");
      client.setCredentials(tokens);
      const about=await google.drive({version:"v3",auth:client}).about.get({fields:"user(permissionId,emailAddress)"});
      const providerAccountId=String(about.data.user?.permissionId??about.data.user?.emailAddress??"").trim();
      if(!providerAccountId)throw new Error("PROVIDER_PERMANENT: Drive account identifier missing");
      return {providerAccountId,refreshToken:tokens.refresh_token,accessToken:tokens.access_token,expiresAt:new Date(tokens.expiry_date??Date.now()+3600000).toISOString(),scopes};
    },
    async refreshAccessToken(refreshToken){
      const client=oauth();client.setCredentials({refresh_token:refreshToken});
      const token=await client.getAccessToken();
      if(!token.token)throw new Error("PROVIDER_TEMPORARY: Drive access token refresh failed");
      return token.token;
    },
    async revoke(token){try{await oauth().revokeToken(token);}catch(error){const code=error&&typeof error==="object"&&"code" in error?Number(error.code):0;if(code!==400)throw error;}},
    async inspectFile(input){const metadata=await inspect(input.accessToken,input.fileId);return{name:metadata.name,mimeType:metadata.mimeType,sizeBytes:metadata.sizeBytes,sourceVersion:metadata.sourceVersion,modifiedTime:metadata.modifiedTime};},
    async openFile(input){
      const metadata=await inspect(input.accessToken,input.fileId);
      const response=await metadata.drive.files.get({fileId:input.fileId,alt:"media"},{responseType:"stream"});
      return {source:response.data as Readable,mimeType:metadata.mimeType,sizeBytes:metadata.sizeBytes,sourceVersion:metadata.sourceVersion,modifiedTime:metadata.modifiedTime};
    },
  };
}

export function cloudRunAudience(workerUrl:string):string {
  const url=new URL(workerUrl);
  if(url.protocol!=="https:"||url.pathname!=="/internal/tasks"||url.search||url.hash)throw new Error("WORKER_TASK_URL must be an HTTPS URL ending in /internal/tasks");
  return url.origin;
}

function createTaskProvider(config:TaskConfig):TaskProvider {
  const tasks=new CloudTasksClient();
  const workerUrl=config.workerUrl.replace(/\/$/,"");
  const audience=cloudRunAudience(workerUrl);
  return {async dispatch(jobId,jobType,dispatchId){
    const parent=tasks.queuePath(config.projectId,config.location,config.queue);
    const taskName=`${parent}/tasks/${jobType}-${dispatchId.replace(/[^a-zA-Z0-9_-]/g,"-")}`;
    const task={name:taskName,dispatchDeadline:{seconds:600},httpRequest:{httpMethod:"POST" as const,url:`${workerUrl}/${jobType}`,headers:{"Content-Type":"application/json"},body:Buffer.from(JSON.stringify({job_id:jobId})).toString("base64"),oidcToken:{serviceAccountEmail:config.serviceAccount,audience}}};
    try{const [created]=await tasks.createTask({parent,task});return{taskName:String(created.name)};}
    catch(error){if(error&&typeof error==="object"&&"code" in error&&Number(error.code)===6)return{taskName};throw error;}
  }};
}

function googleAiConfig(inputBucket:string):AiConfig{return{projectId:projectId(),location:required("VERTEX_LOCATION"),model:required("VERTEX_AI_MODEL"),inputBucket};}
function googleDriveConfig():DriveConfig{return{clientId:required("GOOGLE_DRIVE_CLIENT_ID"),clientSecret:required("GOOGLE_DRIVE_CLIENT_SECRET"),redirectUri:required("GOOGLE_DRIVE_REDIRECT_URI")};}

export function createLocalConnectedProviders():PlatformProviders {
  const local=createLocalProviders();
  const project=projectId();
  return {
    ...local,
    mode:"local-connected",
    speech:createGoogleSpeechProvider({projectId:project,location:speechLocation(),inputBucket:required("STT_INPUT_BUCKET"),model:"chirp_3"}),
    ai:createGoogleAiProvider(googleAiConfig(required("STT_INPUT_BUCKET"))),
    drive:createGoogleDriveProvider(googleDriveConfig()),
  };
}

export function createGcpProviders():PlatformProviders {
  const project=projectId();
  const location=required("GCP_LOCATION");
  const bucket=required("GCS_PRIVATE_BUCKET");
  return {
    mode:"gcp",
    storage:createGcpStorageProvider({projectId:project,bucket}),
    tasks:createTaskProvider({projectId:project,location,queue:required("CLOUD_TASKS_QUEUE"),workerUrl:required("WORKER_TASK_URL"),serviceAccount:required("TASK_SERVICE_ACCOUNT")}),
    speech:createGoogleSpeechProvider({projectId:project,location:speechLocation(),inputBucket:bucket,model:"chirp_3"}),
    ai:createGoogleAiProvider(googleAiConfig(bucket)),
    drive:createGoogleDriveProvider(googleDriveConfig()),
  };
}
