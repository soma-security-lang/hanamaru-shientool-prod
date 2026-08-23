import { createHash,randomUUID } from "node:crypto";
import { createReadStream,createWriteStream,mkdirSync,readFileSync,unlinkSync,writeFileSync } from "node:fs";
import { link,mkdir,unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable,Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {reviewDimensions,type AiProvider,type DriveProvider,type PlatformProviders,type ReviewDimension,type SpeechProvider,type StorageProvider,type TaskProvider,type UploadDeclaration } from "./types.js";
import { probeAudioStream,probeVideoStream } from "./media.js";

const storageRoot=()=>process.env.LOCAL_STORAGE_DIR??join(tmpdir(),"hanamaru-local-storage");
const objectPath=(objectName:string)=>join(storageRoot(),`${createHash("sha256").update(objectName).digest("hex")}.bin`);
const fixtureMode=()=>process.env.NODE_ENV==="test"||process.env.LOCAL_PROVIDER_TEST_FIXTURES==="enabled";

export function acceptLocalUpload(objectName: string, declaration: UploadDeclaration, body: Buffer): void {
  if(body.byteLength!==declaration.sizeBytes)throw new Error("FILE_SIZE_INVALID");
  const digest=createHash("sha256").update(body).digest("hex");
  if(digest!==declaration.sha256)throw new Error("CHECKSUM_MISMATCH");
  mkdirSync(storageRoot(),{recursive:true});
  writeFileSync(objectPath(objectName),body,{flag:"wx",mode:0o600});
}

async function writeLocalStream(objectName:string,source:Readable,expectedSize:number,expectedSha256?:string):Promise<{sizeBytes:number;sha256:string}>{
  await mkdir(storageRoot(),{recursive:true});
  const destination=objectPath(objectName);const temporary=`${destination}.${randomUUID()}.upload`;
  const digest=createHash("sha256");let sizeBytes=0;
  const meter=new Transform({transform(chunk,_encoding,callback){const body=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);sizeBytes+=body.byteLength;digest.update(body);if(sizeBytes>expectedSize)return callback(new Error("FILE_SIZE_INVALID"));callback(null,body);}});
  try{
    await pipeline(source,meter,createWriteStream(temporary,{flags:"wx",mode:0o600}));
    if(sizeBytes!==expectedSize)throw new Error("FILE_SIZE_INVALID");
    const sha256=digest.digest("hex");if(expectedSha256&&sha256!==expectedSha256)throw new Error("CHECKSUM_MISMATCH");
    await link(temporary,destination);
    await unlink(temporary);
    return{sizeBytes,sha256};
  }catch(error){
    await unlink(temporary).catch(cleanupError=>{if((cleanupError as NodeJS.ErrnoException).code!=="ENOENT")throw cleanupError;});
    throw error;
  }
}

async function verifyLocalObject(objectName:string,expectedSize:number,expectedSha256:string):Promise<{sizeBytes:number;sha256:string}>{
  const digest=createHash("sha256");let sizeBytes=0;
  for await(const chunk of createReadStream(objectPath(objectName))){const body=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);sizeBytes+=body.byteLength;if(sizeBytes>expectedSize)throw new Error("FILE_SIZE_INVALID");digest.update(body);}
  if(sizeBytes!==expectedSize)throw new Error("FILE_SIZE_INVALID");
  const sha256=digest.digest("hex");if(sha256!==expectedSha256)throw new Error("CHECKSUM_MISMATCH");
  return{sizeBytes,sha256};
}

export async function acceptLocalUploadStream(objectName:string,declaration:UploadDeclaration,source:Readable):Promise<void>{await writeLocalStream(objectName,source,declaration.sizeBytes,declaration.sha256);}

function readLocalObject(sourceUri:string){
  const prefix="gs://local/";
  if(!sourceUri.startsWith(prefix))throw new Error("PROVIDER_PERMANENT: local object URI is invalid");
  return readFileSync(objectPath(sourceUri.slice(prefix.length)));
}

class LocalStorage implements StorageProvider {
  async createUpload(input: UploadDeclaration) { return { url:`/api/v1/local-uploads/${encodeURIComponent(input.objectName)}`,method:"PUT" as const,headers:{"content-type":input.mimeType,"x-content-sha256":input.sha256},expiresAt:input.expiresAt.toISOString() }; }
  async put(input:{organizationId:string;objectName:string;mimeType:string;body:Buffer;sha256?:string}){const digest=createHash("sha256").update(input.body).digest("hex");if(input.sha256&&input.sha256!==digest)throw new Error("CHECKSUM_MISMATCH");acceptLocalUpload(input.objectName,{organizationId:input.organizationId,objectName:input.objectName,mimeType:input.mimeType,sizeBytes:input.body.byteLength,sha256:digest,expiresAt:new Date(Date.now()+15*60_000)},input.body);return{bucket:"local",objectName:input.objectName,generation:"1",sizeBytes:input.body.byteLength,sha256:digest,mimeType:input.mimeType};}
  async putStream(input:{organizationId:string;objectName:string;mimeType:string;source:Readable;sizeBytes:number;sha256?:string}){const stored=await writeLocalStream(input.objectName,input.source,input.sizeBytes,input.sha256);return{bucket:"local",objectName:input.objectName,generation:"1",sizeBytes:stored.sizeBytes,sha256:stored.sha256,mimeType:input.mimeType};}
  async openRead(objectName:string,_generation:string,range?:{start:number;end:number}){return createReadStream(objectPath(objectName),range);}
  async probeAudio(objectName:string){if(fixtureMode())return{codec:"aac",format:"mov,mp4",durationMs:7200,sampleRate:48000,channels:1,bitRate:128000};return probeAudioStream(createReadStream(objectPath(objectName)));}
  async probeVideo(objectName:string){if(fixtureMode())return{videoCodec:"h264",audioCodec:"aac",format:"mov,mp4,m4a,3gp,3g2,mj2",durationMs:120000,width:1920,height:1080,frameRate:30,bitRate:4_000_000};return probeVideoStream(createReadStream(objectPath(objectName)));}
  async createDownload(objectName:string,_generation:string,mimeType:string){return{kind:"inline" as const,body:readFileSync(objectPath(objectName)),mimeType};}
  async verify(input: UploadDeclaration) { const verified=await verifyLocalObject(input.objectName,input.sizeBytes,input.sha256);return {bucket:"local",objectName:input.objectName,generation:"1",sizeBytes:verified.sizeBytes,sha256:verified.sha256,mimeType:input.mimeType}; }
  async deleteIncompleteUpload(objectName:string){try{unlinkSync(objectPath(objectName));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
  async delete(objectName:string) { try{unlinkSync(objectPath(objectName));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;} }
}

class LocalTasks implements TaskProvider { async dispatch(jobId:string,jobType:string,dispatchId:string){ return {taskName:`local/${jobType}/${jobId}/${dispatchId}`}; } }

class LocalSpeech implements SpeechProvider {
  async transcribe(input:Parameters<SpeechProvider["transcribe"]>[0]){
    if(fixtureMode())return {provider:"test-fixture" as const,model:"test-fixture" as const,location:"local-test",providerOperationId:"test-transcription",fullText:"本日はお時間をいただきありがとうございます。査定の根拠をご説明します。",segments:[{startMs:0,endMs:2800,speakerLabel:"1",speakerRole:"staff" as const,text:"本日はお時間をいただきありがとうございます。",confidence:.99},{startMs:3000,endMs:7200,speakerLabel:"1",speakerRole:"staff" as const,text:"査定の根拠をご説明します。",confidence:.99}]};
    void input;
    throw new Error("PROVIDER_PERMANENT: 利用者確認ではPROVIDER_MODE=local-connectedとSTT V2 chirp_3が必要です");
  }
}

async function pdfText(body:Buffer){
  const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document=await getDocument({data:new Uint8Array(body),useSystemFonts:true}).promise;
  const pages:string[]=[];
  for(let pageNo=1;pageNo<=document.numPages;pageNo++){
    const page=await document.getPage(pageNo);const content=await page.getTextContent();
    pages.push(content.items.map(item=>"str" in item?item.str:"").join(" ").replace(/\s+/g," ").trim());
  }
  return pages;
}

function firstMatch(text:string,patterns:RegExp[]){for(const pattern of patterns){const hit=text.match(pattern)?.[1]?.trim();if(hit)return hit;}return null;}

const visitFieldAliases:Record<string,string[]>= {
  visitDate:["visitDate","訪問予定日","訪問日","予定日"],
  visitTime:["visitTime","訪問予定時間","訪問時間","予定時間"],
  customerLabel:["customerLabel","customerName","お客様表示名","お客様名","顧客名","氏名"],
  appraisalItems:["appraisalItems","査定品","査定予定品","品物"],
  visitAddress:["visitAddress","住所","訪問先"],
  contact:["contact","連絡先","電話番号"],
  parking:["parking","駐車場"],
  campaign:["campaign","キャンペーン"],
  notes:["notes","備考"],
  assignedStaffName:["assignedStaffName","担当者","担当査定員","担当"],
};

function escaped(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
const allVisitLabels=Object.values(visitFieldAliases).flat().sort((a,b)=>b.length-a.length).map(escaped).join("|");
function labelledValue(text:string,aliases:string[]):string|null{
  const labels=aliases.sort((a,b)=>b.length-a.length).map(escaped).join("|");
  const match=text.match(new RegExp(`(?:${labels})\\s*(?:\\([^)]*\\))?\\s*[：:]?\\s*(.+?)(?=\\s+(?:(?:${allVisitLabels})\\s*(?:\\([^)]*\\))?|[A-Za-z][A-Za-z0-9_]*)\\s*[：:]|$)`,"i"));
  return match?.[1]?.trim()||null;
}

class LocalAi implements AiProvider {
  async extract(input:Parameters<AiProvider["extract"]>[0]){
    const properties=(input.schema.properties&&typeof input.schema.properties==="object"?input.schema.properties:{}) as Record<string,unknown>;
    try{
      const pages=input.content?await pdfText(input.content):input.sourceUri?await pdfText(readLocalObject(input.sourceUri)):[input.text??""];
      const text=pages.join("\n");
      if(!text.trim())throw new Error("PDFに抽出可能なテキストがありません");
      const fields:Array<{key:string;value:unknown;page:number|null;excerpt:string|null;confidence:number|null}>=[];
      for(const key of Object.keys(properties)){
        const aliases=visitFieldAliases[key];
        if(!aliases)continue;
        let value=key==="visitDate"
          ? firstMatch(text,[/(?:訪問予定日|訪問日|予定日|visitDate)\s*(?:\([^)]*\))?\s*[：:]?\s*(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?)/i,/(\d{4}[/-]\d{1,2}[/-]\d{1,2})/])
          : labelledValue(text,[...aliases]);
        if(key==="visitDate"&&value)value=value.replace(/年|月/g,"-").replace(/日/g,"").replaceAll("/","-");
        if(key==="visitTime"&&value)value=value.match(/(?:[01]\d|2[0-3]):[0-5]\d/)?.[0]??null;
        if(!value)continue;
        const pageIndex=pages.findIndex(page=>page.includes(value!));
        fields.push({key,value,page:pageIndex>=0?pageIndex+1:1,excerpt:value.slice(0,1000),confidence:key==="visitDate"?.93:.88});
      }
      if(!fields.length)throw new Error("必要項目をPDF本文から特定できませんでした");
      return {model:"local-pdf-text-v1",fields};
    }catch(error){
      if(!fixtureMode())throw new Error(`PROVIDER_PERMANENT: ${error instanceof Error?error.message:"PDF解析に失敗しました"}`);
      return {model:"test-deterministic-v1",fields:[
        {key:"visitDate",value:"2026-08-12",page:1,excerpt:"訪問予定日",confidence:.99},
        {key:"visitTime",value:"14:00",page:1,excerpt:"訪問予定時間",confidence:.99},
        {key:"customerLabel",value:"匿名顧客A",page:1,excerpt:"お客様表示名",confidence:.95},
        {key:"appraisalItems",value:"ブランドバッグ2点、腕時計1点",page:1,excerpt:"査定品",confidence:.95},
        {key:"visitAddress",value:"東京都サンプル区1-2-3",page:1,excerpt:"住所",confidence:.95},
        {key:"contact",value:"連絡は登録済み番号を使用",page:1,excerpt:"連絡先",confidence:.95},
        {key:"parking",value:"敷地内1台",page:1,excerpt:"駐車場",confidence:.95},
        {key:"campaign",value:"デモキャンペーン",page:1,excerpt:"キャンペーン",confidence:.95},
        {key:"notes",value:"匿名の訪問確認用メモ",page:1,excerpt:"備考",confidence:.95},
        {key:"assignedStaffName",value:"デモ査定員",page:1,excerpt:"担当",confidence:.95},
      ].filter(field=>field.key in properties)};
    }
  }
  async prepareVisit(input:Parameters<AiProvider["prepareVisit"]>[0]){
    if(!fixtureMode())throw new Error("PROVIDER_PERMANENT: 訪問前チェック生成にはPROVIDER_MODE=local-connectedが必要です");
    const first=input.extractedFields[0];const talk=input.knowledge.find(item=>item.type==="talk");const legal=input.knowledge.find(item=>item.type==="legal");
    const sourceContentIds=legal?[legal.id]:[];
    return{model:"test-deterministic-v1",customerFacts:input.extractedFields.map(field=>({label:field.key,value:String(field.value),sourceFieldKey:field.key})),anticipatedPsychology:[{title:"判断を急がず説明を確認したい",description:"資料上の事実だけを前提に、選択肢を丁寧に確認します。",basisFieldKeys:first?[first.key]:[]}],legalChecks:[{title:"勧誘意思の確認",description:"訪問目的を説明し、査定・売却の意思を明確に確認します。",sourceContentIds},{title:"退去意思の尊重",description:"退去を求められた場合は直ちに案内を終了します。",sourceContentIds},{title:"書面と説明の確認",description:"必要書面と重要事項を読み上げ、理解を確認します。",sourceContentIds},{title:"判断を急がせない",description:"断定や強要を避け、比較・保留を含む選択肢を伝えます。",sourceContentIds}],suggestedTalks:[{title:talk?.title??"査定の進め方",script:"査定だけでも大丈夫です。根拠をご説明した上で、ご判断はお客様にお任せします。",sourceContentIds:talk?[talk.id]:[]}],anticipatedQuestions:[{question:"今日は査定だけでも大丈夫ですか",answer:"はい。売却を急いで決める必要はありません。",sourceContentIds:talk?[talk.id]:[]}]};
  }
  async answerKnowledge(input:Parameters<AiProvider["answerKnowledge"]>[0]){if(!fixtureMode())throw new Error("PROVIDER_PERMANENT: AI支援にはPROVIDER_MODE=local-connectedが必要です");const first=input.knowledge[0];return{model:"test-deterministic-v1",answer:first?`${first.title}の内容を確認し、お客様の意思を尊重して案内してください。`:"該当する承認済み情報が見つかりませんでした。管理者へ確認してください。",citationIds:first?[first.id]:[],suggestedQuestions:["関連する法令上の注意点は？","お客様へどう説明する？"]};}
  async assessTranscriptQuality(input:Parameters<AiProvider["assessTranscriptQuality"]>[0]){
    if(!fixtureMode())throw new Error("PROVIDER_PERMANENT: 文字起こし品質判定にはPROVIDER_MODE=gcpが必要です");
    const media=input.segments.find(segment=>/番組|ポッドキャスト|動画|CM|ニュース/u.test(segment.text));
    return{model:"test-deterministic-v1",flags:media?[{type:"possible_media" as const,confidence:.95,evidenceSegmentIds:[media.id]}]:[]};
  }
  async review(input:Parameters<AiProvider["review"]>[0]){if(!fixtureMode())throw new Error("PROVIDER_PERMANENT: AI振り返りにはPROVIDER_MODE=gcpが必要です");const evidence=input.segments[0]?.id?[input.segments[0].id]:[];const dimensions=input.dimensions?.length?input.dimensions:reviewDimensions;return {model:"test-deterministic-v1",summary:"根拠を示しながら丁寧に説明できています。次回は選択肢を早めに確認します。",findings:[
    {category:"strength",title:"説明の導入",description:"相手へ配慮した導入ができています。",recommendedAction:null,evidenceSegmentIds:evidence},
    {category:"improvement",title:"選択肢の確認",description:"次の行動を複数提示すると判断しやすくなります。",recommendedAction:"比較・保留・売却の選択肢を確認する",evidenceSegmentIds:evidence},
    {category:"talk",title:"利用できたトーク",description:"査定根拠を説明するトークが使えています。",recommendedAction:null,evidenceSegmentIds:evidence},
    {category:"compliance",title:"法令観点",description:"断定的な誤認表現は検出されませんでした。",recommendedAction:null,evidenceSegmentIds:evidence},
    {category:"next_action",title:"次回の一歩",description:"顧客の比較軸を先に確認します。",recommendedAction:"価格以外の不安も質問する",evidenceSegmentIds:evidence},
    {category:"revisit",title:"再訪可能性",description:"説明継続の余地があります。",recommendedAction:"希望時期を確認する",evidenceSegmentIds:evidence}
  ].filter(finding=>dimensions.includes(finding.category as ReviewDimension)) as Awaited<ReturnType<AiProvider["review"]>>["findings"]};}
  async roleplay(input:Parameters<AiProvider["roleplay"]>[0]){if(!fixtureMode())throw new Error("PROVIDER_PERMANENT: AIロールプレイにはPROVIDER_MODE=gcpが必要です");const last=input.messages.at(-1)?.text??"";return{model:"test-deterministic-v1",customerReply:last.includes("査定")?"ありがとうございます。査定額の根拠も説明してもらえますか。":"今日は査定だけにしたいのですが、大丈夫でしょうか。",feedback:[{category:"intent",message:"お客様の意向を先に確認できています。"},{category:"next_action",message:"価格根拠を短く説明し、判断を急がせない選択肢を伝えましょう。"}]};}
}

class LocalDrive implements DriveProvider {
  async exchangeAuthorizationCode(code:string){if(!fixtureMode()||code!=="local-drive-fixture")throw new Error("PROVIDER_PERMANENT: Google Drive連携にはPROVIDER_MODE=gcpが必要です");return{providerAccountId:"local-account",refreshToken:"local-refresh",accessToken:"local-access",expiresAt:new Date(Date.now()+3600000).toISOString(),scopes:["https://www.googleapis.com/auth/drive.file"]};}
  async refreshAccessToken(refreshToken:string){if(!fixtureMode()||refreshToken!=="local-refresh")throw new Error("PROVIDER_PERMANENT: Google Drive連携にはPROVIDER_MODE=gcpが必要です");return"local-access";}
  async revoke(){return;}
  async inspectFile(input:Parameters<DriveProvider["inspectFile"]>[0]){void input;if(!fixtureMode())throw new Error("PROVIDER_PERMANENT: Google Drive連携にはPROVIDER_MODE=local-connectedが必要です");return{name:"匿名録音.m4a",mimeType:"audio/mp4",sizeBytes:25,sourceVersion:"drive-v1",modifiedTime:null};}
  async openFile(input:Parameters<DriveProvider["openFile"]>[0]){void input;if(!fixtureMode())throw new Error("PROVIDER_PERMANENT: Google Drive連携にはPROVIDER_MODE=local-connectedが必要です");const body=Buffer.from("local-drive-audio-fixture");return{source:Readable.from([body]),mimeType:"audio/mp4",sizeBytes:body.byteLength,sourceVersion:"drive-v1",modifiedTime:null};}
}

export function createLocalProviders():PlatformProviders { return {storage:new LocalStorage(),tasks:new LocalTasks(),speech:new LocalSpeech(),ai:new LocalAi(),drive:new LocalDrive(),mode:"local"}; }
