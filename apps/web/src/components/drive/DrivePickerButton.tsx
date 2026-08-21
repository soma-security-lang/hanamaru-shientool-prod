"use client";

import Script from "next/script";
import {HardDriveUpload} from "lucide-react";
import {useState} from "react";
import {getDriveAccessToken,identityPlatformConfigured} from "@/lib/auth/google";
import {resources} from "@/lib/api/resources";
import {IncrementalSha256} from "@/lib/files/sha256";

const audioMimeTypes="audio/mp4,audio/mpeg,audio/wav,audio/x-wav,audio/aac,audio/webm,video/mp4";
const maximumRecordingBytes=1_000_000_000;

function loadPicker(){return new Promise<void>((resolve,reject)=>{if(!window.gapi){reject(new Error("Google Pickerを読み込めませんでした"));return;}window.gapi.load("picker",{callback:resolve,onerror:()=>reject(new Error("Google Pickerを読み込めませんでした")),timeout:10_000,ontimeout:()=>reject(new Error("Google Pickerの読込がタイムアウトしました"))});});}

function pickFile(accessToken:string,apiKey:string,appId:string){
  return new Promise<string>((resolve,reject)=>{
    const picker=window.google?.picker;if(!picker){reject(new Error("Google Pickerを開始できませんでした"));return;}
    const view=new picker.DocsView(picker.ViewId.DOCS);view.setMimeTypes(audioMimeTypes);view.setSelectFolderEnabled(false);
    const builder=new picker.PickerBuilder();builder.addView(view);builder.setOAuthToken(accessToken);builder.setDeveloperKey(apiKey);builder.setAppId(appId);builder.setCallback(data=>{
      const action=data[picker.Response.ACTION];
      if(action===picker.Action.CANCEL){reject(new Error("ファイル選択をキャンセルしました"));return;}
      if(action!==picker.Action.PICKED)return;
      const documents=data[picker.Response.DOCUMENTS];const first=Array.isArray(documents)?documents[0] as Record<string,unknown>|undefined:undefined;const id=first?.[picker.Document.ID];
      if(typeof id==="string"&&id)resolve(id);else reject(new Error("選択したファイルを確認できませんでした"));
    });builder.build().setVisible(true);
  });
}

function safeFileName(value:unknown){const name=String(value??"").replaceAll("\\","/").split("/").at(-1)?.trim();return name||"drive-recording";}

interface DriveFileDescriptor{id:string;name:string;mimeType:string;sizeBytes:number;sha256:string}

function mediaUrl(fileId:string){const url=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);url.searchParams.set("alt","media");url.searchParams.set("supportsAllDrives","true");return url;}

async function openDriveMedia(accessToken:string,fileId:string){const response=await fetch(mediaUrl(fileId),{headers:{authorization:`Bearer ${accessToken}`},credentials:"omit",cache:"no-store"});if(!response.ok||!response.body)throw new Error("Google Driveから音声ファイルを取得できませんでした");return response.body;}

export async function inspectAndHashDriveFile(accessToken:string,fileId:string):Promise<DriveFileDescriptor>{
  const headers={authorization:`Bearer ${accessToken}`,accept:"application/json"};
  const metadataUrl=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);metadataUrl.searchParams.set("fields","id,name,mimeType,size");metadataUrl.searchParams.set("supportsAllDrives","true");
  const metadataResponse=await fetch(metadataUrl,{headers,credentials:"omit",cache:"no-store"});
  if(!metadataResponse.ok)throw new Error("選択したGoogle Driveファイルを確認できませんでした");
  const metadata=await metadataResponse.json() as {id?:string;name?:string;mimeType?:string;size?:string};
  const mimeType=String(metadata.mimeType??"");const sizeBytes=Number(metadata.size??0);
  if(metadata.id!==fileId||(!mimeType.startsWith("audio/")&&mimeType!=="video/mp4"))throw new Error("音声ファイルを選択してください");
  if(!Number.isSafeInteger(sizeBytes)||sizeBytes<=0||sizeBytes>maximumRecordingBytes)throw new Error("Google Driveの音声ファイルは1GB以下を選択してください");
  const reader=(await openDriveMedia(accessToken,fileId)).getReader();const hash=new IncrementalSha256();let received=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>sizeBytes)throw new Error("Google Driveファイルのサイズを確認できませんでした");hash.update(value);}}
  finally{reader.releaseLock();}
  if(received!==sizeBytes)throw new Error("Google Driveファイルのサイズを確認できませんでした");
  return{id:fileId,name:safeFileName(metadata.name),mimeType,sizeBytes,sha256:hash.digestHex()};
}

export async function openVerifiedDriveStream(accessToken:string,file:DriveFileDescriptor){return{mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256,body:await openDriveMedia(accessToken,file.id)};}

export function DrivePickerButton({visitId,ensureConsent,onStarted,className,disabled=false}:{visitId:string;ensureConsent:()=>Promise<string>;onStarted:(jobId:string,fileName:string)=>void;className?:string;disabled?:boolean}){
  const [apiReady,setApiReady]=useState(Boolean(typeof window!=="undefined"&&window.gapi));
  const [state,setState]=useState<"idle"|"working"|"error">("idle");const [message,setMessage]=useState("");
  const apiKey=process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;const appId=process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;
  const configured=identityPlatformConfigured()&&Boolean(apiKey&&appId);
  async function open(){if(!apiKey||!appId||!apiReady||!configured)return;setState("working");setMessage("");try{const accessToken=await getDriveAccessToken();await loadPicker();const fileId=await pickFile(accessToken,apiKey,appId);const file=await inspectAndHashDriveFile(accessToken,fileId);const consentId=await ensureConsent();const freshAccessToken=await getDriveAccessToken();const stream=await openVerifiedDriveStream(freshAccessToken,file);const job=await resources.uploadRecordingStream(visitId,stream,consentId,{capturedAt:new Date().toISOString(),durationMs:null});onStarted(job.jobId,file.name);setState("idle");}catch(error){setMessage(error instanceof Error?error.message:"Google Driveから取り込めませんでした");setState("error");}}
  return <>
    <Script src="https://apis.google.com/js/api.js" strategy="afterInteractive" onLoad={()=>setApiReady(true)} />
    <button className={className} type="button" disabled={disabled||!configured||!apiReady||state==="working"} onClick={()=>void open()}><HardDriveUpload size={18}/>{state==="working"?"Google Driveを開いています…":"Google Driveから選択"}</button>
    {!configured?<p role="alert">Google Drive選択の設定が完了していません。端末の音声ファイルは上から取り込めます。</p>:null}
    {state==="error"?<p role="alert">{message}</p>:null}
  </>;
}
