"use client";

import {useEffect,useRef,useState} from "react";
import {apiClient} from "@/lib/api/client";
import {completeGoogleLoginRedirect,identityPlatformConfigured,loginWithGoogleCredential,loginWithGooglePopup,logout} from "@/lib/auth/google";

let googleIdentityScript:Promise<void>|null=null;
function loadGoogleIdentity(){
  if(window.google?.accounts?.id)return Promise.resolve();
  if(googleIdentityScript)return googleIdentityScript;
  googleIdentityScript=new Promise<void>((resolve,reject)=>{
    const existing=document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script=existing??document.createElement("script");
    const loaded=()=>window.google?.accounts?.id?resolve():reject(new Error("Googleログインを読み込めませんでした"));
    script.addEventListener("load",loaded,{once:true});
    script.addEventListener("error",()=>reject(new Error("Googleログインを読み込めませんでした")),{once:true});
    if(!existing){script.src="https://accounts.google.com/gsi/client";script.async=true;script.defer=true;document.head.appendChild(script);}
  });
  return googleIdentityScript;
}

export function GoogleSignInButton({onSuccess,onError}:{onSuccess:()=>void;onError:(message:string)=>void}){
  const [working,setWorking]=useState(false);
  const [gisReady,setGisReady]=useState(false);
  const [gisUnavailable,setGisUnavailable]=useState(false);
  const buttonHost=useRef<HTMLDivElement>(null);
  const resumed=useRef(false);
  const configured=identityPlatformConfigured();
  const clientId=process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  async function finishCredential(credential:string){
    if(working)return;
    setWorking(true);
    try{
      await loginWithGoogleCredential(credential);
      await apiClient.request("/me");
      onSuccess();
    }catch{
      await logout().catch(()=>undefined);
      onError("このGoogleアカウントではログインできません。管理者へ利用登録を依頼してください。");
    }finally{setWorking(false);}
  }

  useEffect(()=>{
    if(!configured||!clientId||!buttonHost.current)return;
    let active=true;
    void loadGoogleIdentity().then(()=>{
      if(!active||!buttonHost.current||!window.google?.accounts?.id)return;
      window.google.accounts.id.initialize({client_id:clientId,callback:response=>{if(response.credential)void finishCredential(response.credential);},auto_select:false,cancel_on_tap_outside:true,use_fedcm_for_button:true});
      window.google.accounts.id.renderButton(buttonHost.current,{type:"standard",theme:"outline",size:"large",text:"signin_with",shape:"rectangular",logo_alignment:"left",width:320});
      setGisReady(true);
    }).catch(()=>{if(active)setGisUnavailable(true);});
    return()=>{active=false;};
  },[clientId,configured]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    if(!configured||resumed.current)return;
    resumed.current=true;
    void (async()=>{
      try{
        if(!await completeGoogleLoginRedirect())return;
        setWorking(true);
        await apiClient.request("/me");
        onSuccess();
      }catch{
        await logout().catch(()=>undefined);
        onError("このGoogleアカウントではログインできません。管理者へ利用登録を依頼してください。");
      }finally{setWorking(false);}
    })();
  },[configured,onError,onSuccess]);

  async function login(){
    if(!configured||working)return;
    setWorking(true);
    try{
      await loginWithGooglePopup();
      await apiClient.request("/me");
      onSuccess();
    }catch{
      await logout().catch(()=>undefined);
      onError("このGoogleアカウントではログインできません。管理者へ利用登録を依頼してください。");
    }finally{setWorking(false);}
  }

  return configured
    ? <div aria-busy={working}>
        {clientId&&!gisUnavailable?<div ref={buttonHost} role="group" aria-label="Googleでログイン"/>:null}
        {!clientId||gisUnavailable?<button type="button" aria-label="Googleでログイン" aria-busy={working} disabled={working} onClick={()=>void login()}>{working?"Googleアカウントを確認しています…":"Googleでログイン"}</button>:null}
        {clientId&&!gisReady&&!gisUnavailable?<span aria-live="polite">Googleログインを準備しています…</span>:null}
      </div>
    : <p role="alert">Googleログインの設定が完了していません。</p>;
}
