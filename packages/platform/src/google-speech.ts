import { randomUUID } from "node:crypto";
import { v2 } from "@google-cloud/speech";
import { Storage } from "@google-cloud/storage";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import type { SpeechProvider } from "./types.js";

export const CHIRP3_MODEL = "chirp_3" as const;

export interface GoogleSpeechConfig {
  projectId: string;
  location: "asia-northeast1"|"us";
  inputBucket: string;
  model?: typeof CHIRP3_MODEL;
}

type DurationLike = string|{ seconds?: number|string|{toString():string}|null; nanos?: number|null }|null|undefined;
type WordLike = { startOffset?:DurationLike;endOffset?:DurationLike;word?:string|null;confidence?:number|null;speakerLabel?:string|null };
type ResultLike = {resultEndOffset?:DurationLike;alternatives?:Array<{transcript?:string|null;confidence?:number|null;words?:WordLike[]|null}>|null};
type TranscriptLike = {results?:ResultLike[]|null};
type CloudStorageResultLike = {uri?:string|null;srtFormatUri?:string|null};
type FileResultLike = {error?:{code?:number|null;message?:string|null}|null;uri?:string|null;srtFormatUri?:string|null;cloudStorageResult?:CloudStorageResultLike|null;inlineResult?:{transcript?:TranscriptLike|null;srtCaptions?:string|null}|null;transcript?:TranscriptLike|null};
type BatchResponseLike = {results?:Record<string,FileResultLike>|ResultLike[]|null};

const sttTemporaryPrefix="local-validation/stt-input/";
const maxTranscriptOutputBytes=64*1024*1024;
// Chirp 3 accepts at most 20 minutes when word timestamps are enabled. SRT
// requires those timestamps, so leave a one-minute safety margin per chunk.
const maxTimestampedChunkMs=19*60*1000;
// Long recordings have exhibited provider-side LRO stalls on specific 19-minute
// sections. Smaller chunks isolate those sections without changing the audio or
// model and keep an eight-hour recording within 48 operations.
const longAudioThresholdMs=60*60*1000;
const longAudioChunkMs=10*60*1000;
const compositeOperationPrefix="hanamaru-chirp3-chunks:v1:";

type ChunkPlan={index:number;startMs:number;durationMs:number};
type ChunkOperation={name:string;startMs:number};
type ChunkOperationManifest={version:1;chunks:ChunkOperation[]};
type BatchOperationLike={name?:string|null;cancel():Promise<unknown>;promise():Promise<unknown[]>};

export function chirp3ChunkPlan(durationMs:number):ChunkPlan[]{
  if(!Number.isSafeInteger(durationMs)||durationMs<=0||durationMs>8*60*60*1000)throw new Error("PROVIDER_PERMANENT: STT音声時間が不正です");
  const chunkMs=durationMs>longAudioThresholdMs?longAudioChunkMs:maxTimestampedChunkMs;
  const chunks:ChunkPlan[]=[];
  for(let startMs=0,index=0;startMs<durationMs;startMs+=chunkMs,index+=1){
    chunks.push({index,startMs,durationMs:Math.min(chunkMs,durationMs-startMs)});
  }
  return chunks;
}

function encodeChunkOperations(chunks:ChunkOperation[]):string{
  return `${compositeOperationPrefix}${Buffer.from(JSON.stringify({version:1,chunks} satisfies ChunkOperationManifest)).toString("base64url")}`;
}

function decodeChunkOperations(value:string):ChunkOperation[]|null{
  if(!value.startsWith(compositeOperationPrefix))return null;
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.from(value.slice(compositeOperationPrefix.length),"base64url").toString("utf8"));}
  catch{throw new Error("PROVIDER_PERMANENT: STT chunk operation state is invalid");}
  if(!parsed||typeof parsed!=="object"||!("version" in parsed)||(parsed as {version:unknown}).version!==1||!("chunks" in parsed)||!Array.isArray((parsed as {chunks:unknown}).chunks))throw new Error("PROVIDER_PERMANENT: STT chunk operation state is invalid");
  const chunks=(parsed as ChunkOperationManifest).chunks;
  if(!chunks.length||chunks.length>48||chunks.some((chunk,index)=>typeof chunk.name!=="string"||!chunk.name||!Number.isSafeInteger(chunk.startMs)||chunk.startMs<0||(index>0&&chunk.startMs<=chunks[index-1]!.startMs)))throw new Error("PROVIDER_PERMANENT: STT chunk operation state is invalid");
  return chunks;
}

export function mergeChirp3Chunks(results:Array<{startMs:number;result:ReturnType<typeof parseChirp3BatchResponse>}>,providerOperationId:string){
  if(!results.length)throw new Error("PROVIDER_PERMANENT: STT chunk result is empty");
  const ordered=[...results].sort((left,right)=>left.startMs-right.startMs);
  const fullText=ordered.map(item=>item.result.fullText.trim()).filter(Boolean).join("\n");
  const segments:ReturnType<typeof parseChirp3BatchResponse>["segments"]=[];
  for(const [chunkIndex,item] of ordered.entries()){
    const nextChunkStart=ordered[chunkIndex+1]?.startMs??Number.POSITIVE_INFINITY;
    for(const segment of item.result.segments){
      // ffmpeg cuts on codec frame boundaries and Google can consequently
      // return an SRT cue a few milliseconds beyond the requested chunk.
      // The next chunk owns that overlap, so clip it at the exact boundary.
      const previousEnd=segments.at(-1)?.endMs??0;
      const startMs=Math.max(item.startMs+segment.startMs,previousEnd);
      const endMs=Math.min(item.startMs+segment.endMs,nextChunkStart);
      if(endMs<=startMs)continue;
      segments.push({
        ...segment,
        startMs,
        endMs,
        speakerLabel:segment.speakerLabel?`chunk-${chunkIndex+1}:${segment.speakerLabel}`:null,
      });
    }
  }
  if(!fullText||!segments.length||segments.some((segment,index)=>segment.endMs<=segment.startMs||(index>0&&segment.startMs<segments[index-1]!.endMs)))throw new Error("PROVIDER_PERMANENT: STT chunk result timeline is invalid");
  return{provider:"google-cloud-speech-to-text-v2" as const,model:CHIRP3_MODEL,location:results[0]!.result.location,providerOperationId,fullText,segments};
}

function seconds(value:DurationLike):number{
  if(!value)return 0;
  if(typeof value==="string"){
    const parsed=Number(value.endsWith("s")?value.slice(0,-1):value);
    return Number.isFinite(parsed)?parsed:0;
  }
  const raw=value.seconds;
  const whole=typeof raw==="object"&&raw!==null?Number(raw.toString()):Number(raw??0);
  return (Number.isFinite(whole)?whole:0)+Number(value.nanos??0)/1_000_000_000;
}

function appendWord(current:string,next:string):string{
  if(!current)return next;
  return /[A-Za-z0-9]$/.test(current)&&/^[A-Za-z0-9]/.test(next)?`${current} ${next}`:`${current}${next}`;
}

function captionTimestamp(value:string):number{
  const match=value.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/u);
  if(!match)return -1;
  return ((Number(match[1])*60*60+Number(match[2])*60+Number(match[3]))*1000)+Number(match[4]);
}

function captionKey(value:string):string{
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu,"");
}

type CaptionCue={startMs:number;endMs:number;text:string};
function parseSrt(value:string):CaptionCue[]{
  const cues:CaptionCue[]=[];
  for(const block of value.replace(/\r/g,"").split(/\n{2,}/u)){
    const lines=block.split("\n").filter(Boolean);
    const timingIndex=lines.findIndex(line=>line.includes(" --> "));
    if(timingIndex<0)continue;
    const [startRaw,endRaw]=lines[timingIndex]!.split(" --> ");
    const startMs=captionTimestamp(startRaw??""),endMs=captionTimestamp(endRaw??"");
    const text=lines.slice(timingIndex+1).join(" ").trim();
    if(startMs>=0&&endMs>=startMs&&text)cues.push({startMs,endMs,text});
  }
  return cues;
}

function captionSegments(results:ResultLike[],captionsSrt:string){
  const words=results.flatMap(result=>result.alternatives?.[0]?.words??[]).filter(word=>String(word.word??"").trim());
  const cues=parseSrt(captionsSrt);
  if(!words.length||!cues.length)return [];
  const segments:Array<{startMs:number;endMs:number;speakerLabel:string|null;speakerRole:"unknown";text:string;confidence:number|null}>=[];
  let wordIndex=0;
  let timelineEnd=0;
  for(const cue of cues){
    const cueStart=Math.max(cue.startMs,timelineEnd);
    if(cue.endMs<=cueStart)continue;
    const targetLength=Math.max(1,captionKey(cue.text).length);
    const selected:WordLike[]=[];
    let selectedLength=0;
    while(wordIndex<words.length&&(selectedLength<targetLength||!selected.length)){
      const word=words[wordIndex++]!;
      selected.push(word);
      selectedLength+=Math.max(1,captionKey(String(word.word??"")).length);
    }
    if(!selected.length){segments.push({startMs:cueStart,endMs:cue.endMs,text:cue.text,speakerLabel:null,speakerRole:"unknown",confidence:null});timelineEnd=cue.endMs;continue;}
    const runs:Array<{speakerLabel:string|null;text:string;weight:number;confidence:number|null}>=[];
    for(const word of selected){
      const text=String(word.word??"").trim();
      const speakerLabel=word.speakerLabel?String(word.speakerLabel):null;
      const previous=runs.at(-1);
      if(previous&&previous.speakerLabel===speakerLabel){
        previous.text=appendWord(previous.text,text);
        previous.weight+=Math.max(1,captionKey(text).length);
        if(word.confidence!=null)previous.confidence=previous.confidence==null?word.confidence:Math.min(previous.confidence,word.confidence);
      }else runs.push({speakerLabel,text,weight:Math.max(1,captionKey(text).length),confidence:word.confidence??null});
    }
    const totalWeight=runs.reduce((sum,run)=>sum+run.weight,0);
    let cursor=cueStart;
    for(const [index,run] of runs.entries()){
      const endMs=index===runs.length-1?cue.endMs:Math.max(cursor,Math.round(cueStart+(cue.endMs-cueStart)*(runs.slice(0,index+1).reduce((sum,item)=>sum+item.weight,0)/totalWeight)));
      segments.push({startMs:cursor,endMs,speakerLabel:run.speakerLabel,speakerRole:"unknown",text:run.text,confidence:run.confidence});
      cursor=endMs;
    }
    timelineEnd=cue.endMs;
  }
  if(wordIndex<words.length){
    const previous=segments.at(-1);const remainder=words.slice(wordIndex).reduce((text,word)=>appendWord(text,String(word.word??"").trim()),"");
    if(remainder&&previous)previous.text=appendWord(previous.text,remainder);
  }
  return segments;
}

export function buildChirp3BatchRequest(config:GoogleSpeechConfig,inputUri:string,languageCode:string,phrases:string[]=[],outputUri?:string){
  // Chirp 3 currently returns a file-level INTERNAL error when inline phrase
  // adaptation and speaker diarization are combined. Keep diarization, which
  // is required for review evidence, and omit the optional boost until Google
  // exposes a compatible contract for this combination.
  void phrases;
  return {
    recognizer:`projects/${config.projectId}/locations/${config.location}/recognizers/_`,
    config:{
      autoDecodingConfig:{},
      model:CHIRP3_MODEL,
      languageCodes:[languageCode],
      features:{
        enableAutomaticPunctuation:true,
        // Google requires word offsets whenever SRT output is requested.
        // The SRT timeline is used as the authoritative segment boundary;
        // native JSON remains the source for Chirp 3 diarization labels.
        enableWordTimeOffsets:true,
        diarizationConfig:{minSpeakerCount:2,maxSpeakerCount:2}
      },
      denoiserConfig:{denoiseAudio:true},
    },
    files:[{uri:inputUri}],
    recognitionOutputConfig:outputUri?{gcsOutputConfig:{uri:outputUri},outputFormatConfig:{native:{},srt:{}}}:{inlineResponseConfig:{}}
  };
}

export function parseChirp3BatchResponse(response:BatchResponseLike,operationId:string,location:string,captionsSrt?:string){
  const raw=response.results;
  const fileResult=!Array.isArray(raw)?Object.values(raw??{})[0]:undefined;
  if(fileResult&&Number(fileResult.error?.code??0)!==0)throw new Error(`PROVIDER_PERMANENT: STT処理に失敗しました (${fileResult.error?.code??"unknown"})`);
  const results=Array.isArray(raw)?raw:fileResult?.inlineResult?.transcript?.results??fileResult?.transcript?.results??[];
  if(!results.length)throw new Error("PROVIDER_PERMANENT: STT応答に文字起こし結果がありません");
  const fullText=results.map(result=>String(result.alternatives?.[0]?.transcript??"").trim()).filter(Boolean).join("\n");
  if(!fullText)throw new Error("PROVIDER_PERMANENT: STT文字起こし結果が空でした");
  const timedFromCaptions=captionsSrt?captionSegments(results,captionsSrt):[];
  if(timedFromCaptions.length)return {provider:"google-cloud-speech-to-text-v2" as const,model:CHIRP3_MODEL,location,providerOperationId:operationId,fullText,segments:timedFromCaptions};
  const segments:Array<{startMs:number;endMs:number;speakerLabel:string|null;speakerRole:"unknown";text:string;confidence:number|null}>=[];
  let fallbackStart=0;
  for(const result of results){
    const alternative=result.alternatives?.[0];
    if(!alternative)continue;
    const words=alternative.words??[];
    if(!words.length){
      const end=Math.max(fallbackStart,Math.round(seconds(result.resultEndOffset)*1000));
      const text=String(alternative.transcript??"").trim();
      if(text)segments.push({startMs:fallbackStart,endMs:end,speakerLabel:null,speakerRole:"unknown",text,confidence:alternative.confidence??null});
      fallbackStart=end;
      continue;
    }
    for(const word of words){
      const text=String(word.word??"").trim();
      if(!text)continue;
      const startMs=Math.max(0,Math.round(seconds(word.startOffset)*1000));
      const endMs=Math.max(startMs,Math.round(seconds(word.endOffset)*1000));
      const speakerLabel=word.speakerLabel?String(word.speakerLabel):null;
      const previous=segments.at(-1);
      if(previous&&previous.speakerLabel===speakerLabel&&startMs-previous.endMs<=1200){
        previous.text=appendWord(previous.text,text);
        previous.endMs=Math.max(previous.endMs,endMs);
        if(word.confidence!=null)previous.confidence=previous.confidence==null?word.confidence:Math.min(previous.confidence,word.confidence);
      }else{
        segments.push({startMs,endMs,speakerLabel,speakerRole:"unknown",text,confidence:word.confidence??alternative.confidence??null});
      }
      fallbackStart=Math.max(fallbackStart,endMs);
    }
  }
  if(!segments.length)segments.push({startMs:0,endMs:fallbackStart,speakerLabel:null,speakerRole:"unknown",text:fullText,confidence:null});
  return {provider:"google-cloud-speech-to-text-v2" as const,model:CHIRP3_MODEL,location,providerOperationId:operationId,fullText,segments};
}

export function createGoogleSpeechProvider(config:GoogleSpeechConfig):SpeechProvider{
  if(config.model&&config.model!==CHIRP3_MODEL)throw new Error("SPEECH_MODEL must be chirp_3");
  if(config.location!=="asia-northeast1"&&config.location!=="us")throw new Error("SPEECH_LOCATION must be asia-northeast1 or us for chirp_3");
  const speech=new v2.SpeechClient({apiEndpoint:`${config.location}-speech.googleapis.com`});
  const storage=new Storage({projectId:config.projectId});
  function providerError(error:unknown):Error{
    if(error instanceof Error&&error.message.startsWith("PROVIDER_"))return error;
    const code=error&&typeof error==="object"&&"code" in error?Number(error.code):0;
    const retryable=[4,8,10,13,14].includes(code);
    return new Error(`${retryable?"PROVIDER_TEMPORARY":"PROVIDER_PERMANENT"}: Google STT V2 chirp_3処理に失敗しました${code?` (${code})`:""}`);
  }
  async function cleanup(cleanupToken:string|null):Promise<void>{
    if(!cleanupToken)return;
    if(!cleanupToken.startsWith(sttTemporaryPrefix))throw new Error("PROVIDER_PERMANENT: invalid STT cleanup token");
    const bucket=storage.bucket(config.inputBucket);
    // Legacy tokens referred to one object. New tokens are a per-operation
    // prefix containing an optional staged input and the GCS transcript output.
    if(!cleanupToken.endsWith("/")){
      const [files]=await bucket.getFiles({prefix:`${cleanupToken}/`,versions:true});
      if(files.length){
        await Promise.all(files.map(file=>file.delete({ignoreNotFound:true})));
        return;
      }
    }
    await bucket.file(cleanupToken).delete({ignoreNotFound:true});
  }
  async function stage(input:Parameters<SpeechProvider["transcribe"]>[0],cleanupToken:string):Promise<string>{
    if(input.uri)return input.uri;
    if(!input.content&&!input.stream)throw new Error("PROVIDER_PERMANENT: STT入力がありません");
    const inputObject=`${cleanupToken}/input`;
    const file=storage.bucket(config.inputBucket).file(inputObject);
    try{
      if(input.stream){
        await pipeline(input.stream,file.createWriteStream({resumable:(input.sizeBytes??0)>=8*1024*1024,validation:"crc32c",metadata:{contentType:input.mimeType,cacheControl:"private, no-store"}}));
      }else{
        await file.save(input.content!,{resumable:input.content!.byteLength>=8*1024*1024,metadata:{contentType:input.mimeType,cacheControl:"private, no-store"}});
      }
      return `gs://${config.inputBucket}/${inputObject}`;
    }catch(error){
      await cleanup(cleanupToken).catch(()=>undefined);
      throw providerError(error);
    }
  }
  async function stageChunk(inputUri:string,cleanupToken:string,chunk:ChunkPlan):Promise<string>{
    const bucketPrefix=`gs://${config.inputBucket}/`;
    if(!inputUri.startsWith(bucketPrefix))throw new Error("PROVIDER_PERMANENT: STT chunk source is outside the private bucket");
    const sourceObjectName=inputUri.slice(bucketPrefix.length);
    if(!sourceObjectName||sourceObjectName.includes(".."))throw new Error("PROVIDER_PERMANENT: STT chunk source is invalid");
    const [sourceUrl]=await storage.bucket(config.inputBucket).file(sourceObjectName).getSignedUrl({version:"v4",action:"read",expires:Date.now()+30*60_000});
    const chunkObjectName=`${cleanupToken}/chunks/${String(chunk.index).padStart(3,"0")}.flac`;
    const chunkFile=storage.bucket(config.inputBucket).file(chunkObjectName);
    const child=spawn("ffmpeg",[
      "-v","error","-nostdin","-ss",(chunk.startMs/1000).toFixed(3),"-t",(chunk.durationMs/1000).toFixed(3),
      "-i",sourceUrl,"-vn","-map_metadata","-1","-ac","1","-ar","16000","-c:a","flac","-f","flac","pipe:1",
    ],{stdio:["ignore","pipe","pipe"]});
    child.stderr.resume();
    const exited=new Promise<void>((resolve,reject)=>{
      child.once("error",reject);
      child.once("close",code=>code===0?resolve():reject(new Error("PROVIDER_PERMANENT: STT音声chunkの生成に失敗しました")));
    });
    try{
      await Promise.all([
        pipeline(child.stdout,chunkFile.createWriteStream({resumable:true,validation:"crc32c",preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:"audio/flac",cacheControl:"private, no-store"}})),
        exited,
      ]);
      return `gs://${config.inputBucket}/${chunkObjectName}`;
    }catch(error){
      child.kill("SIGKILL");
      await chunkFile.delete({ignoreNotFound:true}).catch(()=>undefined);
      throw providerError(error);
    }
  }
  async function loadTranscript(response:BatchResponseLike,operationId:string){
    const raw=response.results;
    const fileResult=!Array.isArray(raw)?Object.values(raw??{})[0]:undefined;
    if(!fileResult)return parseChirp3BatchResponse(response,operationId,config.location);
    if(Number(fileResult.error?.code??0)!==0)return parseChirp3BatchResponse(response,operationId,config.location);
    const nativeUri=fileResult.uri??fileResult.cloudStorageResult?.uri??null;
    const srtUri=fileResult.srtFormatUri??fileResult.cloudStorageResult?.srtFormatUri??null;
    if(!nativeUri)return parseChirp3BatchResponse(response,operationId,config.location,fileResult.inlineResult?.srtCaptions??undefined);
    const expectedPrefix=`gs://${config.inputBucket}/${sttTemporaryPrefix}`;
    const download=async(uri:string,label:string)=>{
      if(!uri.startsWith(expectedPrefix))throw new Error(`PROVIDER_PERMANENT: STT${label}出力先が許可bucket外です`);
      const objectName=uri.slice(`gs://${config.inputBucket}/`.length);
      if(!objectName||objectName.includes(".."))throw new Error(`PROVIDER_PERMANENT: STT${label}出力objectが不正です`);
      const file=storage.bucket(config.inputBucket).file(objectName);
      const [metadata]=await file.getMetadata();
      const size=Number(metadata.size??0);
      if(!Number.isSafeInteger(size)||size<=0||size>maxTranscriptOutputBytes)throw new Error(`PROVIDER_PERMANENT: STT${label}出力サイズが不正です`);
      const [body]=await file.download({validation:"crc32c"});
      if(body.byteLength!==size)throw new Error(`PROVIDER_PERMANENT: STT${label}出力サイズが一致しません`);
      return body;
    };
    const body=await download(nativeUri,"JSON");
    let parsed:BatchResponseLike;
    try{parsed=JSON.parse(body.toString("utf8")) as BatchResponseLike;}
    catch{throw new Error("PROVIDER_PERMANENT: STT出力JSONを解析できません");}
    const captions=srtUri?(await download(srtUri,"SRT")).toString("utf8"):undefined;
    const result=parseChirp3BatchResponse(parsed,operationId,config.location,captions);
    if(result.segments.some(segment=>segment.endMs<=segment.startMs))throw new Error("PROVIDER_PERMANENT: STT区間時刻を取得できません");
    return result;
  }
  async function start(input:Parameters<SpeechProvider["transcribe"]>[0]){
    const cleanupToken=`${sttTemporaryPrefix}${randomUUID()}`;
    const stagedUri=await stage(input,cleanupToken);
    const chunks=input.durationMs&&input.durationMs>maxTimestampedChunkMs?chirp3ChunkPlan(input.durationMs):null;
    const operations:Array<{operation:BatchOperationLike;startMs:number}>=[];
    try{
      if(chunks){
        for(const chunk of chunks){
          const chunkUri=await stageChunk(stagedUri,cleanupToken,chunk);
          const outputUri=`gs://${config.inputBucket}/${cleanupToken}/output/${String(chunk.index).padStart(3,"0")}/`;
          const [operation]=await speech.batchRecognize(buildChirp3BatchRequest(config,chunkUri,input.languageCode,input.phrases,outputUri));
          const name=String(operation.name??"");
          if(!name)throw new Error("PROVIDER_PERMANENT: STT operation id is missing");
          operations.push({operation,startMs:chunk.startMs});
        }
        return{operations,providerOperationId:encodeChunkOperations(operations.map(item=>({name:String(item.operation.name),startMs:item.startMs}))),cleanupToken};
      }
      const outputUri=`gs://${config.inputBucket}/${cleanupToken}/output/`;
      const [operation]=await speech.batchRecognize(buildChirp3BatchRequest(config,stagedUri,input.languageCode,input.phrases,outputUri));
      const providerOperationId=String(operation.name??"");
      if(!providerOperationId)throw new Error("PROVIDER_PERMANENT: STT operation id is missing");
      operations.push({operation,startMs:0});
      return {operations,providerOperationId,cleanupToken};
    }catch(error){
      await Promise.allSettled(operations.map(item=>item.operation.cancel()));
      await cleanup(cleanupToken).catch(()=>undefined);
      throw providerError(error);
    }
  }
  async function cancel(providerOperationId:string,cleanupToken:string|null):Promise<void>{
    const chunks=decodeChunkOperations(providerOperationId);
    const names=chunks?chunks.map(chunk=>chunk.name):[providerOperationId];
    const results=await Promise.allSettled(names.map(async name=>{
      const operation=await speech.checkBatchRecognizeProgress(name);
      if(!operation.done)await operation.cancel();
    }));
    await cleanup(cleanupToken);
    const rejected=results.find((result):result is PromiseRejectedResult=>result.status==="rejected");
    if(rejected)throw providerError(rejected.reason);
  }
  return {
    async startTranscription(input){
      const started=await start(input);
      return {providerOperationId:started.providerOperationId,cleanupToken:started.cleanupToken};
    },
    async pollTranscription(providerOperationId){
      try{
        const chunks=decodeChunkOperations(providerOperationId);
        if(chunks){
          const operations=await Promise.all(chunks.map(chunk=>speech.checkBatchRecognizeProgress(chunk.name)));
          if(operations.some(operation=>!operation.done))return{status:"pending" as const};
          const results=[];
          for(const [index,operation] of operations.entries()){
            if(operation.error)throw operation.error;
            if(!operation.result)throw new Error("PROVIDER_PERMANENT: STT chunk operation completed without a result");
            results.push({startMs:chunks[index]!.startMs,result:await loadTranscript(operation.result as BatchResponseLike,chunks[index]!.name)});
          }
          return{status:"succeeded" as const,result:mergeChirp3Chunks(results,providerOperationId)};
        }
        const operation=await speech.checkBatchRecognizeProgress(providerOperationId);
        if(!operation.done)return {status:"pending" as const};
        if(operation.error)throw operation.error;
        if(!operation.result)throw new Error("PROVIDER_PERMANENT: STT operation completed without a result");
        return {status:"succeeded" as const,result:await loadTranscript(operation.result as BatchResponseLike,providerOperationId)};
      }catch(error){
        throw providerError(error);
      }
    },
    async cleanupTranscription(cleanupToken){
      await cleanup(cleanupToken);
    },
    async cancelTranscription(providerOperationId,cleanupToken){
      await cancel(providerOperationId,cleanupToken);
    },
    async transcribe(input){
      const started=await start(input);
      try{
        const results=[];
        for(const item of started.operations){
          const [response]=await item.operation.promise();
          results.push({startMs:item.startMs,result:await loadTranscript(response as BatchResponseLike,String(item.operation.name))});
        }
        return results.length===1?{...results[0]!.result,providerOperationId:started.providerOperationId}:mergeChirp3Chunks(results,started.providerOperationId);
      }catch(error){
        throw providerError(error);
      }finally{
        await cleanup(started.cleanupToken).catch(()=>undefined);
      }
    }
  };
}
