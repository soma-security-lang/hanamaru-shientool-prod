"use client";

import Link from "next/link";
import {useCallback,useEffect,useState,type FormEvent} from "react";
import type {ExpenseDayDetailDto,ExpenseDayDto,ExpenseFollowupDto,ExpenseItemDto} from "@hanamaru/contracts";
import {resources} from "@/lib/api/resources";
import styles from "./ExpenseExperience.module.css";

const today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
const yen=(value:number|string|null)=>value===null?"未入力":`${Number(value).toLocaleString("ja-JP")}円`;
const names:Record<ExpenseFollowupDto["kind"],string>={funding_request:"追加資金の依頼",unreplenished:"未補充",vault_discrepancy:"原因調査中の差異",report:"報告の自己記録",correction_proposal:"後日訂正案"};
const nextOwners:Record<ExpenseFollowupDto["kind"],string>={funding_request:"現金取扱者（指定方法は要確認）",unreplenished:"現金取扱者（指定方法は要確認）",vault_discrepancy:"管理者・現金取扱者（調査手順は要確認）",report:"報告者本人（外部送信は別確認）",correction_proposal:"管理者（適用・再承認は無効）"};

export function ExpenseExperience({viewerId,capabilities}:{viewerId?:string;capabilities:string[]}){
  const [days,setDays]=useState<ExpenseDayDto[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [detail,setDetail]=useState<ExpenseDayDetailDto|null>(null);
  const [businessDate,setBusinessDate]=useState(today);
  const [merchant,setMerchant]=useState("");const [category,setCategory]=useState("駐車場");const [amount,setAmount]=useState("");
  const [source,setSource]=useState<"company_wallet"|"personal">("company_wallet");
  const [followKind,setFollowKind]=useState<"funding_request"|"unreplenished"|"vault_discrepancy"|"report"|"correction_proposal">("funding_request");
  const [followAmount,setFollowAmount]=useState("");const [reason,setReason]=useState("");
  const [targetItem,setTargetItem]=useState("");const [proposedAmount,setProposedAmount]=useState("");
  const [opening,setOpening]=useState("");const [purchase,setPurchase]=useState("");
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const refresh=useCallback(async(id:string|null)=>{
    const list=await resources.expenseDays();
    const queryId=new URL(window.location.href).searchParams.get("dayId");
    const requested=id??queryId;
    const target=list.items.find(item=>item.id===requested)?.id??list.items[0]?.id??null;
    const url=new URL(window.location.href);
    if(target)url.searchParams.set("dayId",target);else url.searchParams.delete("dayId");
    if(url.href!==window.location.href)window.history.replaceState(window.history.state,"",url.href);
    setSelected(target);
    const next=target?await resources.expenseDay(target):null;
    setDays(list.items);setDetail(next);
    setOpening(next?.day.openingWalletCash===null||next?.day.openingWalletCash===undefined?"":String(next.day.openingWalletCash));
    setPurchase(next?.day.purchaseTotal===null||next?.day.purchaseTotal===undefined?"":String(next.day.purchaseTotal));
  },[]);
  useEffect(()=>{void Promise.resolve().then(()=>refresh(null)).catch(e=>setError(e instanceof Error?e.message:"日次記録を読み込めませんでした"));},[refresh]);
  async function run(task:()=>Promise<string|null>){setBusy(true);setError("");try{await refresh(await task());return true;}catch(e){setError(e instanceof Error?e.message:"処理を完了できませんでした");return false;}finally{setBusy(false);}}
  const day=detail?.day;
  const canCreate=capabilities.includes("visit:self");
  const canEdit=Boolean(day&&viewerId===day.ownerMembershipId&&canCreate);
  function onCreate(e:FormEvent){e.preventDefault();void run(async()=>{const result=await resources.createExpenseDay(businessDate);return result.id;});}
  function onAdd(e:FormEvent){e.preventDefault();if(!day)return;void run(async()=>{await resources.addExpenseItem(day.id,{merchant,category,amount:Number(amount),paymentSource:source});setMerchant("");setAmount("");return day.id;});}
  function onFollowup(e:FormEvent){e.preventDefault();if(!day)return;void run(async()=>{await resources.addExpenseFollowup(day.id,{kind:followKind,reason,...(["funding_request","unreplenished","vault_discrepancy"].includes(followKind)?{amount:Number(followAmount)}:{}),...(followKind==="correction_proposal"?{targetItemId:targetItem,proposedAmount:Number(proposedAmount)}:{})});setReason("");setFollowAmount("");setProposedAmount("");return day.id;});}
  return <div className={styles.page}>
    <header><p className={styles.eyebrow}>日次記録</p><h1>経費・車両金精算</h1><p>支出を記録し、確定した明細だけを日次へ集計します。補充・金庫照合・締めは業務条件の確認待ちです。</p><Link href="/">買取支援ホームへ戻る</Link></header>
    {error?<p className={styles.error} role="alert">{error}　<button type="button" onClick={()=>void refresh(selected).catch(e=>setError(String(e)))}>再読込</button></p>:null}
    <nav className={styles.steps} aria-label="業務の進め方"><span>1 日次を開く</span><span>2 支出を記録</span><span>3 内容を確認</span><span>4 未完了事項を残す</span></nav>
    <section className={styles.card}><h2>業務日を選ぶ</h2>{canCreate?<form onSubmit={onCreate} className={styles.row}><label>業務日<input type="date" value={businessDate} onChange={e=>setBusinessDate(e.target.value)} required/></label><button type="submit" disabled={busy}>日次記録を開く</button></form>:<p>閲覧権限のある日次記録を確認できます。本人の記録作成・更新はできません。</p>}{days.length?<label>保存済みの日次<select value={selected??""} onChange={e=>void run(async()=>e.target.value)}>{days.map(item=><option value={item.id} key={item.id}>{item.businessDate} · {item.id.slice(0,8)}</option>)}</select></label>:<p>保存済みの日次はありません。</p>}</section>
    {day?<>
      <section className={styles.card}><h2>{day.businessDate} の取りまとめ</h2><p>記録者：{canEdit?"ログイン中の本人":"別の査定員（閲覧のみ）"} ／ 状態：下書き</p><div className={styles.metrics}><div><small>確定・会社の財布</small><strong>{yen(detail.totals.companyWallet)}</strong></div><div><small>確定・個人立替</small><strong>{yen(detail.totals.personal)}</strong></div><div><small>確認待ち候補</small><strong>{detail.totals.candidateCount}件</strong></div></div><p>財布残高・金庫残高：<strong>未算定</strong>。支店ごとの計算契約は確認待ちです。</p>{canEdit?<><form className={styles.row} onSubmit={e=>{e.preventDefault();void run(async()=>{await resources.updateExpenseDay(day.id,{expectedLockVersion:day.lockVersion,openingWalletCash:opening===""?null:Number(opening),purchaseTotal:purchase===""?null:Number(purchase)});return day.id;});}}><label>実際の開始財布残高（任意）<input inputMode="numeric" type="number" min="0" value={opening} onChange={e=>setOpening(e.target.value)} placeholder={day.openingWalletCash===null?"未入力":String(day.openingWalletCash)}/></label><label>買取金の入力値（任意）<input inputMode="numeric" type="number" min="0" value={purchase} onChange={e=>setPurchase(e.target.value)} placeholder={day.purchaseTotal===null?"未入力":String(day.purchaseTotal)}/></label><button type="submit" disabled={busy}>入力値を保存</button></form><p className={styles.note}>空欄で保存すると未入力に戻ります。0円とは区別します。</p></>:<p>開始財布残高：{yen(day.openingWalletCash)} ／ 買取金の入力値：{yen(day.purchaseTotal)}</p>}</section>
      <section className={styles.card}><h2>支出を記録する</h2><p className={styles.note}>領収書画像の取込と実OCRは未接続です。候補は確認まで合計へ入りません。確認済みも証憑未添付であり、支店照合・締めは完了していません。</p>{canEdit?<form onSubmit={onAdd} className={styles.row}><label>支払先<input value={merchant} onChange={e=>setMerchant(e.target.value)} maxLength={200} required/></label><label>費目<select value={category} onChange={e=>setCategory(e.target.value)}><option>駐車場</option><option>燃料</option><option>高速道路</option><option>車両整備</option><option>その他・確認待ち</option></select></label><label>支払額（円）<input type="number" inputMode="numeric" min="1" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><label>支払元<select value={source} onChange={e=>setSource(e.target.value as typeof source)}><option value="company_wallet">会社の財布</option><option value="personal">個人立替</option></select></label><button type="submit" disabled={busy}>候補として保存</button></form>:null}
      <h3>明細</h3>{detail.items.length?detail.items.map(item=><ExpenseItemRow key={item.id} item={item} editable={canEdit} busy={busy} onConfirm={()=>void run(async()=>{await resources.confirmExpenseItem(day.id,item.id,item.lockVersion);return day.id;})} onUpdate={body=>run(async()=>{await resources.updateExpenseCandidate(day.id,item.id,{expectedLockVersion:item.lockVersion,...body});return day.id;})} onExclude={reason=>run(async()=>{await resources.excludeExpenseCandidate(day.id,item.id,item.lockVersion,reason);return day.id;})}/>):<p>支出明細はありません。</p>}</section>
      <section className={styles.card}><h2>未完了事項と次の担当</h2><p>追加金の依頼は入金実績ではありません。未補充は原因不明の差異と分けて記録します。報告の自己記録は外部送信の証明ではありません。</p>{canEdit?<form className={styles.row} onSubmit={onFollowup}><label>記録の種類<select value={followKind} onChange={e=>setFollowKind(e.target.value as typeof followKind)}><option value="funding_request">追加資金の依頼</option><option value="unreplenished">未補充</option><option value="vault_discrepancy">原因調査中の差異</option><option value="report">報告の自己記録</option><option value="correction_proposal">後日訂正案</option></select></label>{["funding_request","unreplenished","vault_discrepancy"].includes(followKind)?<label>金額（円）<input type="number" inputMode="numeric" min="0" value={followAmount} onChange={e=>setFollowAmount(e.target.value)} required/></label>:null}{followKind==="correction_proposal"?<><label>訂正対象<select value={targetItem} onChange={e=>setTargetItem(e.target.value)} required><option value="">明細を選択</option>{detail.items.filter(item=>item.status==="confirmed").map(item=><option value={item.id} key={item.id}>{item.merchant} · {yen(item.amount)}</option>)}</select></label><label>提案する金額（円）<input type="number" inputMode="numeric" min="1" value={proposedAmount} onChange={e=>setProposedAmount(e.target.value)} required/></label></>:null}<label>理由・内容<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} required/></label><button type="submit" disabled={busy}>記録を残す</button></form>:null}{detail.followups.length?detail.followups.map(f=><article className={styles.item} key={f.id}><div><strong>{names[f.kind]}</strong><span>{f.amount===null?"":yen(f.amount)} {f.reason}</span>{f.kind==="correction_proposal"?<small>変更案：{yen(f.proposedBefore?.amount??null)} → {yen(f.proposedAfter?.amount??null)}。元の明細には未適用です。</small>:null}<small>状態：対応待ち ／ 記録日時：{new Date(f.occurredAt).toLocaleString("ja-JP")}</small></div></article>):<p>未完了事項の記録はありません。</p>}</section>
      {detail.followups.length?<section className={styles.card}><h2>次の担当・操作（確認待ち）</h2>{detail.followups.map(f=><p key={f.id}><strong>{names[f.kind]}</strong>：{nextOwners[f.kind]}。{f.kind==="report"?"自己記録のみで、LINE送信は未検証です。":"業務権限が確定するまで更新操作は行えません。"}</p>)}</section>:null}
      <section className={styles.disabled}><h2>金庫照合・締め</h2><p>現金取扱者の指定方法、支店ごとの残高式、再承認方法を確認中です。確定操作は利用できません。</p></section>
    </>:<section className={styles.card}><h2>まず業務日を開く</h2><p>その日の支出と、翌日へ引き継ぐ事項を記録できます。</p></section>}
  </div>;
}

type CandidateFields={merchant:string;category:string;amount:number;paymentSource:"company_wallet"|"personal"};
function ExpenseItemRow({item,editable,busy,onConfirm,onUpdate,onExclude}:{
  item:ExpenseItemDto;editable:boolean;busy:boolean;onConfirm:()=>void;
  onUpdate:(body:CandidateFields)=>Promise<boolean>;onExclude:(reason:string)=>Promise<boolean>;
}){
  const [editing,setEditing]=useState(false);
  const [merchant,setMerchant]=useState(item.merchant);
  const [category,setCategory]=useState(item.category);
  const [amount,setAmount]=useState(item.amount);
  const [paymentSource,setPaymentSource]=useState<CandidateFields["paymentSource"]>(item.paymentSource);
  const [excludeReason,setExcludeReason]=useState("");
  const [excluding,setExcluding]=useState(false);
  const candidate=item.status==="candidate";
  return <article className={styles.item}>
    <div className={styles.itemBody}>
      <strong>{item.merchant}</strong>
      <span>{item.category} · {yen(item.amount)} · {item.paymentSource==="personal"?"個人立替":"会社の財布"}</span>
      <small>{item.businessDate}に支出 ／ {candidate?"確認待ち候補":item.status==="excluded"?"集計対象外":"金額を確認済み"} ／ 証憑：未添付</small>
      {item.excludedReason?<small>対象外の理由：{item.excludedReason}</small>:null}
      {editable&&candidate&&editing?<form className={styles.row} onSubmit={e=>{e.preventDefault();void onUpdate({merchant,category,amount:Number(amount),paymentSource}).then(ok=>{if(ok)setEditing(false);});}}>
        <label>候補の支払先<input value={merchant} onChange={e=>setMerchant(e.target.value)} maxLength={200} required/></label>
        <label>候補の費目<input value={category} onChange={e=>setCategory(e.target.value)} maxLength={40} required/></label>
        <label>候補の支払額（円）<input type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)} required/></label>
        <label>候補の支払元<select value={paymentSource} onChange={e=>setPaymentSource(e.target.value as CandidateFields["paymentSource"])}><option value="company_wallet">会社の財布</option><option value="personal">個人立替</option></select></label>
        <button type="submit" disabled={busy}>候補を保存</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>閉じる</button>
      </form>:null}
      {editable&&candidate&&excluding?<form className={styles.row} onSubmit={e=>{e.preventDefault();void onExclude(excludeReason).then(ok=>{if(ok)setExcluding(false);});}}>
        <label>集計対象外にする理由<input value={excludeReason} onChange={e=>setExcludeReason(e.target.value)} maxLength={1000} required/></label>
        <button type="submit" disabled={busy}>理由を記録して除外</button><button type="button" disabled={busy} onClick={()=>setExcluding(false)}>閉じる</button>
      </form>:null}
    </div>
    {editable&&candidate?<div className={styles.actions}><button type="button" disabled={busy} onClick={()=>setEditing(true)}>候補を修正</button><button type="button" disabled={busy} onClick={()=>setExcluding(true)}>候補を除外</button><button type="button" disabled={busy} onClick={onConfirm}>内容を確認済みにする</button></div>:null}
  </article>;
}
