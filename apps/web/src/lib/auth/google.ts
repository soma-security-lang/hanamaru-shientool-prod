"use client";

import {getApp,getApps,initializeApp} from "firebase/app";
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  browserLocalPersistence,
  getRedirectResult,
  indexedDBLocalPersistence,
  initializeAuth,
  reauthenticateWithPopup,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type UserCredential,
} from "firebase/auth";
import {clearCommonAccessToken,getCommonAccessToken} from "./sso";
import {runtimeApiBaseUrl,runtimeLocalSession,runtimeSessionAvailable} from "@/lib/runtime-config";

export const driveScope="https://www.googleapis.com/auth/drive.file";
const accessTokenLifetimeMs=45*60_000;

let authInstance:Auth|null|undefined;
let googleAccessToken:{value:string;expiresAt:number}|null=null;
let driveVerifiedSsoToken:string|null=null;

function identityConfig(){
  const apiKey=process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY;
  const authDomain=process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN;
  const projectId=process.env.NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID;
  return apiKey&&authDomain&&projectId?{apiKey,authDomain,projectId}:null;
}

export function identityPlatformConfigured(){return Boolean(identityConfig());}

function identityAuth(){
  if(typeof window==="undefined")return null;
  if(authInstance!==undefined)return authInstance;
  const config=identityConfig();
  if(!config){authInstance=null;return null;}
  const app=getApps().length?getApp():initializeApp(config);
  authInstance=initializeAuth(app,{persistence:[indexedDBLocalPersistence,browserLocalPersistence],popupRedirectResolver:browserPopupRedirectResolver});
  return authInstance;
}

function loginProvider(){
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  return provider;
}

function driveProvider(){
  const provider=loginProvider();
  provider.addScope(driveScope);
  return provider;
}

function rememberGoogleAccessToken(result:UserCredential){
  const token=GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  googleAccessToken=token?{value:token,expiresAt:Date.now()+accessTokenLifetimeMs}:null;
}

async function readyAuth(){
  const auth=identityAuth();
  if(!auth)return null;
  await auth.authStateReady();
  return auth;
}

export async function beginGoogleLoginRedirect(){
  const auth=await readyAuth();
  if(!auth)throw new Error("Googleログインの設定が完了していません");
  await signInWithRedirect(auth,loginProvider());
}

export async function loginWithGooglePopup(){
  const auth=await readyAuth();
  if(!auth)throw new Error("Googleログインの設定が完了していません");
  const result=await signInWithPopup(auth,loginProvider());
  await establishLocalSession(await result.user.getIdToken(true));
}

export async function loginWithGoogleCredential(idToken:string){
  const auth=await readyAuth();
  if(!auth)throw new Error("Googleログインの設定が完了していません");
  const credential=GoogleAuthProvider.credential(idToken);
  const result=await signInWithCredential(auth,credential);
  await establishLocalSession(await result.user.getIdToken(true));
}

export async function completeGoogleLoginRedirect(){
  const auth=identityAuth();
  if(!auth)return false;
  const redirectResult=await getRedirectResult(auth);
  if(runtimeSessionAvailable()&&!runtimeLocalSession()&&!redirectResult)return false;
  await auth.authStateReady();
  if(!auth.currentUser)return false;
  await establishLocalSession(await auth.currentUser.getIdToken(true));
  return true;
}

export async function getIdentityToken(forceRefresh=false){
  if(process.env.NEXT_PUBLIC_OFFLINE_E2E_AUTH==="enabled")return "offline-e2e-development-token";
  const auth=await readyAuth();
  return auth?.currentUser?auth.currentUser.getIdToken(forceRefresh):null;
}

export async function getDriveAccessToken(){
  const commonToken=getCommonAccessToken();
  let serverSession:{authenticated?:boolean;csrfToken?:string}|undefined;
  if(runtimeSessionAvailable()&&!runtimeLocalSession()){
    const response=await fetch("/api/auth/session",{credentials:"same-origin",cache:"no-store"});
    if(!response.ok)throw new Error("現在の利用者を確認してからGoogle Driveへ接続してください");
    serverSession=await response.json();
  }
  const binding=serverSession?.authenticated?serverSession.csrfToken:commonToken;
  if(googleAccessToken&&googleAccessToken.expiresAt>Date.now()&&(!binding||driveVerifiedSsoToken===binding))return googleAccessToken.value;
  const auth=await readyAuth();
  if(!auth)throw new Error("Google Driveの認証設定がありません");
  const result=auth.currentUser
    ? await reauthenticateWithPopup(auth.currentUser,driveProvider())
    : await signInWithPopup(auth,driveProvider());
  rememberGoogleAccessToken(result);
  if(!googleAccessToken)throw new Error("Google Driveの認可を確認できませんでした");
  if(serverSession?.authenticated){
    const response=await fetch("/api/auth/google/verify",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{
      authorization:`Bearer ${await result.user.getIdToken(true)}`,"x-csrf-token":serverSession.csrfToken??""}});
    if(!response.ok){googleAccessToken=null;driveVerifiedSsoToken=null;throw new Error("共通IDとGoogle Driveの利用者が一致しません");}
    driveVerifiedSsoToken=serverSession.csrfToken??null;
  }
  if(commonToken){
    const googleIdToken=await result.user.getIdToken(true);
    const base=runtimeApiBaseUrl();
    const me=async(token:string)=>{
      const response=await fetch(`${base}/me`,{headers:{authorization:`Bearer ${token}`},credentials:"omit",cache:"no-store"});
      if(!response.ok)throw new Error("Googleアカウントの利用者確認に失敗しました");
      return response.json() as Promise<{id?:unknown}>;
    };
    try{
      const [common,google]=await Promise.all([me(commonToken),me(googleIdToken)]);
      if(typeof common.id!=="string"||common.id!==google.id)throw new Error("共通IDとGoogle Driveの利用者が一致しません");
      driveVerifiedSsoToken=commonToken;
    }catch(error){googleAccessToken=null;driveVerifiedSsoToken=null;await signOut(auth);throw error;}
  }
  return googleAccessToken.value;
}

export async function logout(){
  if(runtimeSessionAvailable()&&!runtimeLocalSession()){
    const response=await fetch("/api/auth/session",{method:"DELETE",credentials:"same-origin",headers:{"x-session-intent":"logout"}});
    if(!response.ok)throw new Error("ログアウトを完了できませんでした");
  }else if(runtimeLocalSession()) {
    const initial=await fetch("/api/auth/session",{credentials:"same-origin",cache:"no-store"});
    if(!initial.ok)throw new Error("ログアウト状態を確認できませんでした");
    const session=await initial.json() as {csrfToken:string};
    const response=await fetch("/api/auth/session",{method:"DELETE",credentials:"same-origin",headers:{"x-csrf-token":session.csrfToken}});
    if(!response.ok)throw new Error("ログアウトを完了できませんでした");
  }
  googleAccessToken=null;
  driveVerifiedSsoToken=null;
  const auth=await readyAuth();
  if(auth)await signOut(auth);
  clearCommonAccessToken();
}

async function establishLocalSession(token:string) {
  clearCommonAccessToken();
  if(runtimeSessionAvailable()&&!runtimeLocalSession()){
    // Google remains an explicit legacy login, not an automatic SSO fallback.
    const initial=await fetch("/api/auth/session/start",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"x-session-intent":"login"}});
    if(!initial.ok)throw new Error("ログイン状態を準備できませんでした");
    const session=await initial.json() as {csrfToken:string};
    const cleared=await fetch("/api/auth/session",{method:"DELETE",credentials:"same-origin",headers:{"x-csrf-token":session.csrfToken}});
    if(!cleared.ok)throw new Error("ログイン経路を切り替えられませんでした");
    return;
  }
  if(!runtimeLocalSession())return;
  const initial=await fetch("/api/auth/session",{credentials:"same-origin",cache:"no-store"});
  if(!initial.ok)throw new Error("ログイン状態を準備できませんでした");
  const session=await initial.json() as {csrfToken:string};
  const response=await fetch("/api/auth/session",{method:"POST",credentials:"same-origin",headers:{"x-csrf-token":session.csrfToken,authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error("ログインを完了できませんでした");
}

declare global{
  interface Window{
    google?:{
      accounts?:{id:{
        initialize(config:{client_id:string;callback:(response:{credential?:string})=>void;auto_select:false;cancel_on_tap_outside:true;use_fedcm_for_button:true}):void;
        renderButton(parent:HTMLElement,config:{type:"standard";theme:"outline";size:"large";text:"signin_with";shape:"rectangular";logo_alignment:"left";width:number}):void;
      }};
      picker?:{
        PickerBuilder:new()=>{addView(view:unknown):unknown;setOAuthToken(token:string):unknown;setDeveloperKey(key:string):unknown;setAppId(id:string):unknown;setCallback(callback:(data:Record<string,unknown>)=>void):unknown;build():{setVisible(visible:boolean):void}};
        DocsView:new(viewId:unknown)=>{setMimeTypes(value:string):unknown;setSelectFolderEnabled(value:boolean):unknown};
        ViewId:{DOCS:unknown};Response:{ACTION:string;DOCUMENTS:string};Action:{PICKED:string;CANCEL:string};Document:{ID:string};
      };
    };
    gapi?:{load(name:string,options:{callback:()=>void;onerror:()=>void;timeout:number;ontimeout:()=>void}):void};
  }
}
