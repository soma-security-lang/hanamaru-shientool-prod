"use client";

import {useEffect,useRef,useState} from "react";
import {resources,type ConsultationManagerDto,type ProductConsultationDto,type ProductOfferDto,type ProductOfferResponseDto,type VisitProductDto} from "@/lib/api/resources";
import styles from "./VisitProducts.module.css";

const empty={productName:"",quantity:"1",conditionNote:"",accessoriesNote:""};
const consultationStatus:Record<ProductConsultationDto["status"],string>={pending:"回答待ち",approved:"承認",conditional:"条件付き承認",returned:"差戻し",cancelled:"取消"};

function ProductConsultations({visitId,product,onChanged}:{visitId:string;product:VisitProductDto;onChanged:()=>Promise<void>}){
  const [items,setItems]=useState<ProductConsultationDto[]>([]);
  const [managers,setManagers]=useState<ConsultationManagerDto[]>([]);
  const [managerId,setManagerId]=useState("");
  const [proposedPrice,setProposedPrice]=useState("");
  const [reason,setReason]=useState("");
  const [dueAt,setDueAt]=useState("");
  const [responseNote,setResponseNote]=useState("");
  const [approvedPrice,setApprovedPrice]=useState("");
  const [nextManager,setNextManager]=useState("");
  const [reassignReason,setReassignReason]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function reload(){
    const [consultations,candidates]=await Promise.all([resources.productConsultations(visitId,product.id),resources.consultationManagers(visitId)]);
    setItems(consultations.items);setManagers(candidates.items);
  }
  useEffect(()=>{let live=true;void Promise.all([resources.productConsultations(visitId,product.id),resources.consultationManagers(visitId)])
    .then(([consultations,candidates])=>{if(live){setItems(consultations.items);setManagers(candidates.items);}})
    .catch(()=>{if(live)setError("相談履歴を読み込めませんでした。再読込してください。")})
    .finally(()=>{if(live)setLoading(false)});return()=>{live=false};},[visitId,product.id]);
  async function submitRequest(event:React.FormEvent){
    event.preventDefault();const price=Number(proposedPrice);
    const due=dueAt?new Date(dueAt):null;
    if(!managerId||!Number.isSafeInteger(price)||price<0||!reason.trim()||(due&&(!Number.isFinite(due.getTime())||due.getTime()<=Date.now()))){setError("相談先、提示案、相談理由、回答期限を確認してください。");return;}
    setBusy(true);setError("");
    try{await resources.createProductConsultation(visitId,product.id,{assignedManagerId:managerId,proposedPriceYen:price,reason:reason.trim(),dueAt:due?.toISOString()??null});await reload();await onChanged();setReason("");setProposedPrice("");setDueAt("");}
    catch{setError("相談を登録できませんでした。履歴を再読込し、二重登録がないことを確認してください。");await reload().catch(()=>undefined)}
    finally{setBusy(false)}
  }
  async function decide(item:ProductConsultationDto,decision:"approved"|"conditional"|"returned"){
    const price=Number(approvedPrice);if(decision!=="returned"&&(!Number.isSafeInteger(price)||price<0)){setError("承認額を確認してください。");return;}
    if(decision!=="approved"&&!responseNote.trim()){setError("条件または差戻し理由を入力してください。");return;}
    setBusy(true);setError("");
    try{await resources.decideProductConsultation(visitId,product.id,item.id,{decision,approvedPriceYen:decision==="returned"?null:price,responseNote:responseNote.trim()||null,expectedLockVersion:item.lockVersion});await reload();await onChanged();setResponseNote("");setApprovedPrice("");}
    catch{setError("回答を保存できませんでした。担当と版を再確認してください。");await reload().catch(()=>undefined)}
    finally{setBusy(false)}
  }
  async function reassign(item:ProductConsultationDto){
    if(!nextManager||!reassignReason.trim()){setError("代理の上長と変更理由を入力してください。");return;}
    setBusy(true);setError("");
    try{await resources.reassignProductConsultation(visitId,product.id,item.id,{nextManagerId:nextManager,reason:reassignReason.trim(),expectedLockVersion:item.lockVersion});await reload();setNextManager("");setReassignReason("");}
    catch{setError("担当変更ができませんでした。権限と最新状態を確認してください。");await reload().catch(()=>undefined)}
    finally{setBusy(false)}
  }
  return <section className={styles.consultations} aria-label={`${product.productName}の上長相談`}>
    <div className={styles.header}><h3>上長相談</h3><button type="button" className={styles.secondary} onClick={()=>void reload().catch(()=>setError("再読込できませんでした。"))}>相談を再読込</button></div>
    {loading?<p role="status">相談履歴を読み込んでいます。</p>:null}{error?<p className={styles.error} role="alert">{error}</p>:null}
    {items.map(item=><div key={item.id} className={styles.consultationItem}>
      <p><strong>{consultationStatus[item.status]}</strong> · 相談先: {item.managerName??item.assignedManagerId} · 提示案: {item.proposedPriceYen.toLocaleString()}円</p>
      {item.dueAt?<p>回答期限: {new Date(item.dueAt).toLocaleString("ja-JP")}{item.overdue?"（期限超過・未承認）":""}</p>:null}
      <p>相談理由: {item.requestReason}</p>
      {item.responseNote?<p>回答: {item.responseNote}</p>:null}{item.approvedPriceYen!==null?<p>承認額: {item.approvedPriceYen.toLocaleString()}円</p>:null}
      {item.status==="pending"?<div className={styles.consultationActions}>
        <p>回答は指定された上長のみ、代理変更は権限のある上長のみ実行できます。</p>
        <label>承認額（円）<input type="number" min={0} step={1} value={approvedPrice} onChange={event=>setApprovedPrice(event.target.value)}/></label>
        <label>回答・条件・差戻し理由<textarea maxLength={1000} value={responseNote} onChange={event=>setResponseNote(event.target.value)}/></label>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={()=>void decide(item,"approved")}>承認</button><button type="button" className={styles.secondary} disabled={busy} onClick={()=>void decide(item,"conditional")}>条件付き承認</button><button type="button" className={styles.secondary} disabled={busy} onClick={()=>void decide(item,"returned")}>差戻し</button></div>
        <label>代理の上長<select value={nextManager} onChange={event=>setNextManager(event.target.value)}><option value="">選択してください</option>{managers.filter(manager=>manager.id!==item.assignedManagerId).map(manager=><option key={manager.id} value={manager.id}>{manager.displayName}</option>)}</select></label>
        <label>代理変更の理由<textarea maxLength={1000} value={reassignReason} onChange={event=>setReassignReason(event.target.value)}/></label>
        <button type="button" className={styles.secondary} disabled={busy} onClick={()=>void reassign(item)}>代理へ引き継ぐ</button>
      </div>:null}
    </div>)}
    {!loading&&items.length===0?<p>相談履歴はありません。</p>:null}
    {product.status==="draft"?<form className={styles.consultationActions} onSubmit={event=>void submitRequest(event)}>
      <h4>商品別に相談する</h4>
      <label>相談先の上長<select required value={managerId} onChange={event=>setManagerId(event.target.value)}><option value="">選択してください</option>{managers.map(manager=><option key={manager.id} value={manager.id}>{manager.displayName}</option>)}</select></label>
      <label>顧客への提示案（円）<input required type="number" min={0} step={1} value={proposedPrice} onChange={event=>setProposedPrice(event.target.value)}/></label>
      <label>判断が必要な理由<textarea required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <label>回答期限（任意）<input type="datetime-local" value={dueAt} onChange={event=>setDueAt(event.target.value)}/></label>
      <button type="submit" className={styles.primary} disabled={busy||managers.length===0}>相談を送る</button>
      {managers.length===0?<p>相談できる上長がいません。所属・権限を管理者に確認してください。</p>:null}
    </form>:null}
  </section>;
}

const responseLabels:Record<ProductOfferResponseDto["response"],string>={pending:"回答待ち",accepted:"承諾",declined:"辞退",counteroffer:"再提案の希望"};
function ProductOffers({visitId,product}:{visitId:string;product:VisitProductDto}){
  const [offers,setOffers]=useState<ProductOfferDto[]>([]);
  const [price,setPrice]=useState("");
  const [terms,setTerms]=useState("");
  const [expiresAt,setExpiresAt]=useState("");
  const [response,setResponse]=useState<ProductOfferResponseDto["response"]>("pending");
  const [responseNote,setResponseNote]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const pending=useRef<{body:string;key:string}|null>(null);
  async function reload(){const result=await resources.productOffers(visitId,product.id);setOffers(result.items);}
  useEffect(()=>{let live=true;void resources.productOffers(visitId,product.id)
    .then(result=>{if(live)setOffers(result.items);})
    .catch(()=>{if(live)setError("提示履歴を読み込めませんでした。再読込してください。");})
    .finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[visitId,product.id]);
  async function present(event:React.FormEvent){
    event.preventDefault();const amount=Number(price);
    const expiry=expiresAt?new Date(expiresAt):null;
    if(!Number.isSafeInteger(amount)||amount<0||!terms.trim()||(expiry&&!Number.isFinite(expiry.getTime()))){setError("提示額、条件、有効期限を確認してください。");return;}
    const body={priceYen:amount,terms:terms.trim(),expiresAt:expiry?.toISOString()??null,expectedVersion:offers[0]?.version??0};
    const fingerprint=JSON.stringify(body);if(pending.current?.body!==fingerprint)pending.current={body:fingerprint,key:crypto.randomUUID()};
    setBusy(true);setError("");
    try{await resources.createProductOffer(visitId,product.id,body,pending.current.key);await reload();setPrice("");setTerms("");setExpiresAt("");pending.current=null;}
    catch{setError("提示を保存できませんでした。履歴を再読込し、二重登録がないことを確認してください。");await reload().catch(()=>undefined);}
    finally{setBusy(false);}
  }
  async function record(offer:ProductOfferDto){
    const body={response,note:responseNote.trim()||null,expectedResponseVersion:offer.responses.at(-1)?.version??0};
    const fingerprint=JSON.stringify({offerId:offer.id,...body});if(pending.current?.body!==fingerprint)pending.current={body:fingerprint,key:crypto.randomUUID()};
    setBusy(true);setError("");
    try{await resources.recordProductOfferResponse(visitId,product.id,offer.id,body,pending.current.key);await reload();setResponse("pending");setResponseNote("");pending.current=null;}
    catch{setError("回答を保存できませんでした。履歴を再読込してから確認してください。");await reload().catch(()=>undefined);}
    finally{setBusy(false);}
  }
  return <section className={styles.consultations} aria-label={`${product.productName}の顧客提示履歴`}>
    <div className={styles.header}><h3>顧客への提示と回答</h3><button type="button" className={styles.secondary} onClick={()=>void reload().catch(()=>setError("再読込できませんでした。"))}>提示履歴を再読込</button></div>
    {loading?<p role="status">提示履歴を読み込んでいます。</p>:null}{error?<p role="alert" className={styles.error}>{error}</p>:null}
    {offers.map((offer,index)=><article key={offer.id} className={styles.consultationItem}>
      <p><strong>提示 {offer.version}</strong> · {offer.priceYen.toLocaleString()}円 · {new Date(offer.presentedAt).toLocaleString("ja-JP")}</p>
      <p>条件: {offer.terms}</p>{offer.expiresAt?<p>有効期限: {new Date(offer.expiresAt).toLocaleString("ja-JP")}</p>:null}
      {offer.responses.length?offer.responses.map(answer=><p key={answer.id}>回答 {answer.version}: {responseLabels[answer.response]} · {new Date(answer.recordedAt).toLocaleString("ja-JP")}{answer.note?` · ${answer.note}`:""}</p>):<p>顧客回答は未記録です。</p>}
      {index===0?<div className={styles.consultationActions}>
        <label>顧客回答<select value={response} onChange={event=>setResponse(event.target.value as ProductOfferResponseDto["response"])}>{Object.entries(responseLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>回答メモ（個人情報は入力しない）<textarea maxLength={1000} value={responseNote} onChange={event=>setResponseNote(event.target.value)}/></label>
        <button type="button" className={styles.primary} disabled={busy} onClick={()=>void record(offer)}>回答を記録</button>
      </div>:null}
    </article>)}
    {!loading&&offers.length===0?<p>顧客への提示はまだありません。</p>:null}
    {product.status==="ready"?<form className={styles.form} onSubmit={event=>void present(event)}>
      <h4>新しい提示を記録</h4><p>以前の提示は残ります。上長の承認額を超える提示は保存できません。</p>
      <label>提示額（円）<input required type="number" min={0} step={1} value={price} onChange={event=>setPrice(event.target.value)}/></label>
      <label>条件（個人情報は入力しない）<textarea required maxLength={1000} value={terms} onChange={event=>setTerms(event.target.value)}/></label>
      <label>有効期限（任意）<input type="datetime-local" value={expiresAt} onChange={event=>setExpiresAt(event.target.value)}/></label>
      <button type="submit" className={styles.primary} disabled={busy}>{busy?"保存中…":"提示を記録"}</button>
    </form>:<p>上長の判断が完了すると提示を記録できます。</p>}
  </section>;
}

export function VisitProducts({visitId}:{visitId:string}){
  const [products,setProducts]=useState<VisitProductDto[]>([]);
  const [form,setForm]=useState(empty);
  const [editing,setEditing]=useState<VisitProductDto|null>(null);
  const [expandedProductId,setExpandedProductId]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const pendingOperation=useRef<{body:string;key:string}|null>(null);

  async function refresh(){
    const result=await resources.visitProducts(visitId);
    setProducts(result.items);
  }
  useEffect(()=>{
    let live=true;
    void resources.visitProducts(visitId).then(result=>{if(live){setProducts(result.items);setError("");}})
      .catch(()=>{if(live)setError("商品カードを読み込めませんでした。再読込してください。");})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[visitId]);
  function edit(product:VisitProductDto){
    pendingOperation.current=null;
    setEditing(product);
    setForm({productName:product.productName,quantity:String(product.quantity),conditionNote:product.conditionNote??"",accessoriesNote:product.accessoriesNote??""});
    setError("");
  }
  async function save(event:React.FormEvent){
    event.preventDefault();
    const quantity=Number(form.quantity);
    if(!form.productName.trim()||!Number.isInteger(quantity)||quantity<1||quantity>100000){setError("品名と数量を確認してください。");return;}
    setSaving(true);setError("");
    const input={productName:form.productName.trim(),quantity,conditionNote:form.conditionNote.trim()||null,accessoriesNote:form.accessoriesNote.trim()||null};
    const body=JSON.stringify({visitId,productId:editing?.id??null,expectedLockVersion:editing?.lockVersion??null,input});
    if(pendingOperation.current?.body!==body)pendingOperation.current={body,key:crypto.randomUUID()};
    const operationKey=pendingOperation.current.key;
    try{
      if(editing)await resources.updateVisitProduct(visitId,editing.id,{...input,expectedLockVersion:editing.lockVersion},operationKey);
      else await resources.createVisitProduct(visitId,input,operationKey);
      await refresh();setForm(empty);setEditing(null);pendingOperation.current=null;
    }catch{setError("保存できませんでした。商品情報を再読み込みし、内容を確認してください。新規登録を再送する前に一覧を確認してください。");await refresh().catch(()=>undefined);}
    finally{setSaving(false);}
  }
  return <section className={styles.section} aria-labelledby="visit-products-title">
    <div className={styles.header}><div><h2 id="visit-products-title">訪問する商品</h2><p>商品ごとに品名・数量・状態・付属品を記録します。PDFからの抽出値は原本と照合してから入力してください。</p></div><button type="button" className={styles.secondary} onClick={()=>void refresh().catch(()=>setError("再読込できませんでした。"))}>再読込</button></div>
    {loading?<p role="status">商品カードを読み込んでいます。</p>:null}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    <div className={styles.cards}>
      {products.map((product,index)=><article key={product.id} className={styles.card}>
        <div className={styles.cardHead}><strong>{index+1}. {product.productName}</strong><span>{product.quantity}点</span></div>
        <dl><div><dt>状態</dt><dd>{product.conditionNote??"未入力"}</dd></div><div><dt>付属品</dt><dd>{product.accessoriesNote??"未入力"}</dd></div></dl>
        <p>進行状態: {product.status==="draft"?"下書き":product.status==="research_pending"?"相談中":product.status==="ready"?"判断済み":product.status}</p>
        <div className={styles.actions}>{product.status==="draft"?<button type="button" className={styles.secondary} onClick={()=>edit(product)}>修正する</button>:null}<button type="button" className={styles.secondary} onClick={()=>setExpandedProductId(current=>current===product.id?null:product.id)} aria-expanded={expandedProductId===product.id}>相談・提示・回答</button></div>
        {expandedProductId===product.id?<><ProductConsultations visitId={visitId} product={product} onChanged={refresh}/><ProductOffers visitId={visitId} product={product}/></>:null}
      </article>)}
      {!loading&&products.length===0?<p className={styles.empty}>商品カードはありません。複数の商品を一件ずつ登録できます。</p>:null}
    </div>
    <form className={styles.form} onSubmit={event=>void save(event)}>
      <h3>{editing?"商品カードを修正":"商品カードを追加"}</h3>
      <label>商品名<input required maxLength={300} value={form.productName} onChange={event=>setForm(current=>({...current,productName:event.target.value}))}/></label>
      <label>数量<input required type="number" min={1} max={100000} value={form.quantity} onChange={event=>setForm(current=>({...current,quantity:event.target.value}))}/></label>
      <label>状態・傷など<textarea maxLength={1000} value={form.conditionNote} onChange={event=>setForm(current=>({...current,conditionNote:event.target.value}))}/></label>
      <label>付属品<textarea maxLength={1000} value={form.accessoriesNote} onChange={event=>setForm(current=>({...current,accessoriesNote:event.target.value}))}/></label>
      <div className={styles.actions}><button className={styles.primary} type="submit" disabled={saving}>{saving?"保存中…":editing?"修正を保存":"商品を追加"}</button>{editing?<button type="button" className={styles.secondary} onClick={()=>{setEditing(null);setForm(empty);pendingOperation.current=null;}}>修正をやめる</button>:null}</div>
    </form>
  </section>;
}
