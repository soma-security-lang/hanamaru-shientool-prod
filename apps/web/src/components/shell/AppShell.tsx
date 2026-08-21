"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import { Bell, BookOpen, BriefcaseBusiness, GraduationCap, Home, MessageSquareText, ShieldCheck, UserRound } from "lucide-react";
import type { ReactNode } from "react";
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
export function AppShell({ children, pathname, role,roles,displayName,organizationName,branchName }: { children: ReactNode; pathname: string; role: Role;roles:Role[];displayName?:string;organizationName?:string;branchName?:string }) {
  const router=useRouter();
  const systemAdminAccount=roles.includes("system_admin");
  const showAdmin = roles.some(value=>value === "manager" || value === "system_admin" || value === "content_approver");
  const adminHref = systemAdminAccount ? "/admin/operations" : roles.includes("manager") ? "/admin/contents" : roles.includes("content_approver") ? "/admin/approvals" : "/admin/operations";
  const homeHref=systemAdminAccount?adminHref:"/";
  const navigation = systemAdminAccount||roles.every(value=>value==="content_approver")?[]:baseNavigation;
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
          <div><span className={styles.org}>{organizationName||"買取支援ツール"}</span>{branchName?<small>{branchName}</small>:null}</div>
          <div className={styles.actions}>
            <Link className={styles.iconButton} href={homeHref} aria-label="通知"><Bell size={19} aria-hidden="true" /></Link>
            <button className={styles.profile} onClick={leave} title="ログアウト"><span><strong>{displayName??roleLabels[role]}</strong></span><UserRound size={20} aria-hidden="true" /></button>
          </div>
        </header>
        <main className={styles.main} id="main-content" tabIndex={-1}>{children}</main>
      </div>
      <nav className={styles.bottomNav} aria-label="モバイルナビゲーション">
        {navigation.map(({ href, label, icon: Icon }) => <Link data-active={isActive(pathname, href)} href={href} key={href}><Icon size={20} aria-hidden="true" /><span>{label}</span></Link>)}
        {showAdmin ? <Link data-active={pathname.startsWith("/admin")} href={adminHref}><ShieldCheck size={20} aria-hidden="true" /><span>管理</span></Link> : null}
      </nav>
    </div>
  );
}
