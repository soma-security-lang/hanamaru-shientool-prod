import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface AudioMetadata {codec:string;format:string;durationMs:number;sampleRate:number;channels:number;bitRate:number|null;}
export interface VideoMetadata {videoCodec:string;audioCodec:string|null;format:string;durationMs:number;width:number;height:number;frameRate:number|null;bitRate:number|null;}

const allowedCodecs=new Set(["aac","mp3","opus","vorbis","flac","alac","amr_nb","amr_wb","pcm_s16le","pcm_s24le","pcm_s32le","pcm_f32le"]);

export async function probeAudioSource(inputPathOrUrl:string):Promise<AudioMetadata>{
  let child:ReturnType<typeof spawn>|undefined;
  try{
    child=spawn("ffprobe",["-v","error","-print_format","json","-show_format","-show_streams",inputPathOrUrl],{stdio:["ignore","pipe","pipe"]});
    if(!child.stdout||!child.stderr)throw new Error("PROVIDER_PERMANENT: 音声検査processを開始できません");
    const stdout:Buffer[]=[];let stdoutBytes=0;
    child.stdout.on("data",chunk=>{const body=Buffer.from(chunk);stdoutBytes+=body.byteLength;if(stdoutBytes<=1_000_000)stdout.push(body);else child?.kill("SIGKILL");});
    child.stderr.resume();
    const code=await new Promise<number>((resolve,reject)=>{child!.once("error",reject);child!.once("close",value=>resolve(value??-1));});
    if(code!==0||stdoutBytes>1_000_000)throw new Error("PROVIDER_PERMANENT: 音声ファイルを解析できません");
    let parsed:{streams?:Array<Record<string,unknown>>;format?:Record<string,unknown>};try{parsed=JSON.parse(Buffer.concat(stdout).toString("utf8")) as typeof parsed;}catch{throw new Error("PROVIDER_PERMANENT: 音声検査結果を解析できません");}
    const audio=(parsed.streams??[]).find(stream=>stream.codec_type==="audio");if(!audio)throw new Error("PROVIDER_PERMANENT: 音声streamがありません");
    const codec=String(audio.codec_name??"");if(!allowedCodecs.has(codec))throw new Error("PROVIDER_PERMANENT: 対応していない音声codecです");
    const durationSeconds=Number(audio.duration??parsed.format?.duration??0);const durationMs=Math.round(durationSeconds*1000);if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>8*60*60*1000)throw new Error("PROVIDER_PERMANENT: 音声の長さは8時間以内にしてください");
    const sampleRate=Number(audio.sample_rate??0);if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error("PROVIDER_PERMANENT: 音声sample rateを確認してください");
    const channels=Number(audio.channels??0);if(!Number.isInteger(channels)||channels<1||channels>2)throw new Error("PROVIDER_PERMANENT: 音声は1または2 channelにしてください");
    const rawBitRate=Number(audio.bit_rate??parsed.format?.bit_rate??0);const bitRate=Number.isFinite(rawBitRate)&&rawBitRate>0?Math.round(rawBitRate):null;
    return{codec,format:String(parsed.format?.format_name??"unknown").slice(0,100),durationMs,sampleRate,channels,bitRate};
  }catch(error){
    child?.kill("SIGKILL");
    if(error instanceof Error&&error.message.startsWith("PROVIDER_"))throw error;
    throw new Error(`PROVIDER_PERMANENT: 音声検査を開始できません${error&&typeof error==="object"&&"code" in error?` (${String(error.code)})`:""}`);
  }
}

export async function probeAudioStream(source:Readable):Promise<AudioMetadata>{
  const directory=await mkdtemp(join(tmpdir(),"hanamaru-audio-probe-"));
  const inputPath=join(directory,"input.media");
  try{
    await pipeline(source,createWriteStream(inputPath,{flags:"wx",mode:0o600}));
    return await probeAudioSource(inputPath);
  }catch(error){
    if(error instanceof Error&&error.message.startsWith("PROVIDER_"))throw error;
    throw new Error(`PROVIDER_PERMANENT: 音声検査を開始できません${error&&typeof error==="object"&&"code" in error?` (${String(error.code)})`:""}`);
  }finally{
    source.destroy();
    await rm(directory,{recursive:true,force:true});
  }
}

const allowedVideoCodecs=new Set(["h264","hevc","vp8","vp9","av1"]);
const allowedVideoFormats=new Set(["mov,mp4,m4a,3gp,3g2,mj2","matroska,webm"]);

export async function probeVideoSource(inputPathOrUrl:string):Promise<VideoMetadata>{
  let child:ReturnType<typeof spawn>|undefined;
  try{
    child=spawn("ffprobe",["-v","error","-print_format","json","-show_format","-show_streams",inputPathOrUrl],{stdio:["ignore","pipe","pipe"]});
    if(!child.stdout||!child.stderr)throw new Error("PROVIDER_PERMANENT: 動画検査processを開始できません");
    const stdout:Buffer[]=[];let stdoutBytes=0;
    child.stdout.on("data",chunk=>{const body=Buffer.from(chunk);stdoutBytes+=body.byteLength;if(stdoutBytes<=1_000_000)stdout.push(body);else child?.kill("SIGKILL");});
    child.stderr.resume();
    const code=await new Promise<number>((resolve,reject)=>{child!.once("error",reject);child!.once("close",value=>resolve(value??-1));});
    if(code!==0||stdoutBytes>1_000_000)throw new Error("PROVIDER_PERMANENT: 動画ファイルを解析できません");
    let parsed:{streams?:Array<Record<string,unknown>>;format?:Record<string,unknown>};try{parsed=JSON.parse(Buffer.concat(stdout).toString("utf8")) as typeof parsed;}catch{throw new Error("PROVIDER_PERMANENT: 動画検査結果を解析できません");}
    const video=(parsed.streams??[]).find(stream=>stream.codec_type==="video");if(!video)throw new Error("PROVIDER_PERMANENT: 動画streamがありません");
    const videoCodec=String(video.codec_name??"");if(!allowedVideoCodecs.has(videoCodec))throw new Error("PROVIDER_PERMANENT: 対応していない動画codecです");
    const format=String(parsed.format?.format_name??"");if(!allowedVideoFormats.has(format))throw new Error("PROVIDER_PERMANENT: MP4またはWebM動画を選択してください");
    const durationMs=Math.round(Number(video.duration??parsed.format?.duration??0)*1000);if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>4*60*60*1000)throw new Error("PROVIDER_PERMANENT: 動画の長さは4時間以内にしてください");
    const width=Number(video.width??0),height=Number(video.height??0);if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>7680||height>4320)throw new Error("PROVIDER_PERMANENT: 動画の解像度を確認してください");
    const audio=(parsed.streams??[]).find(stream=>stream.codec_type==="audio");
    const rawRate=String(video.avg_frame_rate??video.r_frame_rate??"");const [numerator,denominator]=rawRate.split("/").map(Number);const frameRate=numerator&&denominator?numerator/denominator:null;
    const rawBitRate=Number(video.bit_rate??parsed.format?.bit_rate??0);const bitRate=Number.isFinite(rawBitRate)&&rawBitRate>0?Math.round(rawBitRate):null;
    return{videoCodec,audioCodec:audio?String(audio.codec_name??"")||null:null,format,durationMs,width,height,frameRate:Number.isFinite(frameRate)?frameRate:null,bitRate};
  }catch(error){
    child?.kill("SIGKILL");
    if(error instanceof Error&&error.message.startsWith("PROVIDER_"))throw error;
    throw new Error(`PROVIDER_PERMANENT: 動画検査を開始できません${error&&typeof error==="object"&&"code" in error?` (${String(error.code)})`:""}`);
  }
}

export async function probeVideoStream(source:Readable):Promise<VideoMetadata>{
  const directory=await mkdtemp(join(tmpdir(),"hanamaru-video-probe-"));const inputPath=join(directory,"input.media");
  try{await pipeline(source,createWriteStream(inputPath,{flags:"wx",mode:0o600}));return await probeVideoSource(inputPath);}
  catch(error){if(error instanceof Error&&error.message.startsWith("PROVIDER_"))throw error;throw new Error("PROVIDER_PERMANENT: 動画検査を開始できません");}
  finally{source.destroy();await rm(directory,{recursive:true,force:true});}
}
