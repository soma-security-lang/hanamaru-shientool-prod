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

export const driveScope="https://www.googleapis.com/auth/drive.file";
const accessTokenLifetimeMs=45*60_000;

let authInstance:Auth|null|undefined;
let googleAccessToken:{value:string;expiresAt:number}|null=null;

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
  await result.user.getIdToken(true);
}

export async function loginWithGoogleCredential(idToken:string){
  const auth=await readyAuth();
  if(!auth)throw new Error("Googleログインの設定が完了していません");
  const credential=GoogleAuthProvider.credential(idToken);
  const result=await signInWithCredential(auth,credential);
  await result.user.getIdToken(true);
}

export async function completeGoogleLoginRedirect(){
  const auth=identityAuth();
  if(!auth)return false;
  await getRedirectResult(auth);
  await auth.authStateReady();
  if(!auth.currentUser)return false;
  await auth.currentUser.getIdToken(true);
  return true;
}

export async function getIdentityToken(forceRefresh=false){
  if(process.env.NEXT_PUBLIC_OFFLINE_E2E_AUTH==="enabled")return "offline-e2e-development-token";
  const auth=await readyAuth();
  return auth?.currentUser?auth.currentUser.getIdToken(forceRefresh):null;
}

export async function getDriveAccessToken(){
  if(googleAccessToken&&googleAccessToken.expiresAt>Date.now())return googleAccessToken.value;
  const auth=await readyAuth();
  if(!auth?.currentUser)throw new Error("Googleへログインしてください");
  const result=await reauthenticateWithPopup(auth.currentUser,driveProvider());
  rememberGoogleAccessToken(result);
  if(!googleAccessToken)throw new Error("Google Driveの認可を確認できませんでした");
  return googleAccessToken.value;
}

export async function logout(){
  googleAccessToken=null;
  const auth=await readyAuth();
  if(auth)await signOut(auth);
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
