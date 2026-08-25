"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import { BookOpen, BriefcaseBusiness, ChevronLeft, GraduationCap, Home, LogOut, Menu, MessageSquareText, ShieldCheck, UserRound, X } from "lucide-react";
import {useEffect,useRef,useState,type ReactNode} from "react";
import type { Role } from "@/lib/prototype/types";
import styles from "./AppShell.module.css";

const baseNavigation = [
  { href: "/", label: "買取支援AI", icon: Home },
  { href: "/visits", label: "訪問前チェック", icon: BriefcaseBusiness },
  { href: "/reviews", label: "振り返りチェックシート", icon: MessageSquareText },
  { href: "/knowledge/talks", label: "現場の知識", icon: BookOpen },
  { href: "/training/roleplay", label: "研修", icon: GraduationCap },
];

const secondaryNavigation:Record<string,ReadonlyArray<{href:string;label:string}>>={
  knowledge:[
    {href:"/knowledge/talks",label:"切り返しトーク集"},{href:"/knowledge/flows",label:"困ったときのフロー集"},
    {href:"/knowledge/reference",label:"用語集・金券買取価格表"},{href:"/knowledge/manuals",label:"接客マニュアル・法務・コンプライアンス"},
  ],
  training:[{href:"/training/roleplay",label:"AIロープレ"},{href:"/training/videos",label:"動画ライブラリ"}],
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/knowledge/talks") return pathname.startsWith("/knowledge");
  if (href === "/training/roleplay") return pathname.startsWith("/training");
  return pathname === href || pathname.startsWith(`${href}/`);
}

const roleLabels:Record<Role,string>={assessor:"査定員",manager:"管理者",educator:"教育担当",content_approver:"承認担当",system_admin:"システム管理者"};

function mobilePageTitle(pathname:string){
  if(pathname==="/")return"ホーム";
  if(pathname==="/visits")return"訪問";
  if(pathname.endsWith("/import"))return"PDF取込";
  if(pathname.endsWith("/preparation"))return"訪問前チェック";
  if(pathname.endsWith("/transcription"))return"録音・文字起こし";
  if(pathname.endsWith("/review/input"))return"振り返りを作成";
  if(pathname.endsWith("/review"))return"振り返り結果";
  if(pathname==="/reviews")return"振り返り";
  if(pathname.startsWith("/knowledge"))return"現場の知識";
  if(pathname.startsWith("/training"))return"研修";
  if(pathname.startsWith("/admin"))return"管理";
  return"買取支援";
}

function mobileParentHref(pathname:string,homeHref:string){
  if(/^\/visits\/[^/]+\//.test(pathname))return"/visits";
  if(pathname!=="/knowledge/talks"&&pathname.startsWith("/knowledge/"))return"/knowledge/talks";
  if(pathname!=="/training/roleplay"&&pathname.startsWith("/training/"))return"/training/roleplay";
  if(pathname.startsWith("/admin/")&&pathname!==homeHref)return homeHref;
  return null;
}

function MobileMoreMenu({open,onClose,onLogout,showBusiness,showAdmin,adminHref,displayName,role}:{open:boolean;onClose:()=>void;onLogout:()=>void;showBusiness:boolean;showAdmin:boolean;adminHref:string;displayName?:string;role:Role}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;if(open&&dialog&&!dialog.open){if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");}if(!open&&dialog?.open){if(typeof dialog.close==="function")dialog.close();else dialog.removeAttribute("open");}},[open]);
  return <dialog className={styles.moreDialog} ref={ref} aria-labelledby="mobile-more-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section>
      <header><div><span>メニュー</span><h2 id="mobile-more-title">その他</h2></div><button type="button" aria-label="メニューを閉じる" onClick={onClose}><X size={22}/></button></header>
      <nav aria-label="その他の機能">
        {showBusiness?<><Link href="/training/roleplay" onClick={onClose}><GraduationCap size={20}/><span><strong>研修</strong><small>AIロープレ・動画ライブラリ</small></span></Link><Link href="/knowledge/manuals" onClick={onClose}><BookOpen size={20}/><span><strong>マニュアル・法務</strong><small>接客手順とコンプライアンス</small></span></Link></>:null}
        {showAdmin?<Link href={adminHref} onClick={onClose}><ShieldCheck size={20}/><span><strong>管理</strong><small>権限に応じた管理機能</small></span></Link>:null}
      </nav>
      <footer><div><UserRound size={20}/><span><strong>{displayName??roleLabels[role]}</strong><small>{roleLabels[role]}</small></span></div><button type="button" onClick={onLogout}><LogOut size={19}/>ログアウト</button></footer>
    </section>
  </dialog>;
}

export function AppShell({ children, pathname, role,roles,displayName,organizationName,branchName }: { children: ReactNode; pathname: string; role: Role;roles:Role[];displayName?:string;organizationName?:string;branchName?:string }) {
  const router=useRouter();
  const [moreOpen,setMoreOpen]=useState(false);
  const systemAdminAccount=roles.includes("system_admin");
  const showAdmin = roles.some(value=>value === "manager" || value === "system_admin" || value === "content_approver");
  const adminHref = systemAdminAccount ? "/admin/operations" : roles.includes("manager") ? "/admin/contents" : roles.includes("content_approver") ? "/admin/approvals" : "/admin/operations";
  const homeHref=systemAdminAccount?adminHref:"/";
  const navigation = systemAdminAccount||roles.every(value=>value==="content_approver")?[]:baseNavigation;
  const mobileParent=mobileParentHref(pathname,homeHref);
  const mobileNavigation=systemAdminAccount||roles.every(value=>value==="content_approver")
    ?[{href:adminHref,label:systemAdminAccount?"運用":"承認",icon:ShieldCheck}]
    :[
      {href:"/",label:"ホーム",icon:Home},
      {href:"/visits",label:"訪問",icon:BriefcaseBusiness},
      {href:"/reviews",label:"振り返り",icon:MessageSquareText},
      {href:"/knowledge/talks",label:"知識",icon:BookOpen},
    ];
  async function leave(){try{const {logout}=await import("@/lib/auth/google");await logout();}catch{/* 移動後に再認証を要求する */}router.replace("/login");router.refresh();}
  return (
    <div className={styles.frame}>
      <a className={styles.skip} href="#main-content">本文へ移動</a>
      <aside className={styles.sidebar} aria-label="メインナビゲーション">
        <Link className={styles.brand} href={homeHref} aria-label="買取支援ツール ホーム">
          <span className={styles.brandMark} aria-hidden="true">華</span>
          <span><strong>買取支援</strong><small>HANAMARU</small></span>
        </Link>
        <nav className={styles.nav}>
          {navigation.map(({ href, label, icon: Icon }) => {
            const section=href.startsWith("/knowledge")?"knowledge":href.startsWith("/training")?"training":"";
            const children=section?secondaryNavigation[section]:undefined;
            return <div className={styles.navGroup} key={href}><Link className={styles.navLink} data-active={isActive(pathname, href)} href={href} aria-current={isActive(pathname, href)&&!children ? "page" : undefined}>
              <Icon aria-hidden="true" size={20} strokeWidth={1.8} /><span>{label}</span>
            </Link>{children?<nav className={styles.secondaryNav} aria-label={`${label}の機能`}>{children.map(item=><Link href={item.href} key={item.href} aria-current={pathname===item.href?"page":undefined} data-active={pathname===item.href}>{item.label}</Link>)}</nav>:null}</div>;
          })}
          {showAdmin ? <Link className={styles.navLink} data-active={pathname.startsWith("/admin")} href={adminHref}><ShieldCheck aria-hidden="true" size={20} strokeWidth={1.8} /><span>管理</span></Link> : null}
        </nav>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.mobileContext}>{mobileParent?<button type="button" aria-label="前の画面へ戻る" onClick={()=>{if(window.history.length>1)router.back();else router.push(mobileParent);}}><ChevronLeft size={22}/></button>:null}<strong>{mobilePageTitle(pathname)}</strong></div>
          <div className={styles.desktopContext}><span className={styles.org}>{organizationName||"買取支援ツール"}</span>{branchName?<small>{branchName}</small>:null}</div>
          <div className={styles.actions}>
            <button className={styles.profile} onClick={leave} title="ログアウト"><span><strong>{displayName??roleLabels[role]}</strong></span><UserRound size={20} aria-hidden="true" /></button>
          </div>
        </header>
        <main className={styles.main} id="main-content" tabIndex={-1}>{children}</main>
      </div>
      <nav className={styles.bottomNav} data-count={mobileNavigation.length+1} aria-label="モバイルナビゲーション">
        {mobileNavigation.map(({ href, label, icon: Icon }) => <Link data-active={isActive(pathname, href)} href={href} key={href}><Icon size={21} aria-hidden="true" /><span>{label}</span></Link>)}
        <button type="button" aria-expanded={moreOpen} aria-haspopup="dialog" onClick={()=>setMoreOpen(true)}><Menu size={21} aria-hidden="true"/><span>その他</span></button>
      </nav>
      <MobileMoreMenu open={moreOpen} onClose={()=>setMoreOpen(false)} onLogout={leave} showBusiness={navigation.length>0} showAdmin={showAdmin} adminHref={adminHref} displayName={displayName} role={role}/>
    </div>
  );
}
