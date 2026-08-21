"use client";

import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {useEffect,useMemo,useState} from "react";
import {LoaderCircle,LockKeyhole} from "lucide-react";
import {AppShell} from "@/components/shell/AppShell";
import {WebExperience} from "@/features/web/Experience";
import {allScreens,findScreen} from "@/lib/prototype/registry";
import type {Role,ScreenSpec} from "@/lib/prototype/types";
import {ApiClientError,apiClient} from "@/lib/api/client";
import styles from "./ScreenHost.module.css";

interface Viewer{
  id:string;
  displayName:string;
  organizationName?:string;
  branchName?:string;
  roles:Role[];
  capabilities:string[];
  featureFlags:Record<string,boolean>;
}

const rolePriority:Role[]=["system_admin","content_approver","manager","educator","assessor"];
const prototypeEnabled=process.env.NODE_ENV!=="production"&&process.env.NEXT_PUBLIC_PROTOTYPE_MODE==="enabled";

function primaryRole(viewer:Viewer){return rolePriority.find(role=>viewer.roles.includes(role))??"assessor";}

export function ScreenHost(){
  const pathname=usePathname();
  const router=useRouter();
  const [viewer,setViewer]=useState<Viewer|null>(null);
  const [authState,setAuthState]=useState<"loading"|"ready"|"required"|"failed">(pathname==="/login"?"ready":"loading");
  const screen=useMemo(()=>findScreen(pathname),[pathname]);

  useEffect(()=>{const expired=()=>{setViewer(null);setAuthState("required");};window.addEventListener("hanamaru:auth-required",expired);return()=>window.removeEventListener("hanamaru:auth-required",expired);},[]);

  useEffect(()=>{
    if(pathname==="/login"||pathname==="/__prototype")return;
    if(viewer)return;
    let active=true;
    void apiClient.request<Viewer>("/me").then(result=>{if(active){setViewer(result);setAuthState("ready");}}).catch(error=>{
      if(!active)return;
      setViewer(null);
      setAuthState(error instanceof ApiClientError&&error.status===401?"required":"failed");
    });
    return()=>{active=false;};
  },[pathname,viewer]);

  if(pathname==="/__prototype")return prototypeEnabled?<PrototypeIndex/>:<NotFound/>;
  if(!screen)return <NotFound/>;
  if(screen.kind==="auth")return <main className={styles.authPage}><WebExperience kind="auth"/></main>;
  if(authState==="loading"||(!viewer&&authState==="ready"))return <main className={styles.authPage}><AccessState loading title="利用者情報を確認しています" body="少しお待ちください。"/></main>;
  if(authState==="required")return <main className={styles.authPage}><AccessState title="ログインが必要です" body="業務用Googleアカウントでログインしてください。" action={<Link className={styles.primaryButton} href="/login">ログインへ進む</Link>}/></main>;
  if(authState==="failed")return <main className={styles.authPage}><AccessState title="利用者情報を確認できません" body="APIの接続状態を確認して、もう一度お試しください。" action={<button className={styles.secondaryButton} onClick={()=>router.refresh()}>再読み込み</button>}/></main>;
  if(!viewer)return null;

  const systemAdminAccount=viewer.roles.includes("system_admin");
  const systemAdminScreen=screen.kind==="usersAdmin"||screen.kind==="operations";
  const permitted=viewer.roles.some(role=>screen.roles.includes(role))&&(!systemAdminAccount||systemAdminScreen);
  const featureEnabled=!screen.featureFlag||Boolean(viewer.featureFlags[screen.featureFlag]);
  return <AppShell pathname={pathname} role={primaryRole(viewer)} roles={viewer.roles} displayName={viewer.displayName} organizationName={viewer.organizationName} branchName={viewer.branchName}>
    {!permitted
      ? <AccessState title="この画面を利用する権限がありません" body="必要な場合は所属管理者へ権限を依頼してください。" action={<Link className={styles.secondaryButton} href="/">ホームへ戻る</Link>}/>
      : !featureEnabled
        ? <FeatureDisabled screen={screen}/>
        : <WebExperience kind={screen.kind} viewerId={viewer.id} capabilities={viewer.capabilities} featureFlags={viewer.featureFlags}/>
    }
  </AppShell>;
}

function FeatureDisabled({screen}:{screen:ScreenSpec}){return <AccessState title={`${screen.name}は現在利用できません`} body="利用開始までお待ちください。" action={<Link className={styles.secondaryButton} href="/">ホームへ戻る</Link>}/>;}

function AccessState({loading=false,title,body,action}:{loading?:boolean;title:string;body:string;action?:React.ReactNode}){return <section className={styles.statePanel} aria-live={loading?"polite":undefined}>{loading?<LoaderCircle className={styles.spin} size={32} aria-hidden="true"/>:<LockKeyhole size={32} aria-hidden="true"/>}<h1>{title}</h1><p>{body}</p>{action}</section>;}

function PrototypeIndex(){return <main className={styles.prototypePage}><header><h1>画面・状態検証</h1><p>開発時だけ利用できる隔離された検証ページです。通常画面の認証・権限・データは変更しません。</p></header><section className={styles.prototypeGrid}>{allScreens.map(screen=><article id={screen.id} key={screen.id}><span>{screen.id}</span><h2>{screen.name}</h2><p>{screen.summary}</p>{screen.routes.every(route=>!route.includes(":"))?<Link href={screen.routes[0]}>通常画面を開く</Link>:<small>対象案件は訪問一覧から選択</small>}</article>)}</section></main>;}

function NotFound(){return <main className={styles.notFound}><h1>画面が見つかりません</h1><Link className={styles.primaryButton} href="/">ホームへ戻る</Link></main>;}
