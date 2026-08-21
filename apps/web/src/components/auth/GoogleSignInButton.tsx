"use client";

import {useState} from "react";
import {apiClient} from "@/lib/api/client";
import {identityPlatformConfigured,loginWithGooglePopup,logout} from "@/lib/auth/google";

export function GoogleSignInButton({onSuccess,onError}:{onSuccess:()=>void;onError:(message:string)=>void}){
  const [working,setWorking]=useState(false);
  const configured=identityPlatformConfigured();

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
    ? <button type="button" aria-label="Googleでログイン" aria-busy={working} disabled={working} onClick={()=>void login()}>{working?"Googleアカウントを確認しています…":"Googleでログイン"}</button>
    : <p role="alert">Googleログインの設定が完了していません。</p>;
}
