"use client";

import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import type {ExpenseBranchDetailDto,ExpenseBranchEventDto,ExpenseBranchListDto,ExpenseBranchOptionDto} from '@hanamaru/contracts';
import {expenseCashResources as api} from '@/lib/api/resources';
import {ApiClientError} from '@/lib/api/client';
import styles from './ExpenseBranchWorkspace.module.css';

type Field={name:string;label:string;type?:'number'|'datetime-local'|'checkbox'|'textarea';options?:Array<{value:string;label:string}>;optional?:boolean};
type Pending={key:string;operation:string;targetId:string|null;startedAt:number};
const messages:Record<string,string>={open:'入力・確認中',closed_balanced:'締め済み・差異なし',closed_difference:'締め済み・差異あり'};
const yen=(v:string|null)=>v===null?'未入力':`${Number(v).toLocaleString('ja-JP')}円`;
const stamp=(v:string)=>new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
const message=(e:unknown)=>e instanceof Error?e.message:'処理を完了できませんでした';
const uuid=/^[0-9a-f-]{36}$/i;

export function ExpenseBranchWorkspace({viewerId}:{viewerId?:string}){
 const storage=`hanamaru:expense:branch-pending:${viewerId??'unknown'}`;
 const [options,setOptions]=useState<ExpenseBranchOptionDto[]>([]),[branch,setBranch]=useState(''),[businessDate,setDate]=useState(today);
 const [listing,setListing]=useState<ExpenseBranchListDto|null>(null),[detail,setDetail]=useState<ExpenseBranchDetailDto|null>(null);
 const [members,setMembers]=useState<string[]>([]),[rosterNote,setRosterNote]=useState('');
 const [logs,setLogs]=useState<ExpenseBranchEventDto[]|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(()=>{
  try{const saved=JSON.parse(sessionStorage.getItem(storage)??'null') as Pending|null;return saved&&uuid.test(saved.key)&&typeof saved.operation==='string'&&Number.isFinite(saved.startedAt)?saved:null;}catch{return null;}
 }),[resetKey,setResetKey]=useState(0),[canRetry,setCanRetry]=useState(false);
 const active=useRef<string|null>(null),sequence=useRef(0),dirty=useRef(false),rosterDirty=useRef(false),inflight=useRef(false);
 const retry=useRef<null|{pending:Pending;body:Record<string,unknown>}>(null);
 const refresh=useCallback(async(target:string|null,branchId?:string,date?:string)=>{
  const seq=++sequence.current;
  if(target){const d=await api.read(target);const l=await api.list(d.day.branchId,d.day.businessDate);if(seq!==sequence.current)return;setDetail(d);setBranch(d.day.branchId);setDate(d.day.businessDate);setListing(l);if(!rosterDirty.current){setMembers(d.participants.map(p=>p.ownerMembershipId));setRosterNote(d.day.rosterNote);}active.current=d.day.id;}
  else if(branchId&&date){const l=await api.list(branchId,date);if(seq!==sequence.current)return;setListing(l);setDetail(null);setMembers([]);setRosterNote('');active.current=null;}
  setLogs(null);
 },[]);
 const navigate=useCallback(async(target:string|null,b?:string,d?:string,replace=false)=>{
  if(dirty.current&&!window.confirm('未保存の入力があります。拠点の日次を切り替えますか？'))return;
  dirty.current=false;rosterDirty.current=false;
  const url=new URL(location.href);if(target)url.searchParams.set('branchDayId',target);else url.searchParams.delete('branchDayId');
  if(replace)history.replaceState(history.state,'',url);else history.pushState(history.state,'',url);
  setError('');setNotice('');setBusy(true);setDetail(null);active.current=target;
  try{await refresh(target,b,d);setResetKey(k=>k+1);}catch(e){setError(message(e));}finally{setBusy(false);}
 },[refresh]);
 useEffect(()=>{
  let cancelled=false;
  void api.options().then(async opts=>{if(cancelled)return;setOptions(opts);const target=new URL(location.href).searchParams.get('branchDayId');if(target)await refresh(target);else if(opts[0]){setBranch(opts[0].id);await refresh(null,opts[0].id,today());}}).catch(e=>{if(!cancelled)setError(message(e));});
  const pop=()=>{const target=new URL(location.href).searchParams.get('branchDayId');if(target===active.current)return;if(dirty.current&&!window.confirm('未保存の入力があります。移動しますか？')){const u=new URL(location.href);if(active.current)u.searchParams.set('branchDayId',active.current);else u.searchParams.delete('branchDayId');history.pushState(history.state,'',u);return;}dirty.current=false;setDetail(null);active.current=target;void refresh(target).catch(e=>setError(message(e)));};
  const unload=(e:BeforeUnloadEvent)=>{if(dirty.current||inflight.current){e.preventDefault();e.returnValue='';}};
  const link=(e:MouseEvent)=>{const a=e.target instanceof Element?e.target.closest('a[href]'):null;if(a&&dirty.current&&!e.defaultPrevented&&!window.confirm('未保存の入力があります。移動しますか？'))e.preventDefault();};
  addEventListener('popstate',pop);addEventListener('beforeunload',unload);document.addEventListener('click',link,true);
  return()=>{cancelled=true;removeEventListener('popstate',pop);removeEventListener('beforeunload',unload);document.removeEventListener('click',link,true);};
 },[refresh,storage]);
 const remember=useCallback((p:Pending|null)=>{if(p)sessionStorage.setItem(storage,JSON.stringify(p));else sessionStorage.removeItem(storage);setPending(p);},[storage]);
 const execute=useCallback(async(p:Pending,body:Record<string,unknown>)=>{
  if(inflight.current)return false;
  if(Date.now()-p.startedAt>=48*60*60*1000){setError('操作キーの保持期間を超えました。再送せず記録を確認してください。');setCanRetry(false);return false;}
  inflight.current=true;setBusy(true);setError('');
  let saved=false;
  try{
   const r=p.operation==='create'?await api.create(body,p.key):await api.command(p.targetId!,p.operation,body,p.key);
   saved=true;if(p.operation==='roster'||p.operation==='create')rosterDirty.current=false;remember(null);retry.current=null;setCanRetry(false);setNotice('保存しました。');
   const u=new URL(location.href);u.searchParams.set('branchDayId',r.id);history.replaceState(history.state,'',u);active.current=r.id;
   await refresh(r.id);
  }catch(e){
   if(saved)setError('保存は完了しました。表示の再取得に失敗しました。再読込してください。');
   else if(e instanceof ApiClientError&&e.status>=400&&e.status<500){remember(null);retry.current=null;setCanRetry(false);setError(message(e));}
   else setError(`${message(e)} 保存結果を確認してください。同じ内容で再試行できます。`);
  }finally{inflight.current=false;setBusy(false);}
  return saved;
 },[refresh,remember]);
 const write=useCallback(async(operation:string,body:Record<string,unknown>)=>{
  if(pending||inflight.current)return false;
  const p={key:crypto.randomUUID(),operation,targetId:detail?.day.id??null,startedAt:Date.now()};
  const payload=operation==='create'?body:{...body,expectedLockVersion:detail!.day.lockVersion};
  try{remember(p);}catch{setError('操作キーを一時保存できません。送信せずに停止しました。');return false;}
  retry.current={pending:p,body:payload};setCanRetry(true);return execute(p,payload);
 },[pending,detail,remember,execute]);
 async function check(){
  if(!pending||inflight.current)return;setBusy(true);
  try{const r=await api.result(pending.key,pending.operation);if(r.status==='succeeded'&&r.resourceId){remember(null);retry.current=null;dirty.current=false;setNotice('前回の保存完了を確認しました。');setResetKey(k=>k+1);await navigate(r.resourceId,undefined,undefined,true);}else setError('保存結果は不明です。48時間を超えた操作も自動で再登録しません。記録を確認してください。');}catch(e){setError(message(e));}finally{setBusy(false);}
 }
 const disabled=busy||!!pending,open=detail?.day.status==='open',officer=detail?.permission.authority==='officer';
 const selectedPolicy=options.find(o=>o.id===branch);
 const people=listing?.members.map(m=>({value:m.id,label:m.displayName}))??[];
 const participantOptions=detail?.participants.map(p=>({value:p.id,label:p.displayName}))??[];
 const person:Field={name:'dayId',label:'対象者の日次',options:participantOptions};
 const expenseFields:Field[]=[person,{name:'merchant',label:'支払先'},{name:'category',label:'費目'},{name:'amount',label:'支出額（円）',type:'number'},{name:'paymentSource',label:'支払元',options:[{value:'company_wallet',label:'会社の財布'},{value:'personal',label:'個人立替'}]},{name:'note',label:'用途・補足',type:'textarea',optional:true},{name:'humanConfirmed',label:'支出日・支出者・金額を人が確認しました',type:'checkbox'}];
 const markDirty=useCallback(()=>{dirty.current=true;},[]);
 const form=(title:string,action:string,fields:Field[],fixed:Record<string,unknown>={},button='保存する')=><CashForm key={`${resetKey}:${title}`} title={title} fields={fields} disabled={disabled} button={button} onDirty={markDirty} onSubmit={b=>write(action,{...fixed,...b})}/>;
 return <details className={styles.workspace} open={undefined} name="expense-branch" ref={el=>{if(el&&typeof location!=='undefined'&&new URL(location.href).searchParams.has('branchDayId'))el.open=true;}}>
  <summary>拠点の日次取りまとめ・補充・締め</summary>
  <p>対象者の入力状況を確認し、最終照合へ進みます。入力途中の差額は暫定値です。</p>
  {error?<p role="alert" className={styles.error}>{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  {pending?<section className={styles.warning}><h3>前回の保存結果を確認</h3><p>再読込後も操作キーだけを保持します。入力内容は保存しません。</p><button disabled={busy} onClick={()=>void check()}>拠点の保存結果を確認</button>{canRetry?<button disabled={busy} onClick={()=>{const r=retry.current;if(r)void execute(r.pending,r.body);}}>同じ内容で再試行</button>:null}</section>:null}
  {!options.length?<p>拠点の現金業務担当が未指定です。本人の支出記録は下の画面から行えます。</p>:<>
   <form className={styles.grid} onSubmit={e=>{e.preventDefault();void navigate(null,branch,businessDate);}}>
    <label>取りまとめ拠点<select value={branch} disabled={disabled} onChange={e=>setBranch(e.target.value)}>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
    <label>取りまとめ業務日<input type="date" required value={businessDate} disabled={disabled} onChange={e=>setDate(e.target.value)}/></label><button disabled={disabled}>拠点の日次を検索</button>
   </form>
   {listing?.days.map(d=><button key={d.id} disabled={disabled} onClick={()=>void navigate(d.id)}>{d.businessDate}：{messages[d.status]}{d.reviewRequired?'・訂正影響の確認待ち':''}</button>)}
   {!!listing?.pending.length&&<section className={styles.warning}><h3>前日までを含む未解決事項</h3>{listing.pending.map(i=><p key={i.id}><button disabled={disabled} onClick={()=>void navigate(i.branchDayId)}>{i.businessDate}の{i.kind==='cash_difference'?'現金差異':'訂正後確認'}を開く</button> {yen(i.amount)} {i.note}</p>)}</section>}
   {!detail&&!listing?.days.length&&listing?<form onSubmit={e=>{e.preventDefault();void write('create',{branchId:branch,businessDate,memberIds:members,rosterNote});}}>
    <fieldset disabled={disabled}><legend>当日の現金業務対象者</legend><p>休み・直帰などを確認し、今回取りまとめる対象者を選択してください。</p>{people.map(p=><label className={styles.check} key={p.value}><input type="checkbox" checked={members.includes(p.value)} onChange={e=>{dirty.current=true;rosterDirty.current=true;setMembers(v=>e.target.checked?[...v,p.value]:v.filter(x=>x!==p.value));}}/>{p.label}</label>)}<label>対象者の確認メモ<textarea required maxLength={1000} value={rosterNote} onChange={e=>{dirty.current=true;rosterDirty.current=true;setRosterNote(e.target.value);}}/></label><button disabled={!members.length}>拠点の日次を作成</button></fieldset>
   </form>:null}
  </>}
  {detail?<>
   <header><h2>{detail.day.businessDate}の拠点取りまとめ</h2><strong>{messages[detail.day.status]}</strong><p>次の操作：{open?'対象者の入力確認 → 補充実績 → 金庫照合 → 締め':'報告実績を記録し、未解決事項を担当者へ引き継ぐ'}</p><button disabled={disabled} onClick={()=>{if(!dirty.current||window.confirm('未保存入力を破棄して再読込しますか？')){dirty.current=false;void refresh(detail.day.id).then(()=>setResetKey(k=>k+1)).catch(e=>setError(message(e)));}}}>拠点の日次を再読込</button></header>
   {detail.day.reviewRequired?<p className={styles.warning}>過去日の経費訂正による影響の確認が必要です。締め時点の数値は保持しています。再承認・再報告の運用は確認待ちです。</p>:null}
   <section><h3>対象者の入力状況</h3><p>入力完了 {detail.participants.filter(p=>p.readyAt).length} / {detail.participants.length} 人</p><div className={styles.cards}>{detail.participants.map(p=><article key={p.id}><h4>{p.displayName}</h4><p>{p.readyAt?'✓ 入力完了':'○ 入力・確認待ち'}</p><dl><dt>買取金</dt><dd>{yen(p.purchaseTotal)}</dd><dt>会社財布の経費</dt><dd>{yen(p.companyExpense)}</dd><dt>個人立替</dt><dd>{yen(p.personalExpense)}</dd><dt>未確認候補</dt><dd>{p.candidateCount}件</dd></dl>{open?<button disabled={disabled} onClick={()=>void write('ready',{dayId:p.id})}>この人の入力完了を記録</button>:null}</article>)}</div></section>
   {open?<>
    <details><summary>対象者を変更する</summary><form onSubmit={e=>{e.preventDefault();void write('roster',{memberIds:members,rosterNote});}}><fieldset disabled={disabled}>{people.map(p=><label className={styles.check} key={p.value}><input type="checkbox" checked={members.includes(p.value)} onChange={e=>{dirty.current=true;rosterDirty.current=true;setMembers(v=>e.target.checked?[...v,p.value]:v.filter(x=>x!==p.value));}}/>{p.label}</label>)}<label>変更理由・対象者の確認メモ<textarea required value={rosterNote} onChange={e=>{dirty.current=true;rosterDirty.current=true;setRosterNote(e.target.value);}}/></label><button>対象者を更新</button></fieldset></form></details>
    {form('日次の代理入力','entry',[person,{name:'openingWalletCash',label:'開始財布額（円）',type:'number'},{name:'purchaseTotal',label:'買取金額（円）',type:'number'},{name:'purchaseSourceNote',label:'買取金額の参照元'}],{entryType:'daily'})}
    {form('確認済み経費の代理入力','entry',expenseFields,{entryType:'expense'},'確認した経費を登録')}
    {form('財布への補充実績','transfer',[person,{name:'amount',label:'実際の補充額（円）',type:'number'},{name:'performedBy',label:'実際の現金取扱者',options:people},{name:'occurredAt',label:'補充した日時（日本時間）',type:'datetime-local'},{name:'unreplenishedId',label:'対応する未補充記録',options:detail.unreplenished.filter(f=>f.status==='open').map(f=>({value:f.id,label:`${f.reason} ${yen(f.amount)}`})),optional:true},{name:'reason',label:'補充の記録メモ'}],{},'補充実績を記録')}
   </>:null}
   <section><h3>補充と未補充</h3><p>補充は金庫から財布への移動です。経費には加算しません。</p>{detail.transfers.map(t=><p key={t.id}>{t.reversesId?'取消':'補充'} {yen(t.amount)} / {stamp(t.occurredAt)}</p>)}{detail.unreplenished.map(f=><p key={f.id}>{f.status==='open'?'未補充':'補充済み'}：{f.reason} 元の未補充額 {yen(f.amount)} ／ 補充済額 {yen(f.replenishedAmount)} ／ 未補充残額 {yen(String(Number(f.amount)-Number(f.replenishedAmount)))}</p>)}</section>
   {open&&officer&&detail.transfers.some(t=>!t.reversesId)?form('補充記録の誤入力取消','reverse-transfer',[person,{name:'transferId',label:'取消対象',options:detail.transfers.filter(t=>!t.reversesId&&!detail.transfers.some(r=>r.reversesId===t.id)).map(t=>({value:t.id,label:`${yen(t.amount)} ${stamp(t.occurredAt)}`}))},{name:'amount',label:'取消対象と同じ金額（円）',type:'number'},{name:'performedBy',label:'取消記録担当者',options:people},{name:'occurredAt',label:'記録対象日時（日本時間）',type:'datetime-local'},{name:'reason',label:'取消理由'}],{},'履歴を残して取消'):null}
   {open&&detail.permission.canClose?<>
    <p>照合方式：{selectedPolicy?.reconciliationMode==='external_reference'?'確認済み資料の参照額と照合':selectedPolicy?.reconciliationMode==='vault_ledger_v1'?'金庫開始額＋外部入金−外部出金−財布補充':'未設定'}。{selectedPolicy?.policyReference}</p>
    {selectedPolicy?.reconciliationMode?form('金庫の最終照合','reconcile',[
     ...(selectedPolicy.reconciliationMode==='external_reference'?[{name:'expectedCash',label:'資料で確認した金庫残高（円）',type:'number' as const}]:[{name:'openingVault',label:'金庫開始額（円）',type:'number' as const},{name:'externalInflow',label:'金庫への外部入金（円）',type:'number' as const},{name:'externalOutflow',label:'金庫からの外部出金（補充を除く・円）',type:'number' as const}]),
     {name:'actualCash',label:'実際に数えた金庫残高（円）',type:'number'},{name:'reference',label:'照合元資料・対象範囲'}],{},'照合結果を保存'): <p>拠点の照合方式を確認してから有効化します。</p>}
   </>:null}
   {detail.day.expectedCash!==null?<section className={styles.warning}><h3>{open?'締め前の照合値':'締め時点の照合値'}</h3><p>参照・計算残高：{yen(detail.day.expectedCash)} ／ 実残高：{yen(detail.day.actualCash)}</p><p>差額：{yen(String(Number(detail.day.actualCash)-Number(detail.day.expectedCash)))}</p>{open&&Number(detail.day.reconciliationVersion)!==detail.day.lockVersion?<p>入力が更新されています。締め前に再照合してください。</p>:null}</section>:null}
   {open&&detail.permission.canClose?<CashForm key={`${resetKey}:close`} title="日次の締め" disabled={disabled} onDirty={()=>{dirty.current=true;}} button={Number(detail.day.actualCash)!==Number(detail.day.expectedCash)?'差異を残して締める':'日次を締める'} fields={Number(detail.day.actualCash)!==Number(detail.day.expectedCash)?[{name:'note',label:'差異の状況（原因調査中でも可）'},{name:'assigneeId',label:'調査担当者',options:people},{name:'acknowledgeDifference',label:'差異と調査事項を残して締めます',type:'checkbox'}]:[]} onSubmit={b=>{if(!window.confirm('この時点の内容を保存して締めます。よろしいですか？'))return Promise.resolve();return write('close',b);}}/>:null}
   {detail.closure?<p>締め日時：{stamp(detail.closure.closedAt)} ／ 締め時差異：{yen(detail.closure.difference)}。締め時点の明細と金額は履歴として保持しています。</p>:null}
   {officer?form('役職者による経費の後日追加・訂正','correct',[person,{name:'itemId',label:'訂正対象（未選択なら経費の追加）',optional:true,options:detail.items.filter(i=>i.status==='confirmed').map(i=>({value:i.id,label:`${i.merchant} ${yen(i.amount)}・版${i.lockVersion}`}))},...expenseFields.slice(1),{name:'reason',label:'追加・訂正の理由'}],{},'理由を残して経費を訂正'):null}
   {form('報告実績の記録','report',[{name:'reportedAt',label:'実際に報告した日時（日本時間）',type:'datetime-local'},{name:'note',label:'報告先・内容のメモ'}],{},'報告実績を記録')}
   <p>報告は手動の実績記録です。LINEの自動送信は行いません。{detail.report?`実報告日時：${stamp(detail.report.reportedAt)} ／ 登録日時：${stamp(detail.report.createdAt)}`:'報告実績：未記録'}</p>
   <section><h3>締め後の引継ぎ</h3>{detail.issues.length?detail.issues.map(i=><p key={i.id}>{i.status==='open'?'○ 対応待ち':'✓ 調査完了'}：{i.kind==='cash_difference'?'現金差異':'訂正後の確認'} {i.note} {i.resolutionNote}</p>):<p>引継ぎ事項はありません。</p>}</section>
   {officer&&detail.issues.some(i=>i.kind==='cash_difference'&&i.status==='open')?form('差異調査の結果を記録','resolve',[{name:'issueId',label:'対象の差異',options:detail.issues.filter(i=>i.kind==='cash_difference'&&i.status==='open').map(i=>({value:i.id,label:i.note}))},{name:'note',label:'調査結果・対応した記録の参照先'}],{},'調査完了を記録'):null}
   {officer?<section><h3>役職者専用の記録ログ</h3><button disabled={disabled} onClick={()=>void api.logs(detail.day.id).then(setLogs).catch(e=>setError(message(e)))}>記録ログを表示</button>{logs?.map((l,i)=><details key={i}><summary>{l.action} / {stamp(l.createdAt)} / {people.find(p=>p.value===l.actorId)?.label??l.actorId}</summary><pre tabIndex={0} role="region" aria-label={`${l.action}の記録詳細`}>{JSON.stringify(l.details,null,2)}</pre></details>)}</section>:null}
  </>:null}
 </details>;
}

function CashForm({title,fields,disabled,button,onSubmit,onDirty}:{title:string;fields:Field[];disabled:boolean;button:string;onSubmit:(body:Record<string,unknown>)=>Promise<unknown>;onDirty:()=>void}){
 const [error,setError]=useState('');
 function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const data=new FormData(e.currentTarget),body:Record<string,unknown>={};
  for(const f of fields){const raw=data.get(f.name);if(f.optional&&!raw)continue;if(f.type==='checkbox')body[f.name]=raw==='on';else if(f.type==='number')body[f.name]=Number(raw);else if(f.type==='datetime-local')body[f.name]=new Date(`${String(raw)}+09:00`).toISOString();else body[f.name]=raw;}
  // The selected option carries the item version from the last read, not a new request.
  if(body.itemId){const option=fields.find(f=>f.name==='itemId')?.options?.find(o=>o.value===body.itemId);body.itemLockVersion=Number(option?.label.match(/版(\d+)$/)?.[1]);}
  const element=e.currentTarget;
  setError('');void onSubmit(body).then(saved=>{if(saved===true)element.reset();}).catch(e=>setError(message(e)));
 }
 return <details className={styles.formPanel}><summary>{title}</summary><form onSubmit={submit} onChange={onDirty}><fieldset disabled={disabled} className={styles.grid}><legend>{title}</legend>{fields.map(f=><label key={f.name} className={f.type==='checkbox'?styles.check:undefined}>{f.label}{f.optional?'（任意）':''}{f.options?<select aria-label={f.label} name={f.name} required={!f.optional} defaultValue=""><option value="">選択してください</option>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:f.type==='textarea'?<textarea aria-label={f.label} name={f.name} required={!f.optional} maxLength={1000}/>:<input aria-label={f.label} name={f.name} type={f.type??'text'} required={!f.optional} min={f.type==='number'?0:undefined} step={f.type==='number'?1:undefined} maxLength={f.type?undefined:1000}/>}</label>)}<button>{button}</button></fieldset>{error?<p role="alert">{error}</p>:null}</form></details>;
}
