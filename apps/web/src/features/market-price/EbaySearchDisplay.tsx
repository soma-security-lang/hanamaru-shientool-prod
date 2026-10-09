"use client";
import { useEffect, useRef, useState } from "react";
import type { EbayMarket, EbaySearchDetailDto } from "@hanamaru/contracts";
import { ApiClientError } from "@/lib/api/client";
import { ebayMarketPriceResources } from "@/lib/api/ebay-market-price";
import { ebayMarketLabels } from "./EbaySearchControls";
import { EbayMarketQuality } from "./EbayMarketQuality";
import { EbaySearchEditor } from "./EbaySearchEditor";
import { EbayReferenceComparison } from "./EbayReferenceComparison";
import {loadEbayPending,saveEbayPending,clearEbayPending,type EbayPendingOperation} from "./ebay-operation-recovery";
import styles from "./MarketPriceExperience.module.css";

const terminal = new Set(["ready", "partial", "blocked", "failed", "cancelled", "confirmed"]);
const labels: Record<string, string> = { queued: "受付待ち", pending: "外部処理待ち", fetching: "取得中", complete: "ページ取得完了", ready: "取得完了", partial: "一部取得", blocked: "安全停止", failed: "失敗", cancelled: "取消済み", confirmed: "確定済み" };
const failureLabels: Record<string,string> = {CONFIGURATION:"接続設定を運用担当者が確認する必要があります",EXTERNAL_DISABLED:"外部取得は無効です",QUOTA:"利用枠・予算の確認待ちです",UPSTREAM_LIMIT:"取得元側の制限で停止しています",RATE_LIMIT:"呼出し速度を調整して待機しています",PENDING_LIMIT:"先行する取得の完了を待っています",IDEMPOTENCY_CONFLICT:"同じ操作の条件が競合しています。再購入せず確認が必要です",RESULT_UNKNOWN:"結果・消費枠を確認中です",TRANSPORT:"通信が不安定です。同じ取得を確認します",CONTRACT:"応答仕様の確認が必要です",PARSE_FAILED:"取得済み結果の解析を確認中です"};
type View = "progress" | "candidates" | "result";
type Action = Parameters<typeof ebayMarketPriceResources.mutate>[1];
export function EbaySearchDisplay({ searchId, onError, view = "progress", onNavigate, onRepeat }: { searchId: string; onError: (message: string) => void; view?: View; onNavigate?: (view: View) => void; onRepeat?: (id:string)=>void }) {
  const [detail, setDetail] = useState<EbaySearchDetailDto>();
  const [pollEpoch, setPollEpoch] = useState(0);
  const [market, setMarket] = useState<EbayMarket>();
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [canResend,setCanResend]=useState(false);
  const [partialAcknowledged, setPartialAcknowledged] = useState(false);
  const [nextConsent, setNextConsent] = useState<EbayMarket[]>([]);
  const [retryConsent, setRetryConsent] = useState<string[]>([]);
  const [resumeConsent,setResumeConsent]=useState<string[]>([]);
  const [repeatConsent,setRepeatConsent]=useState(false);
  const [outlierPercent, setOutlierPercent] = useState<number>();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const operation = useRef<{ action: Action; body: Record<string, unknown>; key: string; saved: boolean; resultSearchId?:string } | null>(null);
  const recoveredOperation=useRef<EbayPendingOperation|null>(null);
  const recoveryUnavailable=useRef(false);
  useEffect(() => {
    let active=true;
    operation.current=null;
    recoveredOperation.current=null;recoveryUnavailable.current=false;
    let message="";
    try{recoveredOperation.current=loadEbayPending(searchId);}catch{recoveryUnavailable.current=true;message="前回の操作記録を確認できません。新しい保存は開始せず、ブラウザの設定と保存状況を運用担当者へ確認してください。";}
    if(recoveredOperation.current)message="前回の操作結果が未確認です。保存し直さず、操作結果を確認してください。";
    queueMicrotask(()=>{if(active){setRecovery(message);setCanResend(false);}});
    return()=>{active=false;};
  },[searchId]);
  useEffect(() => {
    let active = true, timer = 0;
    async function poll() {
      try {
        const value = await ebayMarketPriceResources.get(searchId);
        if (!active) return;
        setDetail(value);
        if (!terminal.has(value.status) || (value.status === "partial" && value.runs.some(run=>["queued","pending","normalizing"].includes(run.status)))) timer = window.setTimeout(poll, document.visibilityState === "visible" ? 2000 : 10000);
      } catch (error) { if (active) onError(error instanceof Error ? error.message : "eBay検索を取得できませんでした"); }
    }
    if (searchId) void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [searchId, onError, pollEpoch]);
  async function run(action: Action, body: Record<string, unknown>) {
    if (busy) return;
    if(recoveryUnavailable.current){onError("操作記録を確認できないため、保存を開始していません。");return;}
    if(recoveredOperation.current&&!operation.current){onError("前回の操作結果を先に確認してください。新しい保存は開始していません。");return;}
    if (operation.current && (operation.current.action !== action || JSON.stringify(operation.current.body) !== JSON.stringify(body))) {
      onError("前の操作結果が未確認です。先に「操作結果を確認」を実行してください。"); return;
    }
    let pending:NonNullable<typeof operation.current> = operation.current ? {...operation.current} : { action, body, key: crypto.randomUUID(), saved: false };
    const metadata=recoveredOperation.current??{key:pending.key,searchId,action,startedAt:Date.now()};
    if(!pending.saved&&Date.now()-metadata.startedAt>=48*60*60*1000){setRecovery("操作結果の保管期間を過ぎました。新しい保存の前に運用担当者へ確認してください。");return;}
    if(!saveEbayPending(metadata)){onError("操作キーを一時保存できないため、保存を開始していません。ブラウザの設定を確認してください。");return;}
    recoveredOperation.current=metadata;
    operation.current = pending; setBusy(true); onError("");
    try {
      if (!pending.saved) {
        const response=await ebayMarketPriceResources.mutate(searchId,pending.action,pending.body,pending.key);
        if(pending.action==="repeat"){
          const result=response as {searchId?:unknown};
          if(typeof result?.searchId!=="string"||!result.searchId)throw new Error("再検索の保存結果を確認できません。同じ操作キーで再確認してください。");
          pending={...pending,resultSearchId:result.searchId};
        }
        pending={...pending,saved:true};operation.current=pending;setCanResend(false);
      }
      const updated = await ebayMarketPriceResources.get(pending.resultSearchId??searchId);
      if(pending.action==="repeat"&&pending.resultSearchId){
        // Do not render new-search controls while this component still has the old ID.
        operation.current=null;recoveredOperation.current=null;clearEbayPending(searchId);setRecovery("");setRepeatConsent(false);onRepeat?.(pending.resultSearchId);return;
      }
      setDetail(updated); operation.current = null;recoveredOperation.current=null;clearEbayPending(searchId); setRecovery(""); setPartialAcknowledged(false); setNextConsent([]); setRetryConsent([]);
      if (pending.action === "confirm") onNavigate?.("result");
      setResumeConsent([]);
      if (["next-page","retry","resume"].includes(pending.action)) { setPollEpoch(value=>value+1); onNavigate?.("progress"); }
    } catch (error) {
      setCanResend(!pending.saved);
      if (!pending.saved && error instanceof ApiClientError && [400,403,404,409,422].includes(error.status)) {
        operation.current = null;
        recoveredOperation.current=null;clearEbayPending(searchId);
        setCanResend(false);
        setRecovery("保存は拒否されました。最新の結果を読み込み、内容を確認してください。");
      } else setRecovery(pending.saved ? "保存は完了しましたが最新表示を取得できません。保存を重ねず、表示だけ再取得します。" : "操作結果が未確認です。同じ条件・同じキーで結果を確認します。再読込前に確認してください。");
      onError(error instanceof Error ? error.message : "操作結果を確認できませんでした");
    } finally { setBusy(false); }
  }
  async function recover() {
    if(operation.current?.saved){await run(operation.current.action,operation.current.body);return;}
    const metadata=recoveredOperation.current;
    if(metadata){
      setBusy(true);
      try{
        const result=await ebayMarketPriceResources.operationResult(metadata.key,metadata.action.startsWith("candidates/")?"candidate":metadata.action);
        if(result.status!=="succeeded"||!result.searchId){
          setRecovery(Date.now()-metadata.startedAt>=48*60*60*1000?"操作結果の保管期間を過ぎました。新規保存する前に運用担当者へ確認してください。":"結果はまだ確認できません。保存し直さず、しばらくして同じ操作を再確認してください。");
          return;
        }
        if(metadata.action!=="repeat"&&result.searchId!==searchId)throw new Error("操作の対象が一致しません。運用担当者へ確認してください。");
        const updated=await ebayMarketPriceResources.get(result.searchId);
        operation.current=null;recoveredOperation.current=null;clearEbayPending(searchId);setRecovery("");
        if(metadata.action==="repeat"){onRepeat?.(result.searchId);return;}
        setDetail(updated);
        if(metadata.action==="confirm")onNavigate?.("result");
        if(["retry","resume","next-page"].includes(metadata.action)){setPollEpoch(value=>value+1);onNavigate?.("progress");}
      }catch(error){onError(error instanceof Error?error.message:"操作結果を確認できませんでした");}
      finally{setBusy(false);}
      return;
    }
    if (operation.current) { await run(operation.current.action, operation.current.body); return; }
    setBusy(true);
    try { setDetail(await ebayMarketPriceResources.get(searchId)); setRecovery(""); }
    catch (error) { onError(error instanceof Error ? error.message : "最新結果を取得できませんでした"); }
    finally { setBusy(false); }
  }
  if (!detail) return <section className={styles.panel}><p role="status">eBay検索を読み込んでいます</p><button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>void recover()}>取得状況を再読み込み</button></section>;
  const charged = detail.pages.reduce((total, page) => total + (page.credits ?? 0), 0);
  const unresolved = detail.pages.filter(page => page.credits === null).length;
  const snapshot = detail.snapshots?.[0];
  const statistics = view === "result" ? snapshot?.snapshotJson.statistics ?? [] : detail.statistics;
  const incomplete = detail.runs.some(run => run.status !== "complete");
  const selectedMarket = market ?? detail.runs[0]?.market;
  const currentStat = detail.statistics.find(stat => stat.market === selectedMarket);
  const resultOnly = view === "result";
  return <section className={styles.panel}>
    <h2>{resultOnly ? "保存済みeBay相場結果" : view === "candidates" ? "eBay候補の確認" : "eBay市場別の取得状況"}</h2>
    {resultOnly&&snapshot?<EbayReferenceComparison key={detail.id} detail={detail}/>:null}
    <p role="status">{labels[detail.status] ?? detail.status}・消費確定 {charged} 枠・未確定 {unresolved} 枠</p>
    <p>取得したページの参考相場です。全世界・直近90日の全件取得ではありません。通貨や異なる市場の中央値は混ぜません。</p>
    {detail.acquisitionMode?<p>{detail.acquisitionMode==="latest"?"この検索は最新取得です。追加ページも自社キャッシュを使わず、新たに取得します。":"この検索は保存結果の再利用が可能です。追加ページも条件・鮮度が一致する場合は新規枠0、ない場合は最大1枠を使います。"}</p>:null}
    {recovery ? <div role="status"><p>{recovery}</p><button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>void recover()}>操作結果を確認</button>
      {canResend?<button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>{const pending=operation.current;if(pending)void run(pending.action,pending.body);}}>同じ保存を同じキーで再送</button>:null}
    </div> : null}
    {resultOnly ? snapshot ? <p>確定版 {snapshot.snapshotVersion}・確定日時 {new Date(snapshot.confirmedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}・{snapshot.snapshotJson.incomplete ? "一部市場未完了の参考値" : "取得ページの参考値"}</p> : <p>確定済み結果はありません。候補を確認して相場を確定してください。</p> : null}
    <nav aria-label="eBay検索の操作"><button type="button" className={styles.secondaryButton} onClick={()=>onNavigate?.("candidates")}>候補を確認</button><button type="button" className={styles.secondaryButton} disabled={!snapshot} onClick={()=>onNavigate?.("result")}>保存済み結果を見る</button></nav>
    {detail.plan?.keyword&&Array.isArray(detail.plan.conditions)?<EbaySearchEditor key={detail.id} detail={detail} disabled={busy||unresolved>0} onSubmit={body=>void run("repeat",body)}/>:null}
    <section className={styles.panel}><h3>同条件で最新を再取得</h3><p>保存結果の閲覧とは別の、新しい検索です。自社キャッシュを使わず、各市場の1ページ目を取得します。前回の未確定消費がある間は開始できません。</p>
      <label><input type="checkbox" checked={repeatConsent} disabled={unresolved>0||busy} onChange={event=>setRepeatConsent(event.target.checked)}/>同条件の最新取得で最大 {detail.plan?.markets.length??detail.runs.length} 枠を使用することを確認しました</label>
      <button type="button" className={styles.secondaryButton} disabled={!repeatConsent||unresolved>0||busy} onClick={()=>void run("repeat",{expectedLockVersion:detail.lockVersion,mode:"latest",consumptionConfirmed:true})}>同条件で最新を取得</button>
    </section>
    {!resultOnly&&detail.status!=="cancelled"?detail.pages.filter(page=>page.state==="failed"&&page.creditState==="released"&&page.credits===0&&!detail.pages.some(other=>other.market===page.market&&other.pageNumber===page.pageNumber&&other.attempt>page.attempt)).map(page=>{
      const id=`${page.market}:${page.pageNumber}`;
      return <section key={id} className={styles.panel}><h3>{ebayMarketLabels[page.market]}・ページ {page.pageNumber} の再試行</h3><p>外部失敗・消費0枠が確定しています。再試行は新しい受付となり最大1枠を予約します。</p>
        <label><input type="checkbox" checked={retryConsent.includes(id)} onChange={event=>setRetryConsent(previous=>event.target.checked?[...previous,id]:previous.filter(value=>value!==id))}/>再試行で最大1枠を使用することを確認しました</label>
        <button type="button" className={styles.secondaryButton} disabled={busy||!retryConsent.includes(id)} onClick={()=>void run("retry",{expectedLockVersion:detail.lockVersion,market:page.market,pageNumber:page.pageNumber,consumptionConfirmed:true})}>このページだけ再試行</button>
      </section>;
    }):null}
    {!resultOnly&&detail.pages.filter(page=>page.canResume).map(page=>{
      const id=`${page.market}:${page.pageNumber}`;
      return <section key={`resume:${id}`} className={styles.panel}><h3>{ebayMarketLabels[page.market]}・ページ {page.pageNumber} の保存済み取得を再確認</h3>
        <p>運用担当者が停止を解除した後、同じ外部受付の結果を確認します。新しい検索は購入しません。元の取得の未確定消費は無料とは判断しません。</p>
        <label><input type="checkbox" checked={resumeConsent.includes(id)} disabled={busy} onChange={event=>setResumeConsent(previous=>event.target.checked?[...previous,id]:previous.filter(value=>value!==id))}/>保存済み取得の再確認を希望します</label>
        <button type="button" className={styles.secondaryButton} disabled={busy||!resumeConsent.includes(id)} onClick={()=>void run("resume",{expectedLockVersion:detail.lockVersion,market:page.market,pageNumber:page.pageNumber,resumeConfirmed:true})}>保存済み取得を再確認</button>
      </section>;
    })}
    {detail.runs.map(run => {
      const stat = statistics.find(item => item.market === run.market);
      return <article key={run.market} className={styles.panel}>
        <h3>{ebayMarketLabels[run.market]}（{stat?.currency}）</h3><p>{labels[run.status] ?? run.status}</p>
        {run.failureClass?<p>{failureLabels[run.failureClass]??"処理を確認中です"}。未確定の消費枠を無料と判断しないでください。</p>:null}
        {detail.pages.filter(page=>page.market===run.market&&page.retryNotBefore).map(page=><p key={`${page.pageNumber}:${page.attempt}`}>ページ {page.pageNumber} の再確認は {new Date(page.retryNotBefore!).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})} 以降です。</p>)}
        {detail.pages.filter(page=>page.market===run.market&&page.cacheHit).map(page=><p key={`cache:${page.pageNumber}:${page.attempt}`}>ページ {page.pageNumber} は自社保存結果を再利用（新規検索枠 0）。取得日時：{page.collectedAt?new Date(page.collectedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}):"未記録"}。現在の取引を再取得した結果ではありません。</p>)}
        <dl><dt>受信行</dt><dd>{stat?.receivedRows ?? 0}</dd><dt>採用件数</dt><dd>{stat?.includedCount ?? 0}</dd>
          <dt>最低価格</dt><dd>{stat?.minimum ?? "未算出"}</dd><dt>中央値</dt><dd>{stat?.median ?? "未算出"}</dd><dt>最高価格</dt><dd>{stat?.maximum ?? "未算出"}</dd></dl>
        {stat && stat.includedCount > 0 && stat.includedCount < 5 ? <p>少数標本のため自動外れ値判定は行っていません。</p> : null}
        {stat?<EbayMarketQuality stat={stat}/>:null}
        {!resultOnly && run.status === "complete" && run.nextPage !== null && run.nextPage <= 10 && !["cancelled","blocked"].includes(detail.status) ? <div>
          <label><input type="checkbox" checked={nextConsent.includes(run.market)} onChange={event=>setNextConsent(previous=>event.target.checked?[...previous,run.market]:previous.filter(value=>value!==run.market))}/>{ebayMarketLabels[run.market]}の次ページに最大1枠を使用することを確認しました</label>
          <button type="button" className={styles.secondaryButton} disabled={busy||!nextConsent.includes(run.market)} onClick={()=>void runActionNext(run.market)}>この市場の次ページを取得</button>
        </div> : null}
      </article>;
    })}
    {view === "candidates" ? <section aria-label="eBay候補採否">
      <label className={styles.editQuery}>候補の市場<select value={selectedMarket ?? ""} onChange={event=>setMarket(event.target.value as EbayMarket)}>{detail.runs.map(item=><option key={item.market} value={item.market}>{ebayMarketLabels[item.market]}</option>)}</select></label>
      <form onSubmit={event=>{event.preventDefault();void run("outlier-policy",{expectedLockVersion:detail.lockVersion,outlierPercent:outlierPercent??detail.outlierPercent});}}>
        <label>外れ値基準（%）<input type="number" min={1} max={100} step={1} value={outlierPercent??detail.outlierPercent} onChange={event=>setOutlierPercent(Number(event.target.value))}/></label><button type="submit" className={styles.secondaryButton} disabled={busy}>外れ値基準を適用</button>
      </form>
      {!currentStat?.decisions?.length ? <p>この市場の候補はまだありません。</p> : currentStat.decisions.map(decision=>{
        const candidate=detail.observations.find(item=>item.observationJson.observationKey===decision.observation.observationKey);
        if(!candidate)return null;
        const observation=candidate.observationJson;
        const change=(scope:"product"|"observation",value:"default"|"include"|"exclude")=>void run(`candidates/${encodeURIComponent(candidate.id)}`,{expectedLockVersion:detail.lockVersion,scope,decision:value,reason:reasons[candidate.id]??""});
        return <article key={candidate.id} className={styles.panel}>
          <h3>{observation.title}</h3><p>{decision.included?"採用":"除外"}・{observation.displayedPrice?`${observation.displayedPrice.amount} ${observation.displayedPrice.currency}`:"価格不明"}</p>
          {decision.productMatch?<p>商品一致：{decision.productMatch.status==="matched"?"条件に一致する表記あり（商品同一性を保証するものではありません）":decision.productMatch.status==="mismatch"?"不一致の可能性。根拠を確認してください":"情報不足。根拠を確認してください"}
            {decision.productMatch.reasons.length?`／${decision.productMatch.reasons.map(reason=>({model_not_matched:"型番表記が一致しません",accessory_only:"部品・付属品のみの可能性",unexpected_bundle:"セット内容が異なる可能性",bundle_contents_unknown:"セット内容不明",capacity_mismatch:"容量が異なります",capacity_unknown:"容量不明",region_mismatch:"地域仕様が異なります",region_unknown:"地域仕様不明",condition_mismatch:"選択状態と異なります",condition_unknown:"状態不明",product_identity_unknown:"商品特定の根拠不足"} as Record<string,string>)[reason]??"商品条件の確認が必要").join("、")}`:null}</p>:null}
          <p>状態：{observation.sourceCondition??"不明"}・所在地：{observation.location.text??"不明"}（{observation.location.status}）</p>
          <p>売却日：{observation.soldOn??"不明"}{observation.soldOn?"（Providerによる年推定付き日付）":""}・送料：{observation.displayedShipping?`${observation.displayedShipping.amount} ${observation.displayedShipping.currency}`:"不明（0円ではありません）"}</p>
          {decision.reasons.length?<p>除外根拠：{decision.reasons.join("、")}</p>:null}
          {observation.canonicalUrl&&/^https:\/\/(?:www\.)?ebay\.(?:com|co\.uk|ca|com\.au|de|fr|it|es)\/itm\/\d{9,15}$/u.test(observation.canonicalUrl)?<a href={observation.canonicalUrl} target="_blank" rel="noopener noreferrer">eBayの出品根拠を開く</a>:null}
          <label>採否変更理由<input maxLength={1000} value={reasons[candidate.id]??""} onChange={event=>setReasons(previous=>({...previous,[candidate.id]:event.target.value}))}/></label>
          <div><button type="button" className={styles.secondaryButton} disabled={busy||!reasons[candidate.id]?.trim()} onClick={()=>change("observation","exclude")}>この市場の候補を除外</button>
          <button type="button" className={styles.secondaryButton} disabled={busy||!reasons[candidate.id]?.trim()||observation.hardExclusions.length>0} onClick={()=>change("observation","include")}>この市場の候補を採用</button>
          <button type="button" className={styles.secondaryButton} disabled={busy||!reasons[candidate.id]?.trim()} onClick={()=>change("observation","default")}>手動採否を解除</button>
          <button type="button" className={styles.secondaryButton} disabled={busy||!reasons[candidate.id]?.trim()||!observation.sourceItemId} onClick={()=>change("product","exclude")}>同じ出品IDを全市場で除外</button>
          <button type="button" className={styles.secondaryButton} disabled={busy||!reasons[candidate.id]?.trim()||!observation.sourceItemId} onClick={()=>change("product","default")}>全市場の除外を解除</button></div>
        </article>;
      })}
      {incomplete?<label><input type="checkbox" checked={partialAcknowledged} onChange={event=>setPartialAcknowledged(event.target.checked)}/>未完了の市場を含む参考値として確定することを確認しました</label>:null}
      <button type="button" className={styles.primaryButton} disabled={busy||!detail.statistics.some(stat=>stat.includedCount>0)||(incomplete&&!partialAcknowledged)} onClick={()=>void run("confirm",{expectedLockVersion:detail.lockVersion,partialAcknowledged})}>相場結果を確定</button>
    </section>:null}
    {!resultOnly&&detail.status!=="cancelled"&&detail.status!=="confirmed"?<button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>{if(window.confirm("新しい取得を止めます。送信済み分は無料にならず、消費照合を続けます。取消しますか？"))void run("cancel",{expectedLockVersion:detail.lockVersion});}}>取得を取消</button>:null}
  </section>;
  function runActionNext(target: EbayMarket) { return run("next-page",{expectedLockVersion:detail!.lockVersion,market:target,consumptionConfirmed:true}); }
}
