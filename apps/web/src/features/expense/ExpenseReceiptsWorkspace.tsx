"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import Image from "next/image";
import {ApiClientError,apiClient} from "@/lib/api/client";
import {sha256Blob} from "@/lib/files/sha256";
import {receiptResources,type ReceiptDto,type ReceiptImageDto,type ReceiptListDto,type ReceiptOptions,type ReceiptReviewFields} from "@/lib/api/expense-receipts";
import styles from "./ExpenseExperience.module.css";

const labels:Record<string,string>={uploading:"画像の取込待ち",uploaded:"読み取り待ち",reading:"読み取り中",review_required:"内容を確認",failed:"読取失敗・手入力可能",registered:"明細へ登録済み",excluded:"登録対象外",deleting:"保存期限による削除中",deleted:"証憑保存期間終了"};
type Pending={key:string;operation:string;dayId:string;startedAt:number};
type UploadItem={file:File;startKey:string;completeKey:string;groupKey:string;imageId?:string;receiptId?:string;done:boolean};
const message=(error:unknown)=>error instanceof Error?error.message:"処理を確認できませんでした";

export function ExpenseReceiptsWorkspace({dayId,viewerId,editable,onChanged,onDraftChange}:{dayId:string;viewerId:string;editable:boolean;onChanged:()=>Promise<void>;onDraftChange:(id:string,dirty:boolean)=>void}){
  const [options,setOptions]=useState<ReceiptOptions|null>(null),[data,setData]=useState<ReceiptListDto>({receipts:[],images:[]});
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[pending,setPending]=useState<Pending|null>(null);
  const [selected,setSelected]=useState<string[]>([]),[queue,setQueue]=useState<UploadItem[]>([]),[canRetry,setCanRetry]=useState(false);
  const [groupTogether,setGroupTogether]=useState(false),[duplicateAcknowledged,setDuplicateAcknowledged]=useState(false);
  const [excludeReasons,setExcludeReasons]=useState<Record<string,string>>({});
  const groupKey=useRef(crypto.randomUUID());
  const alive=useRef(true),requestVersion=useRef(0),busyRef=useRef(false),retryRef=useRef<null|(()=>Promise<unknown>)>(null);
  const upload=useRef<{batchKey:string;batchId?:string;items:UploadItem[]}>({batchKey:crypto.randomUUID(),items:[]});
  const pendingName=`hanamaru:receipt:pending:${viewerId}:${dayId}`;
  const refresh=useCallback(async()=>{const request=++requestVersion.current;const next=await receiptResources.list(dayId);if(alive.current&&request===requestVersion.current)setData(next);},[dayId]);
  useEffect(()=>{
    alive.current=true;let cancelled=false;
    void receiptResources.options().then(value=>{if(!cancelled)setOptions(value);}).catch(e=>{if(!cancelled)setError(message(e));});
    void refresh().catch(e=>{if(!cancelled)setError(message(e));});
    void Promise.resolve().then(()=>{if(cancelled)return;try{const raw=JSON.parse(sessionStorage.getItem(pendingName)??"null") as Pending|null;if(raw&&raw.dayId===dayId&&/^[0-9a-f-]{36}$/i.test(raw.key)&&typeof raw.operation==="string"&&Number.isFinite(raw.startedAt))setPending(raw);}catch{setError("前回の保存結果を確認できません。履歴を確認してください");}});
    return()=>{cancelled=true;alive.current=false;};
  },[dayId,pendingName,refresh]);
  useEffect(()=>{
    if(!data.receipts.some(row=>row.status==="reading"))return;
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{await refresh();}catch(e){if(!stopped)setError(message(e));}if(!stopped)timer=setTimeout(()=>void poll(),document.hidden?10_000:2_000);};
    timer=setTimeout(()=>void poll(),document.hidden?10_000:2_000);return()=>{stopped=true;clearTimeout(timer);};
  },[data.receipts,refresh]);
  useEffect(()=>{onDraftChange(`receipt-files:${dayId}`,queue.some(item=>!item.done));return()=>onDraftChange(`receipt-files:${dayId}`,false);},[dayId,queue,onDraftChange]);
  useEffect(()=>{onDraftChange(`receipt-exclude:${dayId}`,Object.values(excludeReasons).some(reason=>Boolean(reason.trim())));return()=>onDraftChange(`receipt-exclude:${dayId}`,false);},[dayId,excludeReasons,onDraftChange]);

  const command=useCallback(async<T,>(operation:string,path:string,body:unknown,key:string=crypto.randomUUID(),method="POST"):Promise<T>=>{
    if(!alive.current)throw new Error("画面を離れたため後続の保存を停止しました。保存済みの処理は保持しています。");
    const record={key,operation,dayId,startedAt:Date.now()};
    sessionStorage.setItem(pendingName,JSON.stringify(record));setPending(record);
    const send=async()=>{
      try{
        const result=await receiptResources.command<T>(path,body,key,method);
        sessionStorage.removeItem(pendingName);if(alive.current){setPending(null);setCanRetry(false);}retryRef.current=null;return result;
      }catch(e){
        if(e instanceof ApiClientError&&e.status>=400&&e.status<500&&e.code!=="IDEMPOTENCY_CONFLICT"){
          sessionStorage.removeItem(pendingName);if(alive.current){setPending(null);setCanRetry(false);}retryRef.current=null;
        }
        throw e;
      }
    };
    retryRef.current=send;setCanRetry(true);return send();
  },[dayId,pendingName]);
  async function run(work:()=>Promise<void>){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError("");setNotice("");
    try{await work();}catch(e){setError(message(e));}finally{busyRef.current=false;if(alive.current)setBusy(false);}
  }
  async function refreshSaved(){try{await refresh();}catch(e){setNotice("保存は完了しましたが、表示の再取得に失敗しました。処理状況を再取得してください。");throw e;}}
  async function notifyChanged(){if(alive.current)await onChanged();}
  async function recover(){
    if(!pending)return;
    const result=await receiptResources.result(pending.key,pending.operation);
    if(result.status!=="succeeded"){
      setNotice("保存結果は不明です。新しい操作で自動登録しません。この画面内であれば同じ内容の再試行ができます。48時間経過や再読込後は記録・証憑の確認が必要です。");return;
    }
    sessionStorage.removeItem(pendingName);setPending(null);setCanRetry(false);retryRef.current=null;await refreshSaved();await notifyChanged();setNotice("前回の操作は保存済みでした。保存処理は再実行していません。");
  }
  function selectFiles(list:FileList|null){
    if(!list||!options)return;
    const accepted=Array.from(list),current=upload.current.items;
    if(groupTogether&&current.filter(item=>item.groupKey===groupKey.current).length+accepted.length>5){setError("同じ1件の領収書は5画像までです。別の領収書は分けて選択してください。");return;}
    if(current.length+accepted.length>options.limits.imageCount||accepted.some(file=>file.size>options.limits.imageBytes||!options.mimeTypes.includes(file.type))||[...current.map(item=>item.file),...accepted].reduce((sum,file)=>sum+file.size,0)>options.limits.totalImageBytes){setError("JPEG・PNG・WebP、1枚10MB・20枚・合計100MBまでです。HEICはJPEGに変換してください。");return;}
    current.push(...accepted.map(file=>({file,startKey:crypto.randomUUID(),completeKey:crypto.randomUUID(),groupKey:groupTogether?groupKey.current:crypto.randomUUID(),done:false})));setQueue(current.map(item=>({...item})));
  }
  async function uploadSelected(){
    const batch=upload.current;if(!batch.items.length)return;
    if(!batch.batchId)batch.batchId=(await command<{id:string}>("expense.receipt.batch.create",`/expense-days/${dayId}/receipt-batches`,{},batch.batchKey)).id;
    for(const item of batch.items){
      if(!alive.current)throw new Error("画面を離れたため画像の追加送信を停止しました。");
      if(item.done)continue;
      if(!item.imageId){const existing=batch.items.find(other=>other.groupKey===item.groupKey&&other.receiptId)?.receiptId;const declared=await command<{id:string;receiptId:string}>("expense.receipt.image.create",`/expense-receipt-batches/${batch.batchId}/images`,{mimeType:item.file.type,sizeBytes:item.file.size,sha256:await sha256Blob(item.file),...(existing?{receiptId:existing}:{})},item.startKey);item.imageId=declared.id;item.receiptId=declared.receiptId;}
      const signed=await receiptResources.uploadAccess(item.imageId),url=apiClient.resolveUrl(signed.url);
      if(!alive.current)throw new Error("画面を離れたため画像の追加送信を停止しました。");
      const response=await fetch(url,{method:"PUT",headers:await apiClient.uploadHeadersFor(url,signed.headers),credentials:apiClient.uploadCredentialsFor(url),body:item.file});
      // GCS write-once precondition may mean a prior attempt succeeded. Verification below decides.
      if(!response.ok&&response.status!==412)throw new Error("画像を送信できませんでした。同じ画像の取込を再開してください");
      await command("expense.receipt.image.complete",`/expense-receipt-images/${item.imageId}/complete`,{},item.completeKey);item.done=true;setQueue(batch.items.map(value=>({...value})));
      await refreshSaved();
    }
    setNotice("画像を取り込みました。AI読取を確認してから読み取りを開始してください。");
  }
  async function resumeImage(image:ReceiptImageDto,file:File){
    if(file.type!==image.mimeType||file.size!==Number(image.sizeBytes)||await sha256Blob(file)!==image.contentSha256)throw new Error("前回と同じ画像を選択してください。画像の内容は変更できません。");
    await command("expense.receipt.image.renew",`/expense-receipt-images/${image.id}/renew`,{});
    const signed=await receiptResources.uploadAccess(image.id),url=apiClient.resolveUrl(signed.url);
    if(!alive.current)throw new Error("画面を離れたため画像送信を停止しました。");
    const response=await fetch(url,{method:"PUT",headers:await apiClient.uploadHeadersFor(url,signed.headers),credentials:apiClient.uploadCredentialsFor(url),body:file});
    if(!response.ok&&response.status!==412)throw new Error("画像の再送信を確認できません。同じ画像を選んで再開してください。");
    await command("expense.receipt.image.complete",`/expense-receipt-images/${image.id}/complete`,{});await refreshSaved();
    setNotice("未完了画像の取込を再開しました。成功済みの画像は保持しています。");
  }
  const locked=busy||pending!==null;
  return <section className={styles.card} aria-label="領収書一括取込">
    <h2>領収書から支出を記録</h2><p>画像 → AIの読取候補 → 人が金額・支払元を確認 → 明細へ登録。読み取り中や未確認の候補は合計に入りません。</p>
    <button type="button" disabled={busy} onClick={()=>void run(refresh)}>処理状況を再取得</button>
    {error?<p className={styles.error} role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
    {pending?<div className={styles.row}><p>前回の操作結果を確認してください。入力本文・画像・金額はブラウザに永続保存していません。</p><button type="button" disabled={busy} onClick={()=>void run(recover)}>保存結果を確認</button>{canRetry?<button type="button" disabled={busy} onClick={()=>void run(async()=>{await retryRef.current!();await refreshSaved();await notifyChanged();})}>同じ操作を再試行</button>:null}</div>:null}
    {options&&!options.enabled?<p>領収書の保存・AI読取方針は承認待ちです。下の手入力は利用できます。</p>:null}
    {options?.enabled&&editable?<>
      <p>原画像と読取用画像を非公開で保存します。保存期間：{options.retentionDays}日。AI読取はGoogle Cloudへ画像を送信します。法令対応済み・紙原本廃棄可能という意味ではありません。</p>
      <label><input type="checkbox" checked={groupTogether} disabled={locked} onChange={e=>{setGroupTogether(e.target.checked);groupKey.current=crypto.randomUUID();}}/> これから選ぶ画像を同じ1件の領収書としてまとめる（最大5枚・金額は足し合わせません）</label>
      <div className={styles.row}><label>領収書を撮影<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={locked} onChange={e=>{selectFiles(e.target.files);e.target.value="";}}/></label><label>写真・ファイルを複数選択<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={locked} onChange={e=>{selectFiles(e.target.files);e.target.value="";}}/></label></div>
      <ul>{queue.map((item,index)=><li key={item.startKey}>{item.file.name}：{item.done?"取込済み":"未取込"}{!item.imageId&&!item.done?<button type="button" className={styles.secondaryButton} disabled={locked} onClick={()=>{upload.current.items.splice(index,1);setQueue(upload.current.items.map(value=>({...value})));}}>取り消す</button>:null}</li>)}</ul>
      <div className={styles.row}><button type="button" disabled={locked||!queue.some(item=>!item.done)} onClick={()=>void run(uploadSelected)}>画像の取込を開始・再開</button></div>
      <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Google CloudのAIで領収書を読み取り、人が確定内容を確認することを理解しました</label>
    </>:null}
    {data.receipts.map(receipt=><article className={styles.item} key={receipt.id}><div className={styles.itemBody}>
      <h3>{labels[receipt.status]??receipt.status}</h3><p>画像 {data.images.filter(image=>image.receiptId===receipt.id).length}枚 ／ 保存期限 {new Date(receipt.expiresAt).toLocaleDateString("ja-JP")}</p>
      {editable&&receipt.status==="uploading"?<div className={styles.row}>{data.images.filter(image=>image.receiptId===receipt.id&&!image.completedAt).map((image,index)=><label key={image.id}>未取込画像{index+1}を選び直して再開<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void run(()=>resumeImage(image,file));}}/></label>)}</div>:null}
      {receipt.status==="reading"?<p role="status">画面を離れてもサーバーで処理します。数値の仮進捗は表示しません。</p>:null}
      {editable&&["uploaded","failed"].includes(receipt.status)?<div className={styles.row}><button type="button" disabled={locked||!consent} onClick={()=>void run(async()=>{await command("expense.receipt.analyze",`/expense-receipts/${receipt.id}/analyze`,{expectedLockVersion:receipt.lockVersion,aiConsent:true});await refreshSaved();})}>この領収書を読み取る・再試行</button></div>:null}
      {["review_required","failed","registered"].includes(receipt.status)?<ReceiptEditor receipt={receipt} imageIds={data.images.filter(image=>image.receiptId===receipt.id).map(image=>image.id)} editable={editable&&receipt.status!=="registered"} busy={locked} selected={selected.includes(receipt.id)} onSelect={value=>setSelected(current=>value?[...new Set([...current,receipt.id])]:current.filter(id=>id!==receipt.id))} onDraftChange={onDraftChange} onSave={fields=>run(async()=>{await command("expense.receipt.review",`/expense-receipts/${receipt.id}/review`,{expectedLockVersion:receipt.lockVersion,fields},undefined,"PATCH");await refreshSaved();})}/>:null}
      {receipt.status==="registered"?<p>確認した値を経費明細へ登録済み。証憑の承認・支店締めとは別です。</p>:null}
      {editable&&["uploading","uploaded","review_required","failed"].includes(receipt.status)?<form className={styles.row} onSubmit={e=>{e.preventDefault();void run(async()=>{await command("expense.receipt.exclude",`/expense-receipts/${receipt.id}/exclude`,{expectedLockVersion:receipt.lockVersion,reason:excludeReasons[receipt.id]??""});setSelected(current=>current.filter(id=>id!==receipt.id));setExcludeReasons(current=>({...current,[receipt.id]:""}));await refreshSaved();});}}><label>この領収書を登録対象外にする理由<input maxLength={500} value={excludeReasons[receipt.id]??""} onChange={e=>setExcludeReasons(current=>({...current,[receipt.id]:e.target.value}))} disabled={locked} required/></label><button type="submit" disabled={locked}>登録対象外にする</button></form>:null}
    </div></article>)}
    {editable&&selected.length?<div className={styles.row}><label><input type="checkbox" checked={duplicateAcknowledged} onChange={e=>setDuplicateAcknowledged(e.target.checked)} disabled={locked}/> 同日・同額・同じ支払先の明細がある場合、選択分は別の支出であることを確認した</label><button type="button" disabled={locked} onClick={()=>void run(async()=>{
      for(const id of selected){const receipt=data.receipts.find(row=>row.id===id);if(!receipt?.reviewJson)throw new Error("選択した領収書の確認内容を先に保存してください");await command("expense.receipt.register",`/expense-receipts/${id}/register`,{expectedLockVersion:receipt.lockVersion,fields:receipt.reviewJson,reviewed:true,duplicateAcknowledged});setSelected(current=>current.filter(value=>value!==id));}
      await refreshSaved();await notifyChanged();setNotice("選択した明細を登録しました。未確認分は合計に入れていません。");
    })}>確認済みの選択分を明細へ登録（{selected.length}件）</button></div>:null}
  </section>;
}

function ReceiptEditor({receipt,imageIds,editable,busy,selected,onSelect,onSave,onDraftChange}:{receipt:ReceiptDto;imageIds:string[];editable:boolean;busy:boolean;selected:boolean;onSelect:(value:boolean)=>void;onSave:(fields:ReceiptReviewFields)=>Promise<void>;onDraftChange:(id:string,dirty:boolean)=>void}){
  const reading=receipt.readingJson;
  const initial:ReceiptReviewFields=receipt.reviewJson??{paidOn:reading?.paidOn?.value??null,merchant:reading?.merchant?.value??null,amount:reading?.currency?.value==="JPY"&&/^\d+$/.test(reading?.paidTotal?.value??"")?Number(reading!.paidTotal.value):null,currency:reading?.currency?.value??null,category:null,paymentSource:null,note:null};
  const [fields,setFields]=useState(initial),[image,setImage]=useState<string|null>(null),[error,setError]=useState("");
  const dirty=(Object.keys(initial) as Array<keyof ReceiptReviewFields>).some(key=>fields[key]!==initial[key]);
  useEffect(()=>{onDraftChange(receipt.id,dirty);return()=>onDraftChange(receipt.id,false);},[dirty,onDraftChange,receipt.id]);
  useEffect(()=>()=>{if(image)URL.revokeObjectURL(image);},[image]);
  const update=(name:keyof ReceiptReviewFields,value:string)=>setFields(current=>({...current,[name]:name==="amount"?(value===""?null:Number(value)):value||null}));
  return <><div className={styles.row}>{imageIds.map((id,index)=><button type="button" key={id} onClick={()=>void receiptResources.image(id).then(blob=>setImage(URL.createObjectURL(blob))).catch(e=>setError(message(e)))}>画像{index+1}を見る</button>)}</div>
    {reading?.model.startsWith("test-")?<p>ローカル試験用fixtureです。実OCRではありません。値を生成せず、手入力で確認する経路を検証します。</p>:null}
    {image?<Image src={image} alt="選択した領収書の原画像" unoptimized width={640} height={420} style={{maxWidth:"100%",height:"auto",maxHeight:420,objectFit:"contain"}}/>:null}
    {error?<p role="alert">{error}</p>:null}
    {reading?.documentKind!=="single_receipt"?<p>1画像に複数の領収書がある場合は再撮影してください。読取不能な値は手入力で確認してください。</p>:null}
    <form className={styles.row} onSubmit={e=>{e.preventDefault();void onSave(fields);}}>
      <label>支払日<input type="date" value={fields.paidOn??""} onChange={e=>update("paidOn",e.target.value)} disabled={!editable||busy}/></label>
      <label>支払先<input value={fields.merchant??""} maxLength={200} onChange={e=>update("merchant",e.target.value)} disabled={!editable||busy}/></label>
      <label>実際の支払総額（円）<input type="number" min="1" value={fields.amount??""} onChange={e=>update("amount",e.target.value)} disabled={!editable||busy}/></label>
      <label>通貨<select value={fields.currency??""} onChange={e=>update("currency",e.target.value)} disabled={!editable||busy}><option value="">要確認</option><option value="JPY">JPY・日本円</option></select></label>
      <label>費目<select value={fields.category??""} onChange={e=>update("category",e.target.value)} disabled={!editable||busy}><option value="">要確認</option>{["駐車場","燃料","高速道路","車両整備","その他・確認待ち"].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>支払元（AIでは確定しません）<select value={fields.paymentSource??""} onChange={e=>update("paymentSource",e.target.value)} disabled={!editable||busy}><option value="">選択してください</option><option value="company_wallet">会社の財布</option><option value="personal">個人立替</option></select></label>
      <label>用途・補足<input value={fields.note??""} maxLength={1000} onChange={e=>update("note",e.target.value)} disabled={!editable||busy}/></label>
      {editable?<button type="submit" disabled={busy}>確認内容を下書き保存</button>:null}
    </form>
    {reading?<details><summary>AIの読取候補・印字根拠（確定値とは別）</summary><dl>{([['支払日',reading.paidOn],['支払先',reading.merchant],['支払総額',reading.paidTotal],['通貨',reading.currency],['用途の手掛かり',reading.purposeHint]] as const).map(([label,field])=><div key={label}><dt>{label}</dt><dd>{field?.value??"読取不能"} ／ 根拠：{field?.evidence??"なし"}</dd></div>)}</dl></details>:null}
    {editable?<label><input type="checkbox" checked={selected} disabled={busy||dirty||!receipt.reviewJson||reading?.documentKind==="multiple_receipts"} onChange={e=>onSelect(e.target.checked)}/> 画像と保存した内容を確認し、明細への登録対象にする</label>:null}
  </>;
}
