"use client";

import Link from "next/link";
import {ExpenseBranchWorkspace} from './ExpenseBranchWorkspace';
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import type {ExpenseDayDetailDto,ExpenseDayDto,ExpenseFollowupDto,ExpenseItemDto} from "@hanamaru/contracts";
import {ApiClientError} from "@/lib/api/client";
import {resources} from "@/lib/api/resources";
import styles from "./ExpenseExperience.module.css";

const today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
const yen=(value:number|string|null)=>value===null?"未入力":Number(value).toLocaleString("ja-JP")+"円";
const names:Record<ExpenseFollowupDto["kind"],string>={funding_request:"追加資金の依頼",unreplenished:"未補充",vault_discrepancy:"原因調査中の差異",report:"報告の自己記録",correction_proposal:"後日訂正案"};
const nextOwners:Record<ExpenseFollowupDto["kind"],string>={funding_request:"現金取扱者（指定方法は要確認）",unreplenished:"現金取扱者（指定方法は要確認）",vault_discrepancy:"管理者・現金取扱者（調査手順は要確認）",report:"報告者本人（外部送信は別確認）",correction_proposal:"管理者（適用・再承認は無効）"};
type Operation="expense.day.create"|"expense.day.update"|"expense.item.create"|"expense.item.update"|"expense.item.confirm"|"expense.item.exclude"|"expense.followup.create";
type Pending={key:string;operation:Operation;dayId:string|null;startedAt:number};
const operations=new Set<Operation>(["expense.day.create","expense.day.update","expense.item.create","expense.item.update","expense.item.confirm","expense.item.exclude","expense.followup.create"]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pendingStorage=(viewerId?:string)=>"hanamaru:expense:pending:"+String(viewerId??"unknown");
function readPending(viewerId?:string):Pending|null{
  if(typeof window==="undefined")return null;
  try{
    const value=JSON.parse(sessionStorage.getItem(pendingStorage(viewerId))??"null") as Pending|null;
    return value&&uuid.test(value.key)&&operations.has(value.operation)&&(!value.dayId||uuid.test(value.dayId))&&Number.isFinite(value.startedAt)?value:null;
  }catch{return null;}
}
function errorMessage(error:unknown){return error instanceof Error?error.message:"処理を完了できませんでした";}

export function ExpenseExperience({viewerId,capabilities}:{viewerId?:string;capabilities:string[]}){
  const [days,setDays]=useState<ExpenseDayDto[]>([]);
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [detail,setDetail]=useState<ExpenseDayDetailDto|null>(null);
  const [businessDate,setBusinessDate]=useState(today);
  const [searchDate,setSearchDate]=useState("");
  const [merchant,setMerchant]=useState(""),[category,setCategory]=useState("駐車場"),[amount,setAmount]=useState(""),[note,setNote]=useState("");
  const [source,setSource]=useState<"company_wallet"|"personal">("company_wallet");
  const [followKind,setFollowKind]=useState<ExpenseFollowupDto["kind"]>("funding_request");
  const [followAmount,setFollowAmount]=useState(""),[reason,setReason]=useState("");
  const [reportedAt,setReportedAt]=useState(""),[targetItem,setTargetItem]=useState(""),[proposedAmount,setProposedAmount]=useState("");
  const [opening,setOpening]=useState(""),[purchase,setPurchase]=useState(""),[purchaseSourceNote,setPurchaseSourceNote]=useState("");
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Pending|null>(()=>readPending(viewerId));
  const [dirtyItems,setDirtyItems]=useState<Set<string>>(()=>new Set());
  const requestSequence=useRef(0);
  const selectedRef=useRef<string|null>(null);
  const retryRequest=useRef<null|{key:string;send:(key:string)=>Promise<unknown>;dayId:string|null}>(null);
  const pendingRef=useRef<Pending|null>(pending);
  const [retryAvailable,setRetryAvailable]=useState(false);
  const dirty=(opening!==(detail?.day.openingWalletCash??"")||purchase!==(detail?.day.purchaseTotal??"")||purchaseSourceNote!==(detail?.day.purchaseSourceNote??""))&&!!detail
    ||Boolean(merchant||amount||note||reason||followAmount||reportedAt||proposedAmount||dirtyItems.size);
  const dirtyRef=useRef(dirty);
  useEffect(()=>{dirtyRef.current=dirty;},[dirty]);
  useEffect(()=>{pendingRef.current=pending;},[pending]);
  const locked=busy||!!pending;
  const canCreate=capabilities.includes("visit:self");
  const day=detail?.day;
  const ownRecord=Boolean(day&&viewerId===day.ownerMembershipId&&canCreate);
  const branchClosed=Boolean(detail?.branchClosingStatus&&detail.branchClosingStatus!=="open");
  const canEdit=ownRecord&&!branchClosed;

  const remember=useCallback((value:Pending|null)=>{
    pendingRef.current=value;setPending(value);
    try{if(value)sessionStorage.setItem(pendingStorage(viewerId),JSON.stringify(value));else sessionStorage.removeItem(pendingStorage(viewerId));return true;}
    catch{return false;}
  },[viewerId]);
  const load=useCallback(async(requested:string|null,filter?:string,preserveDrafts=false)=>{
    const sequence=++requestSequence.current;
    // A bookmarked day must resolve from its own endpoint, even when the list
    // page is stale, filtered, or temporarily unavailable.
    const listPromise=resources.expenseDays(filter?{businessDate:filter}:{});
    const direct=requested?await resources.expenseDay(requested).catch(e=>{
      if(sequence===requestSequence.current){selectedRef.current=requested;setSelected(requested);setDetail(null);setError("指定された日次記録を確認できません。"+errorMessage(e));}
      return null;
    }):null;
    if(requested&&!direct){void listPromise.catch(()=>undefined);return;}
    const list=await listPromise.catch(e=>{
      if(!direct)throw e;
      if(sequence===requestSequence.current)setNotice("一覧の取得に失敗しました。指定の日次は表示しています。");
      return {items:[] as ExpenseDayDto[],nextCursor:null};
    });
    const target=requested??list.items[0]?.id??null;
    let next:ExpenseDayDetailDto|null=null;
    if(direct)next=direct;
    else if(target){
      try{next=await resources.expenseDay(target);}
      catch(e){
        if(sequence===requestSequence.current){setSelected(target);setDetail(null);setError("指定された日次記録を確認できません。"+errorMessage(e));}
        return;
      }
    }
    if(sequence!==requestSequence.current)return;
    setDays(next&&!list.items.some(item=>item.id===next.day.id)?[next.day,...list.items]:list.items);
    setNextCursor(list.nextCursor);
    selectedRef.current=target;setSelected(target);setDetail(next);
    if(!preserveDrafts){
      setOpening(next?.day.openingWalletCash??"");
      setPurchase(next?.day.purchaseTotal??"");
      setPurchaseSourceNote(next?.day.purchaseSourceNote??"");
      setDirtyItems(new Set());
    }
    setError("");
    if(!requested){
      const url=new URL(window.location.href);if(target)url.searchParams.set("dayId",target);else url.searchParams.delete("dayId");
      window.history.replaceState(window.history.state,"",url.href);
    }
  },[]);
  useEffect(()=>{
    const fromUrl=new URL(window.location.href).searchParams.get("dayId");
    void load(fromUrl).catch(e=>setError(errorMessage(e)));
    const onPop=()=>{
      const url=new URL(window.location.href),target=url.searchParams.get("dayId");
      if(dirtyRef.current&&!window.confirm("未保存の入力があります。日次を切り替えますか？")){
        const restore=new URL(url);if(selectedRef.current)restore.searchParams.set("dayId",selectedRef.current);else restore.searchParams.delete("dayId");
        window.history.pushState(window.history.state,"",restore.href);return;
      }
      void load(target).catch(e=>setError(errorMessage(e)));
    };
    const onBeforeUnload=(e:BeforeUnloadEvent)=>{if(dirtyRef.current){e.preventDefault();e.returnValue="";}};
    const onLinkClick=(e:MouseEvent)=>{
      if(!dirtyRef.current||e.defaultPrevented||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
      const link=e.target instanceof Element?e.target.closest("a[href]"):null;
      if(!link||link.getAttribute("target")==="_blank")return;
      const destination=new URL(link.getAttribute("href")!,window.location.href);
      if(destination.origin===window.location.origin&&destination.pathname!==window.location.pathname&&!window.confirm("未保存の入力があります。移動しますか？"))e.preventDefault();
    };
    window.addEventListener("popstate",onPop);window.addEventListener("beforeunload",onBeforeUnload);
    document.addEventListener("click",onLinkClick,true);
    return()=>{window.removeEventListener("popstate",onPop);window.removeEventListener("beforeunload",onBeforeUnload);document.removeEventListener("click",onLinkClick,true);};
  },[load]);

  function navigate(id:string){
    if(locked)return;
    if(dirty&&!window.confirm("未保存の入力があります。日次を切り替えますか？"))return;
    const url=new URL(window.location.href);url.searchParams.set("dayId",id);
    window.history.pushState(window.history.state,"",url.href);
    void load(id).catch(e=>setError(errorMessage(e)));
  }
  async function refreshSaved(id:string|null,preserveDrafts=true){
    try{await load(id,undefined,preserveDrafts);setNotice("保存しました。");}
    catch(e){setNotice("保存は完了しました。表示の再取得に失敗しました。");setError(errorMessage(e));}
  }
  async function write(operation:Operation,dayId:string|null,send:(key:string)=>Promise<unknown>,after?:()=>void):Promise<boolean>{
    if(locked||pendingRef.current)return false;
    const key=crypto.randomUUID(),current:Pending={key,operation,dayId,startedAt:Date.now()};
    if(!remember(current)){
      remember(null);setError("このブラウザでは操作キーを一時保存できません。保存を開始せずに停止しました。ブラウザの設定を確認してください。");
      return false;
    }
    retryRequest.current={key,send,dayId};setRetryAvailable(true);
    setBusy(true);setError("");setNotice("");
    try{
      const result=await send(key) as {id?:string};
      retryRequest.current=null;setRetryAvailable(false);remember(null);after?.();
      if(operation==="expense.day.create"&&result.id){const url=new URL(window.location.href);url.searchParams.set("dayId",result.id);window.history.pushState(window.history.state,"",url.href);}
      await refreshSaved(operation==="expense.day.create"?result.id??dayId:dayId,operation!=="expense.day.create");
      return true;
    }catch(e){
      if(e instanceof ApiClientError&&e.status<500){
        retryRequest.current=null;setRetryAvailable(false);remember(null);
        setError(errorMessage(e));
      }else{
        setError("保存結果が不明です。同じ操作の結果を確認してください。");
      }
      return false;
    }finally{setBusy(false);}
  }
  async function checkPending(retry=false){
    const current=pendingRef.current;if(!current||busy)return;
    setBusy(true);setError("");
    try{
      const result=await resources.expenseOperation(current.key,current.operation);
      if(result.status==="succeeded"){
        remember(null);retryRequest.current=null;setRetryAvailable(false);
        if(current.operation==="expense.day.create"&&result.resourceId){const url=new URL(window.location.href);url.searchParams.set("dayId",result.resourceId);window.history.pushState(window.history.state,"",url.href);}
        await refreshSaved(current.operation==="expense.day.create"?result.resourceId:current.dayId,current.operation!=="expense.day.create");
      }else if(retry&&retryRequest.current?.key===current.key){
        const result=await retryRequest.current.send(current.key) as {id?:string};
        remember(null);retryRequest.current=null;setRetryAvailable(false);
        await refreshSaved(current.operation==="expense.day.create"?result.id??current.dayId:current.dayId,current.operation!=="expense.day.create");
      }else{
        setError(Date.now()-current.startedAt>=48*60*60*1000
          ?"操作結果の保管期間を過ぎました。新規登録する前に担当者へ記録を確認してください。"
          :"結果はまだ確認できません。しばらくしてから同じ操作を再確認してください。");
      }
    }catch(e){setError(errorMessage(e));}
    finally{setBusy(false);}
  }
  async function loadMore(){
    if(!nextCursor||busy)return;
    setBusy(true);
    try{
      const page=await resources.expenseDays({...(searchDate?{businessDate:searchDate}:{}),cursor:nextCursor});
      setDays(current=>[...current,...page.items.filter(item=>!current.some(existing=>existing.id===item.id))]);
      setNextCursor(page.nextCursor);
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  const itemDirty=useCallback((id:string,value:boolean)=>{
    setDirtyItems(previous=>{
      if(previous.has(id)===value)return previous;
      const next=new Set(previous);if(value)next.add(id);else next.delete(id);return next;
    });
  },[]);
  function searchSaved(filter:string){
    if(dirty&&!window.confirm("未保存の入力があります。検索結果へ移動しますか？"))return;
    const url=new URL(window.location.href);url.searchParams.delete("dayId");
    window.history.pushState(window.history.state,"",url.href);
    void load(null,filter).catch(e=>setError(errorMessage(e)));
  }
  function onCreate(e:FormEvent){e.preventDefault();void write("expense.day.create",null,key=>resources.createExpenseDay(businessDate,key));}
  function onAdd(e:FormEvent){
    e.preventDefault();if(!day)return;
    const body={merchant,category,amount:Number(amount),paymentSource:source,note};
    void write("expense.item.create",day.id,key=>resources.addExpenseItem(day.id,body,key),()=>{setMerchant("");setAmount("");setNote("");});
  }
  function onFollowup(e:FormEvent){
    e.preventDefault();if(!day)return;
    const body={
      kind:followKind,reason,
      ...(["funding_request","unreplenished","vault_discrepancy"].includes(followKind)?{amount:Number(followAmount)}:{}),
      ...(followKind==="correction_proposal"?{targetItemId:targetItem,proposedAmount:Number(proposedAmount)}:{}),
      ...(followKind==="report"&&reportedAt?{reportedAt:new Date(reportedAt+"+09:00").toISOString()}:{}),
    };
    void write("expense.followup.create",day.id,key=>resources.addExpenseFollowup(day.id,body,key),()=>{setReason("");setFollowAmount("");setProposedAmount("");setReportedAt("");});
  }
  return <div className={styles.page}>
    <header><p className={styles.eyebrow}>日次記録</p><h1>経費・車両金精算</h1><p>支出を記録し、確定した明細だけを日次へ集計します。拠点の担当者は日次取りまとめから補充・照合・締めへ進めます。</p><Link href="/">買取支援ホームへ戻る</Link></header>
    <ExpenseBranchWorkspace viewerId={viewerId}/>
    {error?<p className={styles.error} role="alert">{error}　<button type="button" onClick={()=>void load(selected).catch(e=>setError(errorMessage(e)))}>再読込</button></p>:null}
    {notice?<p role="status">{notice}</p>:null}
    {pending?<section className={styles.card} aria-label="保存結果の確認"><h2>保存結果の確認</h2><p>前回の保存結果を確認してください。この操作の入力内容はブラウザに保存していません。結果不明のまま新しい登録を作成しません。</p><div className={styles.actions}><button type="button" disabled={busy} onClick={()=>void checkPending()}>保存結果を確認</button>{retryAvailable?<button type="button" disabled={busy} onClick={()=>void checkPending(true)}>同じ操作を再試行</button>:null}</div></section>:null}
    <nav className={styles.steps} aria-label="業務の進め方"><span>1 日次を開く</span><span>2 支出を記録</span><span>3 内容を確認</span><span>4 未完了事項を残す</span></nav>
    <section className={styles.card}>
      <h2>業務日を選ぶ</h2>
      {canCreate?<form onSubmit={onCreate} className={styles.row}><label>業務日<input type="date" value={businessDate} onChange={e=>setBusinessDate(e.target.value)} required/></label><button type="submit" disabled={locked}>日次記録を開く</button></form>:<p>閲覧権限のある日次記録を確認できます。本人の記録作成・更新はできません。</p>}
      <form className={styles.row} onSubmit={e=>{e.preventDefault();searchSaved(searchDate);}}><label>保存済み日次を業務日で検索<input type="date" value={searchDate} onChange={e=>setSearchDate(e.target.value)}/></label><button type="submit" disabled={locked}>検索</button><button type="button" disabled={locked} onClick={()=>{setSearchDate("");searchSaved("");}}>検索を解除</button></form>
      {days.length?<label>保存済みの日次<select value={selected??""} onChange={e=>navigate(e.target.value)}>{days.map(item=><option value={item.id} key={item.id}>{item.businessDate} · {item.id.slice(0,8)}</option>)}</select></label>:<p>保存済みの日次はありません。</p>}
      {nextCursor?<button className={styles.secondaryButton} type="button" disabled={busy} onClick={()=>void loadMore()}>さらに古い日次を表示</button>:null}
    </section>
    {day?<><section className={styles.card}>
      <h2>{day.businessDate} の取りまとめ</h2><p>記録者：{ownRecord?"ログイン中の本人":"別の査定員（閲覧のみ）"} ／ 状態：{branchClosed?"拠点締め済み":"下書き"}</p>
      {branchClosed?<p role="status">この業務日は締め済みです。経費の追加・訂正は役職者へ依頼してください。報告・訂正案は未完了事項から記録できます。</p>:null}
      <div className={styles.metrics}><div><small>確定・会社の財布</small><strong>{yen(detail.totals.companyWallet)}</strong></div><div><small>確定・個人立替</small><strong>{yen(detail.totals.personal)}</strong></div><div><small>確認待ち候補</small><strong>{detail.totals.candidateCount}件</strong></div></div>
      <p>財布残高・金庫残高：<strong>未算定</strong>。支店ごとの計算契約は確認待ちです。</p>
      {canEdit?<><form className={styles.row} onSubmit={e=>{e.preventDefault();const body={expectedLockVersion:day.lockVersion,openingWalletCash:opening===""?null:Number(opening),purchaseTotal:purchase===""?null:Number(purchase),purchaseSourceNote:purchaseSourceNote||null};void write("expense.day.update",day.id,key=>resources.updateExpenseDay(day.id,body,key));}}>
        <label>実際の開始財布残高（任意）<input inputMode="numeric" type="number" min="0" value={opening} onChange={e=>setOpening(e.target.value)}/></label>
        <label>買取金の入力値（任意）<input inputMode="numeric" type="number" min="0" value={purchase} onChange={e=>setPurchase(e.target.value)}/></label>
        <label>買取金の参照元メモ（任意）<input value={purchaseSourceNote} onChange={e=>setPurchaseSourceNote(e.target.value)} maxLength={1000} placeholder="資料名・対象範囲・管理番号など"/></label>
        <button type="submit" disabled={locked}>入力値を保存</button>
      </form><p className={styles.note}>空欄と0円を区別します。参照元メモに顧客情報は入力しないでください。メモは照合済みの証明ではありません。</p></>:<p>開始財布残高：{yen(day.openingWalletCash)} ／ 買取金の入力値：{yen(day.purchaseTotal)} ／ 参照元メモ：{day.purchaseSourceNote??"未記録"}</p>}
    </section>
    <section className={styles.card}><h2>支出を記録する</h2><p className={styles.note}>領収書画像の取込と実OCRは未接続です。候補は確認まで合計へ入りません。確認済みも証憑未添付であり、支店照合・締めは完了していません。</p>
      {canEdit?<form onSubmit={onAdd} className={styles.row}><label>支払先<input value={merchant} onChange={e=>setMerchant(e.target.value)} maxLength={200} required/></label><label>費目<select value={category} onChange={e=>setCategory(e.target.value)}><option>駐車場</option><option>燃料</option><option>高速道路</option><option>車両整備</option><option>その他・確認待ち</option></select></label><label>支払額（円）<input type="number" inputMode="numeric" min="1" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><label>支払元<select value={source} onChange={e=>setSource(e.target.value as typeof source)}><option value="company_wallet">会社の財布</option><option value="personal">個人立替</option></select></label><label>用途・補足（任意）<input value={note} onChange={e=>setNote(e.target.value)} maxLength={1000}/></label><button type="submit" disabled={locked}>候補として保存</button></form>:null}
      <h3>明細</h3>{detail.items.length?detail.items.map(item=><ExpenseItemRow key={item.id} item={item} editable={canEdit} busy={locked} onDraftChange={itemDirty} onConfirm={()=>void write("expense.item.confirm",day.id,key=>resources.confirmExpenseItem(day.id,item.id,item.lockVersion,key))} onUpdate={body=>write("expense.item.update",day.id,key=>resources.updateExpenseCandidate(day.id,item.id,{expectedLockVersion:item.lockVersion,...body},key))} onExclude={reason=>write("expense.item.exclude",day.id,key=>resources.excludeExpenseCandidate(day.id,item.id,item.lockVersion,reason,key))}/>):<p>支出明細はありません。</p>}
    </section>
    <section className={styles.card}><h2>未完了事項と次の担当</h2><p>追加金の依頼は入金実績ではありません。未補充は原因不明の差異と分けて記録します。報告の自己記録は外部送信の証明ではありません。</p>
      {ownRecord?<form className={styles.row} onSubmit={onFollowup}><label>記録の種類<select value={followKind} onChange={e=>setFollowKind(e.target.value as typeof followKind)}><option value="funding_request">追加資金の依頼</option><option value="unreplenished">未補充</option><option value="vault_discrepancy">原因調査中の差異</option><option value="report">報告の自己記録</option><option value="correction_proposal">後日訂正案</option></select></label>
        {["funding_request","unreplenished","vault_discrepancy"].includes(followKind)?<label>金額（円）<input type="number" inputMode="numeric" min="0" value={followAmount} onChange={e=>setFollowAmount(e.target.value)} required/></label>:null}
        {followKind==="report"?<label>実際に報告した日時（任意・日本時間）<input type="datetime-local" value={reportedAt} onChange={e=>setReportedAt(e.target.value)} max={new Date().toLocaleString("sv-SE",{timeZone:"Asia/Tokyo",hour12:false}).replace(" ","T").slice(0,16)}/></label>:null}
        {followKind==="correction_proposal"?<><label>訂正対象<select value={targetItem} onChange={e=>setTargetItem(e.target.value)} required><option value="">明細を選択</option>{detail.items.filter(item=>item.status==="confirmed").map(item=><option value={item.id} key={item.id}>{item.merchant} · {yen(item.amount)}</option>)}</select></label><label>提案する金額（円）<input type="number" inputMode="numeric" min="1" value={proposedAmount} onChange={e=>setProposedAmount(e.target.value)} required/></label></>:null}
        <label>理由・内容<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} required/></label><button type="submit" disabled={locked}>記録を残す</button>
      </form>:null}
      {detail.followups.length?detail.followups.map(f=><article className={styles.item} key={f.id}><div><strong>{names[f.kind]}</strong><span>{f.amount===null?"":yen(f.amount)} {f.reason}</span>{f.kind==="correction_proposal"?<small>変更案：{yen(f.proposedBefore?.amount??null)} → {yen(f.proposedAfter?.amount??null)}。元の明細には未適用です。</small>:null}{f.kind==="report"?<small>実報告日時：{f.reportedAt?new Date(f.reportedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}):"未記録"} ／ 外部送信は未検証</small>:null}<small>状態：対応待ち ／ 登録日時：{new Date(f.createdAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}</small></div></article>):<p>未完了事項の記録はありません。</p>}
    </section>
    {detail.followups.length?<section className={styles.card}><h2>次の担当・操作（確認待ち）</h2>{detail.followups.map(f=><p key={f.id}><strong>{names[f.kind]}</strong>：{nextOwners[f.kind]}。{f.kind==="report"?"自己記録のみで、LINE送信は未検証です。":"業務権限が確定するまで更新操作は行えません。"}</p>)}</section>:null}
    <section className={styles.disabled}><h2>金庫照合・締め</h2><p>個人の日次からは締めません。指定された拠点担当者が、上の「拠点の日次取りまとめ・補充・締め」で全員分を確認します。拠点の権限・照合方式が未設定の場合、確定操作は利用できません。</p></section>
    </>:<section className={styles.card}><h2>まず業務日を開く</h2><p>その日の支出と、翌日へ引き継ぐ事項を記録できます。</p></section>}
  </div>;
}

type CandidateFields={merchant:string;category:string;amount:number;paymentSource:"company_wallet"|"personal";note?:string};
function ExpenseItemRow({item,editable,busy,onConfirm,onUpdate,onExclude,onDraftChange}:{
  item:ExpenseItemDto;editable:boolean;busy:boolean;onConfirm:()=>void;
  onUpdate:(body:CandidateFields)=>Promise<boolean>;onExclude:(reason:string)=>Promise<boolean>;
  onDraftChange:(id:string,value:boolean)=>void;
}){
  const [editing,setEditing]=useState(false),[excluding,setExcluding]=useState(false);
  const [merchant,setMerchant]=useState(item.merchant),[category,setCategory]=useState(item.category);
  const [amount,setAmount]=useState(item.amount),[paymentSource,setPaymentSource]=useState<CandidateFields["paymentSource"]>(item.paymentSource);
  const [note,setNote]=useState(item.note??""),[excludeReason,setExcludeReason]=useState("");
  const candidate=item.status==="candidate";
  const dirty=(editing&&(merchant!==item.merchant||category!==item.category||String(amount)!==item.amount||paymentSource!==item.paymentSource||note!==(item.note??"")))||(excluding&&!!excludeReason);
  useEffect(()=>{onDraftChange(item.id,dirty);return()=>onDraftChange(item.id,false);},[item.id,dirty,onDraftChange]);
  return <article className={styles.item}>
    <div className={styles.itemBody}>
      <strong>{item.merchant}</strong>
      <span>{item.category} · {yen(item.amount)} · {item.paymentSource==="personal"?"個人立替":"会社の財布"}</span>
      <small>{item.businessDate}に支出 ／ {candidate?"確認待ち候補":item.status==="excluded"?"集計対象外":"金額を確認済み"} ／ 証憑：未添付</small>
      {item.note?<small>用途・補足：{item.note}</small>:null}
      {item.excludedReason?<small>対象外の理由：{item.excludedReason}</small>:null}
      {editable&&candidate&&editing?<form className={styles.row} onSubmit={e=>{e.preventDefault();void onUpdate({merchant,category,amount:Number(amount),paymentSource,note}).then(ok=>{if(ok)setEditing(false);});}}>
        <label>候補の支払先<input value={merchant} onChange={e=>setMerchant(e.target.value)} maxLength={200} required/></label>
        <label>候補の費目<input value={category} onChange={e=>setCategory(e.target.value)} maxLength={40} required/></label>
        <label>候補の支払額（円）<input type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)} required/></label>
        <label>候補の支払元<select value={paymentSource} onChange={e=>setPaymentSource(e.target.value as CandidateFields["paymentSource"])}><option value="company_wallet">会社の財布</option><option value="personal">個人立替</option></select></label>
        <label>候補の用途・補足（任意）<input value={note} onChange={e=>setNote(e.target.value)} maxLength={1000}/></label>
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
