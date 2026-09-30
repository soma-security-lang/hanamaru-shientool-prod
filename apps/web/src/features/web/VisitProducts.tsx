"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {resources,type ConsultationManagerDto,type MarketPriceSearchDto,type ProductConsultationDto,type ProductOfferDto,type ProductOfferResponseDto,type ProductReceiptCheckDto,type VisitProductDto} from "@/lib/api/resources";
import styles from "./VisitProducts.module.css";

const empty={productName:"",quantity:"1",conditionNote:"",accessoriesNote:""};
const consultationStatus:Record<ProductConsultationDto["status"],string>={pending:"回答待ち",approved:"承認",conditional:"条件付き承認",returned:"差戻し",cancelled:"取消"};
const researchHoldLabels={no_candidates:"相場候補なし",ambiguous:"候補が曖昧",search_failed:"検索失敗"} as const;

async function loadConsultationData(visitId:string,productId:string){
  const [history,candidates]=await Promise.allSettled([resources.productConsultations(visitId,productId),resources.consultationManagers(visitId)]);
  if(history.status==="rejected")throw history.reason;
  return {items:history.value.items,managers:candidates.status==="fulfilled"?candidates.value.items:[],managerLoadError:candidates.status==="rejected"};
}

function ProductResearchHold({visitId,product,onChanged}:{visitId:string;product:VisitProductDto;onChanged:()=>Promise<void>}){
  const [category,setCategory]=useState<keyof typeof researchHoldLabels>("no_candidates");
  const [reason,setReason]=useState("");
  const [resolution,setResolution]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function hold(event:React.FormEvent){
    event.preventDefault();if(!reason.trim()){setError("調査が必要な理由を入力してください。");return;}
    setBusy(true);setError("");
    try{await resources.holdVisitProduct(visitId,product.id,{category,reason:reason.trim(),expectedLockVersion:product.lockVersion});await onChanged();setReason("");}
    catch{setError("保留を保存できませんでした。商品カードを再読込し、登録済みか確認してください。");await onChanged().catch(()=>undefined);}
    finally{setBusy(false);}
  }
  async function resume(event:React.FormEvent){
    event.preventDefault();if(!resolution.trim()){setError("調査結果を入力してください。");return;}
    setBusy(true);setError("");
    try{await resources.resumeVisitProductResearch(visitId,product.id,{resolutionNote:resolution.trim(),expectedLockVersion:product.lockVersion});await onChanged();setResolution("");}
    catch{setError("調査再開を保存できませんでした。担当と最新状態を確認してください。");await onChanged().catch(()=>undefined);}
    finally{setBusy(false);}
  }
  return <section className={styles.consultationItem} aria-label={`${product.productName}の相場調査`}>
    {product.researchHoldCategory?<p>相場調査: {researchHoldLabels[product.researchHoldCategory]} · 担当: {product.researchHoldAssigneeName??product.researchHoldAssigneeId??"未表示"}</p>:null}
    {product.researchHoldReason?<p>保留理由: {product.researchHoldReason}</p>:null}
    {product.researchHoldResolvedAt?<p>調査結果: {product.researchHoldResolutionNote??"記録なし"}</p>:null}
    {product.status==="draft"?<form className={styles.consultationActions} onSubmit={event=>void hold(event)}>
      <h4>相場調査を保留する</h4><p>候補が不足・曖昧・検索失敗の場合、推測で確定せず自分の担当として残します。上長判断が必要なら下の相談を利用してください。</p>
      <label>保留区分<select value={category} onChange={event=>setCategory(event.target.value as keyof typeof researchHoldLabels)}><option value="no_candidates">相場候補なし</option><option value="ambiguous">候補が曖昧</option><option value="search_failed">検索失敗</option></select></label>
      <label>調査が必要な理由<textarea required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <button type="submit" className={styles.secondary} disabled={busy}>自分の担当で保留する</button>
    </form>:null}
    {product.status==="research_hold"?<form className={styles.consultationActions} onSubmit={event=>void resume(event)}>
      <p>保留中は上長相談や顧客提示へ進めません。担当者または権限のある上長が調査結果を記録して再開します。</p>
      <label>調査結果<textarea required maxLength={1000} value={resolution} onChange={event=>setResolution(event.target.value)}/></label>
      <button type="submit" className={styles.secondary} disabled={busy}>結果を記録して再開</button>
    </form>:null}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
  </section>;
}

function ProductConsultations({visitId,product,onChanged}:{visitId:string;product:VisitProductDto;onChanged:()=>Promise<void>}){
  const [items,setItems]=useState<ProductConsultationDto[]>([]);
  const [managers,setManagers]=useState<ConsultationManagerDto[]>([]);
  const [priceSearches,setPriceSearches]=useState<MarketPriceSearchDto[]>([]);
  const [priceResultId,setPriceResultId]=useState("");
  const [priceSearchError,setPriceSearchError]=useState(false);
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
  const [managerLoadError,setManagerLoadError]=useState(false);
  async function reload(){
    const result=await loadConsultationData(visitId,product.id);
    setItems(result.items);setManagers(result.managers);setManagerLoadError(result.managerLoadError);
  }
  useEffect(()=>{let live=true;void loadConsultationData(visitId,product.id)
    .then(result=>{if(live){setItems(result.items);setManagers(result.managers);setManagerLoadError(result.managerLoadError);}})
    .catch(()=>{if(live)setError("相談履歴を読み込めませんでした。再読込してください。")})
    .finally(()=>{if(live)setLoading(false)});return()=>{live=false};},[visitId,product.id]);
  useEffect(()=>{let live=true;void Promise.all([resources.visit(visitId),resources.marketPriceSearches()])
    .then(([visit,result])=>{if(live)setPriceSearches(result.items.filter(search=>Boolean(search.resultId&&search.confirmedAt&&search.branchId===visit.branchId)))})
    .catch(()=>{if(live)setPriceSearchError(true)});return()=>{live=false};},[visitId]);
  async function submitRequest(event:React.FormEvent){
    event.preventDefault();const price=Number(proposedPrice);
    const due=dueAt?new Date(dueAt):null;
    if(!managerId||!Number.isSafeInteger(price)||price<0||!reason.trim()||(due&&(!Number.isFinite(due.getTime())||due.getTime()<=Date.now()))){setError("相談先、提示案、相談理由、回答期限を確認してください。");return;}
    setBusy(true);setError("");
    try{await resources.createProductConsultation(visitId,product.id,{assignedManagerId:managerId,proposedPriceYen:price,reason:reason.trim(),marketPriceResultId:priceResultId||null,dueAt:due?.toISOString()??null});await reload();await onChanged();setReason("");setProposedPrice("");setPriceResultId("");setDueAt("");}
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
  const lastDecision=items[items.length-1];
  const returned=product.status==="draft"&&lastDecision?.status==="returned"?lastDecision:null;
  return <section className={styles.consultations} aria-label={`${product.productName}の上長相談`}>
    <div className={styles.header}><h3>上長相談</h3><button type="button" className={styles.secondary} onClick={()=>void reload().then(()=>setError("")).catch(()=>setError("相談履歴を再読込できませんでした。"))}>相談を再読込</button></div>
    {loading?<p role="status">相談履歴を読み込んでいます。</p>:null}{error?<p className={styles.error} role="alert">{error}</p>:null}
    {managerLoadError?<p className={styles.error} role="status">相談先の上長を取得できませんでした。相談履歴は確認できます。新規相談・代理変更は再読込後に行ってください。</p>:null}
    {items.map(item=><div key={item.id} className={styles.consultationItem}>
      <p><strong>{consultationStatus[item.status]}</strong> · 相談先: {item.managerName??item.assignedManagerId} · 提示案: {item.proposedPriceYen.toLocaleString()}円</p>
      {item.dueAt?<p>回答期限: {new Date(item.dueAt).toLocaleString("ja-JP")}{item.overdue?"（期限超過・未承認）":""}</p>:null}
      <p>相談理由: {item.requestReason}</p>
      <p>相場根拠: {item.marketPriceResultId?`確定結果 ${priceSearches.find(search=>search.resultId===item.marketPriceResultId)?.query.keyword??item.marketPriceResultId}`:"未添付（判断理由を確認）"}</p>
      {item.responseNote?<p>回答: {item.responseNote}</p>:null}{item.approvedPriceYen!==null?<p>承認額: {item.approvedPriceYen.toLocaleString()}円</p>:null}
      {item.status==="pending"?<div className={styles.consultationActions}>
        <p>回答は指定された上長のみ、代理変更は権限のある上長のみ実行できます。</p>
        <label>承認額（円）<input type="number" min={0} step={1} value={approvedPrice} onChange={event=>setApprovedPrice(event.target.value)}/></label>
        <label>回答・条件・差戻し理由<textarea maxLength={1000} value={responseNote} onChange={event=>setResponseNote(event.target.value)}/></label>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={()=>void decide(item,"approved")}>承認</button><button type="button" className={styles.secondary} disabled={busy} onClick={()=>void decide(item,"conditional")}>条件付き承認</button><button type="button" className={styles.secondary} disabled={busy} onClick={()=>void decide(item,"returned")}>差戻し</button></div>
        <label>代理の上長<select value={nextManager} onChange={event=>setNextManager(event.target.value)}><option value="">選択してください</option>{managers.filter(manager=>manager.id!==item.assignedManagerId).map(manager=><option key={manager.id} value={manager.id}>{manager.displayName}</option>)}</select></label>
        <label>代理変更の理由<textarea maxLength={1000} value={reassignReason} onChange={event=>setReassignReason(event.target.value)}/></label>
        <button type="button" className={styles.secondary} disabled={busy||managerLoadError||managers.length===0} onClick={()=>void reassign(item)}>代理へ引き継ぐ</button>
      </div>:null}
    </div>)}
    {!loading&&items.length===0?<p>相談履歴はありません。</p>:null}
    {product.status==="draft"?<form className={styles.consultationActions} onSubmit={event=>void submitRequest(event)}>
      <h4>{returned?"差戻し内容を修正して再提出する":"商品別に相談する"}</h4>
      {returned?<p>前回の差戻し理由: {returned.responseNote}。内容と提示案を確認して新しい相談として送信してください。前回の判断履歴は残ります。</p>:null}
      <label>相談先の上長<select required value={managerId} onChange={event=>setManagerId(event.target.value)}><option value="">選択してください</option>{managers.map(manager=><option key={manager.id} value={manager.id}>{manager.displayName}</option>)}</select></label>
      <label>顧客への提示案（円）<input required type="number" min={0} step={1} value={proposedPrice} onChange={event=>setProposedPrice(event.target.value)}/></label>
      <label>確定済みの相場根拠（任意）<select value={priceResultId} onChange={event=>setPriceResultId(event.target.value)}><option value="">添付しない</option>{priceSearches.map(search=><option key={search.resultId!} value={search.resultId!}>{String(search.query.keyword??"検索語なし")} · 中央値 {search.medianPrice==null?"算出なし":`${search.medianPrice.toLocaleString()}円`} · {new Date(search.confirmedAt!).toLocaleDateString("ja-JP")}</option>)}</select></label>
      <p>同じ拠点の確定結果だけを表示します。検索語と商品が一致するか確認して選択してください。相場の参考値と顧客への提示案は別の記録です。</p>
      {priceSearchError?<p role="status">相場結果を取得できませんでした。根拠を添付する場合は相場画面を確認し、再読込してください。</p>:null}
      <label>判断が必要な理由<textarea required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <label>回答期限（任意）<input type="datetime-local" value={dueAt} onChange={event=>setDueAt(event.target.value)}/></label>
      <button type="submit" className={styles.primary} disabled={busy||managers.length===0}>相談を送る</button>
      {managers.length===0&&!managerLoadError?<p>相談できる上長がいません。所属・権限を管理者に確認してください。</p>:null}
    </form>:null}
  </section>;
}

const responseLabels:Record<ProductOfferResponseDto["response"],string>={pending:"回答待ち",accepted:"承諾",declined:"辞退",counteroffer:"再提案の希望"};
function ProductOffers({visitId,product,receiptConfirmed}:{visitId:string;product:VisitProductDto;receiptConfirmed:boolean}){
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
      {index===0&&!receiptConfirmed?<div className={styles.consultationActions}>
        <label>顧客回答<select value={response} onChange={event=>setResponse(event.target.value as ProductOfferResponseDto["response"])}>{Object.entries(responseLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>回答メモ（個人情報は入力しない）<textarea maxLength={1000} value={responseNote} onChange={event=>setResponseNote(event.target.value)}/></label>
        <button type="button" className={styles.primary} disabled={busy} onClick={()=>void record(offer)}>回答を記録</button>
      </div>:null}
    </article>)}
    {!loading&&offers.length===0?<p>顧客への提示はまだありません。</p>:null}
    {receiptConfirmed?<p>現物の受領確認済みです。提示と回答の履歴はここで確認できます。</p>:null}
    {product.status==="ready"&&!receiptConfirmed?<form className={styles.form} onSubmit={event=>void present(event)}>
      <h4>新しい提示を記録</h4><p>以前の提示は残ります。上長の承認額を超える提示は保存できません。</p>
      <label>提示額（円）<input required type="number" min={0} step={1} value={price} onChange={event=>setPrice(event.target.value)}/></label>
      <label>条件（個人情報は入力しない）<textarea required maxLength={1000} value={terms} onChange={event=>setTerms(event.target.value)}/></label>
      <label>有効期限（任意）<input type="datetime-local" value={expiresAt} onChange={event=>setExpiresAt(event.target.value)}/></label>
      <button type="submit" className={styles.primary} disabled={busy}>{busy?"保存中…":"提示を記録"}</button>
    </form>:!receiptConfirmed?<p>上長の判断が完了すると提示を記録できます。</p>:null}
  </section>;
}

function ProductReceiptChecks({visitId,product,onConfirmed}:{visitId:string;product:VisitProductDto;onConfirmed:(productId:string)=>void}){
  const [checks,setChecks]=useState<ProductReceiptCheckDto[]>([]);
  const [result,setResult]=useState<"hold"|"confirmed">("hold");
  const [quantity,setQuantity]=useState(String(product.quantity));
  const [identityMatched,setIdentityMatched]=useState(false);
  const [conditionMatched,setConditionMatched]=useState(false);
  const [observedCondition,setObservedCondition]=useState("");
  const [holdReason,setHoldReason]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const pending=useRef<{body:string;key:string}|null>(null);
  async function reload(){const response=await resources.productReceiptChecks(visitId,product.id);setChecks(response.items);if(response.items[0]?.result==="confirmed")onConfirmed(product.id);}
  useEffect(()=>{let live=true;void resources.productReceiptChecks(visitId,product.id)
    .then(response=>{if(live){setChecks(response.items);if(response.items[0]?.result==="confirmed")onConfirmed(product.id);}})
    .catch(()=>{if(live)setError("現物照合履歴を読み込めませんでした。再読込してください。");})
    .finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[visitId,product.id,onConfirmed]);
  async function save(event:React.FormEvent){
    event.preventDefault();const observedQuantity=Number(quantity);
    if(!Number.isInteger(observedQuantity)||observedQuantity<0||observedQuantity>100000||(result==="hold"&&!holdReason.trim())||(result==="confirmed"&&(!identityMatched||!conditionMatched||observedQuantity!==product.quantity))){setError("数量、一致の確認、保留理由を確認してください。");return;}
    const body={result,observedQuantity,identityMatched,conditionMatched,observedCondition:observedCondition.trim()||null,holdReason:result==="hold"?holdReason.trim():null,expectedVersion:checks[0]?.version??0};
    const fingerprint=JSON.stringify(body);if(pending.current?.body!==fingerprint)pending.current={body:fingerprint,key:crypto.randomUUID()};
    setBusy(true);setError("");
    try{await resources.createProductReceiptCheck(visitId,product.id,body,pending.current.key);await reload();pending.current=null;setHoldReason("");}
    catch{setError("現物照合を保存できませんでした。履歴を再読込して二重登録がないか確認してください。");await reload().catch(()=>undefined);}
    finally{setBusy(false);}
  }
  return <section className={styles.consultations} aria-label={`${product.productName}の現物照合`}>
    <div className={styles.header}><h3>現物照合・受領</h3><button type="button" className={styles.secondary} onClick={()=>void reload().catch(()=>setError("再読込できませんでした。"))}>照合履歴を再読込</button></div>
    {loading?<p role="status">照合履歴を読み込んでいます。</p>:null}{error?<p role="alert" className={styles.error}>{error}</p>:null}
    {checks.map(check=><article key={check.id} className={styles.consultationItem}>
      <p><strong>照合 {check.version}: {check.result==="confirmed"?"受領確認済み":"保留"}</strong> · {new Date(check.checkedAt).toLocaleString("ja-JP")}</p>
      <p>現物 {check.observedQuantity}点 · 商品識別 {check.identityMatched?"一致":"未一致"} · 状態 {check.conditionMatched?"一致":"未一致"}</p>
      {check.observedCondition?<p>現物の状態: {check.observedCondition}</p>:null}{check.holdReason?<p>保留理由: {check.holdReason}</p>:null}
      <p>MONOCLEへの商品登録: 未送信</p>
    </article>)}
    {!loading&&checks.length===0?<p>現物照合はまだありません。</p>:null}
    {product.status==="ready"&&checks[0]?.result!=="confirmed"?<form className={styles.form} onSubmit={event=>void save(event)}>
      <h4>現物を確認する</h4>
      <label>照合結果<select value={result} onChange={event=>setResult(event.target.value as "hold"|"confirmed")}><option value="hold">差異・確認待ちで保留</option><option value="confirmed">受領を確認</option></select></label>
      <label>現物の数量<input type="number" min={0} max={100000} value={quantity} onChange={event=>setQuantity(event.target.value)}/></label>
      <label><input type="checkbox" checked={identityMatched} onChange={event=>setIdentityMatched(event.target.checked)}/> 商品識別が一致</label>
      <label><input type="checkbox" checked={conditionMatched} onChange={event=>setConditionMatched(event.target.checked)}/> 状態が一致</label>
      <label>現物の状態メモ<textarea maxLength={1000} value={observedCondition} onChange={event=>setObservedCondition(event.target.value)}/></label>
      {result==="hold"?<label>保留理由<textarea required maxLength={1000} value={holdReason} onChange={event=>setHoldReason(event.target.value)}/></label>:null}
      <p>受領確認には商品・数量・状態の一致と、最新提示への顧客承諾が必要です。MONOCLE登録は別工程です。</p>
      <button type="submit" className={styles.primary} disabled={busy}>{busy?"保存中…":result==="confirmed"?"受領を確認":"保留を記録"}</button>
    </form>:null}
  </section>;
}

export function VisitProducts({visitId}:{visitId:string}){
  const [products,setProducts]=useState<VisitProductDto[]>([]);
  const [pdfItems,setPdfItems]=useState<{extractionId:string;text:string}|null>(null);
  const [citePdf,setCitePdf]=useState(false);
  const [pdfExcerpt,setPdfExcerpt]=useState("");
  const pdfSourceRef=useRef<HTMLTextAreaElement|null>(null);
  const [pdfLoadError,setPdfLoadError]=useState(false);
  const [confirmedReceiptProductIds,setConfirmedReceiptProductIds]=useState<string[]>([]);
  const [form,setForm]=useState(empty);
  const [editing,setEditing]=useState<VisitProductDto|null>(null);
  const [expandedProductId,setExpandedProductId]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const pendingOperation=useRef<{body:string;key:string}|null>(null);
  const markReceiptConfirmed=useCallback((productId:string)=>setConfirmedReceiptProductIds(current=>current.includes(productId)?current:[...current,productId]),[]);

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
  useEffect(()=>{
    let live=true;void resources.workspace(visitId)
      .then(workspace=>{if(!live)return;const field=workspace.fields.find(item=>item.fieldKey==="appraisalItems"&&item.valueType==="text"&&["confirmed","corrected"].includes(item.verificationStatus));setPdfItems(workspace.extraction?.status==="confirmed"&&field?.textValue?.trim()?{extractionId:workspace.extraction.id,text:field.textValue.trim()}:null);setPdfLoadError(false)})
      .catch(()=>{if(live)setPdfLoadError(true)});return()=>{live=false};
  },[visitId]);
  function edit(product:VisitProductDto){
    pendingOperation.current=null;
    setEditing(product);
    setCitePdf(false);
    setPdfExcerpt("");
    setForm({productName:product.productName,quantity:String(product.quantity),conditionNote:product.conditionNote??"",accessoriesNote:product.accessoriesNote??""});
    setError("");
  }
  function useSelectedPdfPassage(){
    const source=pdfSourceRef.current;
    const selected=source?.value.slice(source.selectionStart,source.selectionEnd).trim()??"";
    if(!selected){setError("査定品欄で該当部分を選択してください。");return;}
    if(selected.length>500){setError("該当部分は500文字以内で選択してください。");return;}
    setPdfExcerpt(selected);setError("");
  }
  async function save(event:React.FormEvent){
    event.preventDefault();
    const quantity=Number(form.quantity);
    if(!form.productName.trim()||!Number.isInteger(quantity)||quantity<1||quantity>100000){setError("品名と数量を確認してください。");return;}
    if(!editing&&citePdf&&!pdfExcerpt.trim()){setError("PDFのどの記載を確認したか入力してください。");return;}
    setSaving(true);setError("");
    const input={productName:form.productName.trim(),quantity,conditionNote:form.conditionNote.trim()||null,accessoriesNote:form.accessoriesNote.trim()||null};
    const sourceExtractionId=!editing&&citePdf?pdfItems?.extractionId??null:null;
    const sourceAppraisalExcerpt=sourceExtractionId?pdfExcerpt.trim():null;
    const body=JSON.stringify({visitId,productId:editing?.id??null,expectedLockVersion:editing?.lockVersion??null,input,sourceExtractionId,sourceAppraisalExcerpt});
    if(pendingOperation.current?.body!==body)pendingOperation.current={body,key:crypto.randomUUID()};
    const operationKey=pendingOperation.current.key;
    try{
      if(editing)await resources.updateVisitProduct(visitId,editing.id,{...input,expectedLockVersion:editing.lockVersion},operationKey);
      else await resources.createVisitProduct(visitId,{...input,sourceExtractionId,sourceAppraisalExcerpt},operationKey);
      await refresh();setForm(empty);setEditing(null);setCitePdf(false);setPdfExcerpt("");pendingOperation.current=null;
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
        <p>進行状態: {product.status==="draft"?"下書き":product.status==="research_hold"?"相場調査保留":product.status==="research_pending"?"相談中":product.status==="ready"?"判断済み":product.status}</p>
        {product.sourceExtractionId?<p>PDFの査定品を原本と照合して登録 · 該当部分: {product.sourceAppraisalExcerpt??"旧記録・抜粋未登録"}（抽出ID: {product.sourceExtractionId}）</p>:<p>商品情報は手入力です。</p>}
        <ProductResearchHold visitId={visitId} product={product} onChanged={refresh}/>
        <div className={styles.actions}>{product.status==="draft"?<button type="button" className={styles.secondary} onClick={()=>edit(product)}>修正する</button>:null}<button type="button" className={styles.secondary} onClick={()=>setExpandedProductId(current=>current===product.id?null:product.id)} aria-expanded={expandedProductId===product.id}>相談・提示・回答</button></div>
        {expandedProductId===product.id?<><ProductConsultations visitId={visitId} product={product} onChanged={refresh}/><ProductOffers visitId={visitId} product={product} receiptConfirmed={confirmedReceiptProductIds.includes(product.id)}/><ProductReceiptChecks visitId={visitId} product={product} onConfirmed={markReceiptConfirmed}/></>:null}
      </article>)}
      {!loading&&products.length===0?<p className={styles.empty}>商品カードはありません。複数の商品を一件ずつ登録できます。</p>:null}
    </div>
    <form className={styles.form} onSubmit={event=>void save(event)}>
      <h3>{editing?"商品カードを修正":"商品カードを追加"}</h3>
      {!editing&&pdfItems?<div className={styles.consultationItem}><label>確定済みPDFの査定品<textarea ref={pdfSourceRef} readOnly rows={4} value={pdfItems.text}/></label><label><input type="checkbox" checked={citePdf} onChange={event=>{setCitePdf(event.target.checked);if(!event.target.checked)setPdfExcerpt("")}}/> この査定品欄を原本と照合し、商品カードの出典として記録する</label>{citePdf?<><p>査定品欄の該当部分を選択してから下のボタンを押してください。抜粋欄への手入力もできます。</p><button type="button" className={styles.secondary} onClick={useSelectedPdfPassage}>選択部分を抜粋に入れる</button><label>PDFで確認した該当部分<input required maxLength={500} value={pdfExcerpt} onChange={event=>setPdfExcerpt(event.target.value)} placeholder="査定品欄から該当部分を転記"/></label></>:null}<p>複数商品は一件ずつ入力してください。PDFの文章を自動で商品に分割しません。該当部分は確定済み査定品欄に含まれる必要があります。</p></div>:null}
      {!editing&&pdfLoadError?<p role="status">PDFの確認済み項目を取得できませんでした。出典を付ける場合は再読込してください。</p>:null}
      <label>商品名<input required maxLength={300} value={form.productName} onChange={event=>setForm(current=>({...current,productName:event.target.value}))}/></label>
      <label>数量<input required type="number" min={1} max={100000} value={form.quantity} onChange={event=>setForm(current=>({...current,quantity:event.target.value}))}/></label>
      <label>状態・傷など<textarea maxLength={1000} value={form.conditionNote} onChange={event=>setForm(current=>({...current,conditionNote:event.target.value}))}/></label>
      <label>付属品<textarea maxLength={1000} value={form.accessoriesNote} onChange={event=>setForm(current=>({...current,accessoriesNote:event.target.value}))}/></label>
      <div className={styles.actions}><button className={styles.primary} type="submit" disabled={saving||(!editing&&citePdf&&!pdfExcerpt.trim())}>{saving?"保存中…":editing?"修正を保存":"商品を追加"}</button>{editing?<button type="button" className={styles.secondary} onClick={()=>{setEditing(null);setForm(empty);setPdfExcerpt("");pendingOperation.current=null;}}>修正をやめる</button>:null}</div>
    </form>
  </section>;
}
