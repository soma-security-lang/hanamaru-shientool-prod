"use client";

import {usePathname,useRouter,useSearchParams} from "next/navigation";
import Image from "next/image";
import {AlertTriangle,ArrowLeft,ArrowRight,Camera,Check,CheckCircle2,Clock3,History,ImagePlus,Info,Keyboard,LoaderCircle,RefreshCw,RotateCcw,Search,ShieldAlert,SlidersHorizontal,Sparkles,X} from "lucide-react";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {MarketPriceCandidateDto,MarketPriceIdentificationDto,MarketPriceIdentificationFields,MarketPriceInputMode,MarketPriceOptionsDto,MarketPriceOutlierPolicy,MarketPriceProductCandidate,MarketPriceSearchDto,MarketPriceSearchQuery,MarketPriceStatisticsDto,ProductCondition} from "@hanamaru/contracts";
import {ApiClientError} from "@/lib/api/client";
import {resources} from "@/lib/api/resources";
import styles from "./MarketPriceExperience.module.css";

type View="input"|"identify"|"progress"|"candidates"|"result"|"history";
type Draft={inputMode:MarketPriceInputMode;productName:string;category:string;brand:string;modelNumber:string;searchKeyword:string;excludeKeywords:string;conditions:ProductCondition[]};

const views:ReadonlyArray<{value:View;label:string}>=[
  {value:"input",label:"商品入力"},{value:"identify",label:"検索条件"},{value:"progress",label:"取得状況"},
  {value:"candidates",label:"候補確認"},{value:"result",label:"相場結果"},{value:"history",label:"履歴"},
];
const terminalStatuses=new Set(["ready","partial","blocked","failed","cancelled","confirmed"]);
const yen=new Intl.NumberFormat("ja-JP",{style:"currency",currency:"JPY",maximumFractionDigits:0});
const dateTime=new Intl.DateTimeFormat("ja-JP",{dateStyle:"medium",timeStyle:"short"});
const initialDraft:Draft={inputMode:"image_assisted",productName:"",category:"",brand:"",modelNumber:"",searchKeyword:"",excludeKeywords:"",conditions:["near_unused","good","fair"]};

function errorMessage(error:unknown){
  if(error instanceof ApiClientError)return error.message;
  return error instanceof Error?error.message:"処理を完了できませんでした。もう一度お試しください。";
}
function splitKeywords(value:string){return[...new Set(value.split(/[、,\n]/u).map(item=>item.normalize("NFKC").trim()).filter(Boolean))].slice(0,20);}
function randomQueryId(){return typeof crypto!=="undefined"&&"randomUUID" in crypto?crypto.randomUUID():`query-${Date.now()}`;}
function statusLabel(status:string){return({queued:"検索待ち",planning:"検索条件を準備中",fetching:"落札候補を取得中",normalizing:"候補を整理中",review_required:"確認待ち",ready:"取得完了",partial:"一部取得",blocked:"安全のため停止",failed:"取得失敗",cancelled:"取消済み",confirmed:"確定済み"}[status]??status);}
function conditionLabel(value:ProductCondition,options?:MarketPriceOptionsDto){return options?.conditions.find(item=>item.value===value)?.label??value;}
function reasonLabel(value:string){return({exclude_keyword:"除外語",keyword_excluded:"除外語",condition:"状態不一致",condition_mismatch:"状態不一致",price_outlier:"価格外れ値",period:"期間外",outside_period:"期間外",product_mismatch:"商品一致度",low_similarity:"商品一致度",source_type:"取得元種別"}[value]??value);}
function median(values:number[]){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]!:((sorted[middle-1]!+sorted[middle]!)/2);}
function candidateStatistics(candidates:MarketPriceCandidateDto[]):MarketPriceStatisticsDto{
  const included=candidates.filter(candidate=>candidate.included);const preOutlier=candidates.filter(candidate=>candidate.exclusionReasons.every(reason=>reason==="price_outlier"));const exclusionCounts:Record<string,number>={};
  for(const candidate of candidates)for(const reason of candidate.exclusionReasons)exclusionCounts[reason]=(exclusionCounts[reason]??0)+1;
  return{candidateCount:candidates.length,includedCount:included.length,minimumPrice:included.length?Math.min(...included.map(candidate=>candidate.closingPrice)):null,medianPriceBeforeOutlierExclusion:median(preOutlier.map(candidate=>candidate.closingPrice)),medianPrice:median(included.map(candidate=>candidate.closingPrice)),maximumPrice:included.length?Math.max(...included.map(candidate=>candidate.closingPrice)):null,exclusionCounts};
}
function withCandidateStatistics(search:MarketPriceSearchDto,candidates:MarketPriceCandidateDto[],policy=search.outlierPolicy):MarketPriceSearchDto{return{...search,...candidateStatistics(candidates),candidates,outlierPolicy:policy};}
function previewOutlierPolicy(search:MarketPriceSearchDto,policy:MarketPriceOutlierPolicy){
  const candidates=search.candidates.map(candidate=>{const baseReasons=candidate.exclusionReasons.filter(reason=>reason!=="price_outlier");const outOfIqr=candidate.iqrLowerBound!=null&&candidate.iqrUpperBound!=null&&(candidate.closingPrice<candidate.iqrLowerBound||candidate.closingPrice>candidate.iqrUpperBound);const autoOutlier=baseReasons.length===0&&policy.enabled&&candidate.conditionGroupCount>=policy.minimumGroupSize&&candidate.priceDeviationRate!=null&&candidate.priceDeviationRate>policy.deviationThreshold&&outOfIqr;const exclusionReasons=autoOutlier?[...baseReasons,"price_outlier"]:baseReasons;const included=candidate.inclusionOverride==="include"?true:candidate.inclusionOverride==="exclude"?false:exclusionReasons.length===0;return{...candidate,autoOutlier,exclusionReasons,included};});
  return withCandidateStatistics(search,candidates,policy);
}

export function MarketPriceExperience(){
  const router=useRouter();const pathname=usePathname();const params=useSearchParams();
  const view=(views.some(item=>item.value===params.get("view"))?params.get("view"):"input") as View;
  const searchId=params.get("searchId")??"";
  const activeStepIndex=Math.max(0,views.slice(0,5).findIndex(item=>item.value===view));
  const [draft,setDraft]=useState<Draft>(initialDraft);
  const [files,setFiles]=useState<File[]>([]);
  const [options,setOptions]=useState<MarketPriceOptionsDto>();
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const hasUnsavedInput=files.length>0||JSON.stringify(draft)!==JSON.stringify(initialDraft);

  useEffect(()=>{let active=true;void resources.marketPriceOptions().then(value=>{if(active)setOptions(value);}).catch(reason=>{if(active)setError(errorMessage(reason));});return()=>{active=false;};},[]);
  useEffect(()=>{
    if(view!=="input"||!hasUnsavedInput||busy)return;
    const message="入力中の商品情報と画像は保存されません。画面を移動しますか？";
    const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    const interceptLink=(event:MouseEvent)=>{
      const target=event.target instanceof Element?event.target.closest<HTMLAnchorElement>("a[href]"):null;
      if(!target||target.target==="_blank"||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const destination=new URL(target.href,window.location.href);
      if(destination.href===window.location.href||window.confirm(message))return;
      event.preventDefault();event.stopPropagation();
    };
    window.addEventListener("beforeunload",beforeUnload);
    document.addEventListener("click",interceptLink,true);
    return()=>{window.removeEventListener("beforeunload",beforeUnload);document.removeEventListener("click",interceptLink,true);};
  },[busy,hasUnsavedInput,view]);
  function go(next:View,id?:string,mode:"push"|"replace"="push"){
    const nextParams=new URLSearchParams();nextParams.set("view",next);if(id)nextParams.set("searchId",id);
    router[mode](`${pathname}?${nextParams.toString()}`,{scroll:false});
  }
  const common={go,searchId,options,setGlobalError:setError};
  return <section className={styles.feature}>
    <header className={styles.title}><div><span>参考相場・直近90日</span><h1>買取相場（仮）</h1><p>商品と検索条件を確認し、採用する落札候補から相場を確定します。</p></div><button type="button" className={styles.historyButton} aria-label="検索履歴" onClick={()=>go("history")}><History size={18}/><span className={styles.historyText}>検索履歴</span></button></header>
    {view!=="history"?<><p className={styles.mobileStepSummary}>手順 {activeStepIndex+1}/5：{views[activeStepIndex]?.label}</p><nav className={styles.steps} aria-label="相場検索の手順">{views.slice(0,5).map((item,index)=><button type="button" key={item.value} aria-current={view===item.value?"step":undefined} data-active={view===item.value} data-complete={index<activeStepIndex} onClick={()=>{if(item.value==="input")go("input");else if(searchId)go(item.value,searchId);}} disabled={item.value!=="input"&&!searchId}><span className={styles.stepNumber}>{index<activeStepIndex?<Check size={14}/>:index+1}</span><span className={styles.stepLabel}>{item.label}</span></button>)}</nav></>:null}
    {error?<div className={styles.error} role="alert"><AlertTriangle size={22}/><span><strong>処理を完了できませんでした</strong><small>{error}</small></span><button type="button" aria-label="エラーを閉じる" onClick={()=>setError("")}><X size={18}/></button></div>:null}
    {view==="input"?<InputView draft={draft} setDraft={setDraft} files={files} setFiles={setFiles} options={options} busy={busy} setBusy={setBusy} go={go} setError={setError}/>:null}
    {view==="identify"?<IdentificationView {...common}/>:null}
    {view==="progress"?<ProgressView {...common}/>:null}
    {view==="candidates"?<CandidatesView {...common}/>:null}
    {view==="result"?<ResultView {...common}/>:null}
    {view==="history"?<HistoryView go={go}/>:null}
  </section>;
}

function InputView({draft,setDraft,files,setFiles,options,busy,setBusy,go,setError}:{draft:Draft;setDraft:React.Dispatch<React.SetStateAction<Draft>>;files:File[];setFiles:React.Dispatch<React.SetStateAction<File[]>>;options?:MarketPriceOptionsDto;busy:boolean;setBusy:(value:boolean)=>void;go:(view:View,id?:string,mode?:"push"|"replace")=>void;setError:(value:string)=>void}){
  const previews=useMemo(()=>files.map(file=>({file,url:URL.createObjectURL(file)})),[files]);
  useEffect(()=>()=>previews.forEach(item=>URL.revokeObjectURL(item.url)),[previews]);
  const fileInput=useRef<HTMLInputElement>(null);
  const composing=useRef(false);
  const modes=[
    {value:"image_assisted" as const,title:"画像＋AI補助",body:"写真から商品候補と検索語を提案",icon:Camera},
    {value:"manual_assisted" as const,title:"手入力＋AI補助",body:"入力内容から検索条件を提案",icon:Sparkles},
    {value:"manual_direct" as const,title:"手入力のみ",body:"入力した検索語をそのまま確認",icon:Keyboard},
  ];
  function toggleCondition(value:ProductCondition){setDraft(current=>{
    if(value==="unspecified")return{...current,conditions:["unspecified"]};
    const active=current.conditions.filter(item=>item!=="unspecified");
    const next=active.includes(value)?active.filter(item=>item!==value):[...active,value];
    return{...current,conditions:next.length?next:["unspecified"]};
  });}
  function addFiles(incoming:FileList|null){if(!incoming)return;setError("");const accepted=Array.from(incoming);const next=[...files];for(const file of accepted){if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setError("JPEG、PNG、WebP画像だけ追加できます。");continue;}if(file.size>(options?.limits.imageBytes??10_485_760)){setError("画像は1枚10MB以下にしてください。");continue;}if(next.some(item=>item.name===file.name&&item.size===file.size&&item.lastModified===file.lastModified)){setError("同じ画像はすでに追加されています。");continue;}next.push(file);}if(next.length>5){setError("画像は最大5枚です。");return;}if(next.reduce((sum,file)=>sum+file.size,0)>(options?.limits.totalImageBytes??52_428_800)){setError("画像の合計は50MB以下にしてください。");return;}setFiles(next);}
  async function submit(event:React.FormEvent){event.preventDefault();setError("");if(draft.inputMode==="image_assisted"&&!files.length){setError("商品画像を1枚以上追加してください。");fileInput.current?.focus();return;}if(draft.inputMode!=="image_assisted"&&!draft.productName.trim()){setError("商品名を入力してください。");return;}setBusy(true);try{
      const query=draft.searchKeyword.trim()?{id:randomQueryId(),keyword:draft.searchKeyword.trim(),breadth:"standard",source:"user",decision:draft.inputMode==="manual_direct"?"accepted":"pending"}:undefined;
      const identification=await resources.createMarketPriceIdentification({inputMode:draft.inputMode,productName:draft.productName,category:draft.category||null,brand:draft.brand||null,modelNumber:draft.modelNumber||null,attributes:{},searchQueries:query?[query]:[],excludeKeywords:splitKeywords(draft.excludeKeywords),conditions:draft.conditions});
      for(const file of files)await resources.uploadMarketPriceImage(identification.id,file);
      if(draft.inputMode!=="manual_direct")await resources.analyzeMarketPriceIdentification(identification.id);
      go("identify",identification.id,"replace");
    }catch(reason){setError(errorMessage(reason));}finally{setBusy(false);}}
  return <form className={styles.inputLayout} onSubmit={submit} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{if(event.key==="Enter"&&(composing.current||event.nativeEvent.isComposing))event.preventDefault();}}>
    <section className={`${styles.panel} ${styles.methodPanel}`}><header><span>入力方法</span><h2>商品をどのように特定しますか</h2></header><div className={styles.modeGrid}>{modes.map(mode=>{const ModeIcon=mode.icon;return <label key={mode.value} data-selected={draft.inputMode===mode.value}><input type="radio" name="inputMode" checked={draft.inputMode===mode.value} onChange={()=>setDraft(current=>({...current,inputMode:mode.value}))}/><ModeIcon size={20}/><span className={styles.modeCopy}><strong>{mode.title}</strong><small>{mode.body}</small></span></label>;})}</div>
      {draft.inputMode==="image_assisted"?<div className={styles.imageArea}><div><h3>商品画像</h3><p>全体、ロゴ、型番、傷の状態が分かる写真を最大5枚まで追加できます。</p></div><input ref={fileInput} className={styles.visuallyHidden} type="file" aria-label="商品画像ファイルを選択" accept="image/jpeg,image/png,image/webp" multiple onChange={event=>{addFiles(event.target.files);event.currentTarget.value="";}}/><button type="button" className={styles.uploadButton} onClick={()=>fileInput.current?.click()}><ImagePlus size={20}/>画像を追加</button>{previews.length?<div className={styles.previewGrid}>{previews.map((item,index)=><figure key={`${item.file.name}-${item.file.lastModified}`}><Image src={item.url} alt={`商品画像 ${index+1}`} fill unoptimized sizes="(max-width: 768px) 30vw, 10vw"/><button type="button" aria-label={`商品画像 ${index+1}を削除`} onClick={()=>setFiles(current=>current.filter(file=>file!==item.file))}><X size={16}/></button></figure>)}</div>:<div className={styles.emptyImages}><Camera size={26}/><span>まだ画像はありません</span></div>}</div>:null}
    </section>
    <section className={styles.panel}><header><span>商品情報</span><h2>{draft.inputMode==="image_assisted"?"分かる範囲で補足":"商品情報を入力"}</h2></header><div className={styles.formGrid}><label className={styles.wide}>商品名<span>{draft.inputMode!=="image_assisted"?"必須":"任意"}</span><input value={draft.productName} onChange={event=>setDraft(current=>({...current,productName:event.target.value}))} placeholder="例：Canon EOS R6 ボディ" required={draft.inputMode!=="image_assisted"}/></label><label>ブランド<input value={draft.brand} onChange={event=>setDraft(current=>({...current,brand:event.target.value}))} placeholder="例：Canon"/></label><label>型番<input value={draft.modelNumber} onChange={event=>setDraft(current=>({...current,modelNumber:event.target.value}))} placeholder="例：EOS R6"/></label><label>カテゴリ<input value={draft.category} onChange={event=>setDraft(current=>({...current,category:event.target.value}))} placeholder="例：デジタルカメラ"/></label><label>検索キーワード<span>任意</span><input value={draft.searchKeyword} onChange={event=>setDraft(current=>({...current,searchKeyword:event.target.value}))} placeholder="AI補助の場合も指定可能"/></label><label className={styles.wide}>除外キーワード<span>任意・カンマ区切り</span><input value={draft.excludeKeywords} onChange={event=>setDraft(current=>({...current,excludeKeywords:event.target.value}))} placeholder="ジャンク、部品、箱のみ"/></label></div></section>
    <section className={`${styles.panel} ${styles.conditionsPanel}`}><header><span>商品状態</span><h2>検索対象に含める状態 <em>※必須</em></h2><p>複数選択できます。AIの提案は次の画面で確認し、自動では追加されません。</p></header><div className={styles.guidance}><Info size={20}/><p>状態が分からない場合は「指定なし」を選択してください。選択した状態はYahoo!オークションの取得条件に使われます。</p></div><fieldset><legend className={styles.visuallyHidden}>商品状態</legend>{(options?.conditions??[]).map(item=><label key={item.value} data-selected={draft.conditions.includes(item.value)}><input type="checkbox" checked={draft.conditions.includes(item.value)} onChange={()=>toggleCondition(item.value)}/><span>{item.label}</span></label>)}</fieldset></section>
    <footer className={styles.stickyAction}><span>{draft.inputMode==="manual_direct"?"入力内容を確認してから取得します":"AIの提案を確認してから取得します"}</span><button className={styles.primaryButton} disabled={busy}>{busy?<LoaderCircle className={styles.spin} size={18}/>:null}{busy?"準備中…":"検索条件を確認"}<ArrowRight size={18}/></button></footer>
  </form>;
}

function IdentificationView({searchId,options,go,setGlobalError}:{searchId:string;options?:MarketPriceOptionsDto;go:(view:View,id?:string,mode?:"push"|"replace")=>void;setGlobalError:(value:string)=>void}){
  const [item,setItem]=useState<MarketPriceIdentificationDto>();const [fields,setFields]=useState<MarketPriceIdentificationFields>();const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{if(!searchId)return;try{const value=await resources.marketPriceIdentification(searchId);setItem(value);setFields(current=>current??value.input);if(value.status==="analyzing")return false;return true;}catch(reason){setGlobalError(errorMessage(reason));return true;}},[searchId,setGlobalError]);
  useEffect(()=>{let active=true;let timer=0;async function poll(){const done=await load();if(active&&!done)timer=window.setTimeout(poll,document.visibilityState==="visible"?2000:10000);}void poll();return()=>{active=false;window.clearTimeout(timer);};},[load]);
  if(!searchId)return <EmptyState title="商品特定IDがありません" body="商品入力からやり直してください。" action={()=>go("input")}/>;
  if(!item||!fields)return <LoadingState title="商品情報を読み込んでいます"/>;
  if(item.status==="analyzing")return <LoadingState title="AIが商品と検索条件を整理しています" body="画面を閉じても処理は続きます。完了時に自動で表示を更新します。"/>;
  const identification=item;const currentFields=fields;
  const setQuery=(selected:MarketPriceSearchQuery)=>setFields(current=>current?({...current,searchQueries:[...current.searchQueries,...identification.suggestions.searchQueries.filter(candidate=>!current.searchQueries.some(existing=>existing.id===candidate.id))].map(query=>({...query,decision:query.id===selected.id?"accepted":"rejected"}))}):current);
  const candidates=identification.suggestions.productCandidates;
  function decideCandidate(candidate:MarketPriceProductCandidate,decision:"accepted"|"rejected"){
    setItem(current=>current?({...current,suggestions:{...current.suggestions,productCandidates:current.suggestions.productCandidates.map(item=>({...item,decision:item.id===candidate.id?decision:decision==="accepted"?"rejected":item.decision}))}}):current);
    if(decision==="accepted")setFields(current=>current?({...current,productName:candidate.productName,category:candidate.category,brand:candidate.brand,modelNumber:candidate.modelNumber,attributes:candidate.attributes}):current);
  }
  async function confirm(){setGlobalError("");const selected=currentFields.searchQueries.filter(query=>query.decision==="accepted");if(selected.length!==1){setGlobalError("検索キーワードを1件だけ選択してください。");return;}if(!currentFields.conditions.length){setGlobalError("商品の状態を1件以上選択してください。");return;}setBusy(true);try{const updated=await resources.updateMarketPriceIdentification(searchId,identification.lockVersion,currentFields,candidates);await resources.confirmMarketPriceIdentification(searchId,updated.lockVersion);const created=await resources.createMarketPriceSearch({identificationId:searchId,selectedSearchQueryId:selected[0]!.id,conditions:currentFields.conditions,outlierPolicy:{enabled:true,deviationThreshold:.2,minimumGroupSize:5}});go("progress",created.searchId,"replace");}catch(reason){setGlobalError(errorMessage(reason));await load();}finally{setBusy(false);}}
  const allQueries=[...currentFields.searchQueries,...identification.suggestions.searchQueries.filter(candidate=>!currentFields.searchQueries.some(existing=>existing.id===candidate.id))];
  return <div className={styles.identifyLayout}>
    <section className={styles.panel}><header><span>利用者入力</span><h2>商品情報</h2><p>AI提案を採用しても、ここで自由に修正できます。</p></header><div className={styles.formStack}><label>商品名<input value={fields.productName} onChange={event=>setFields({...fields,productName:event.target.value})}/></label><label>ブランド<input value={fields.brand??""} onChange={event=>setFields({...fields,brand:event.target.value||null})}/></label><label>型番<input value={fields.modelNumber??""} onChange={event=>setFields({...fields,modelNumber:event.target.value||null})}/></label><label>カテゴリ<input value={fields.category??""} onChange={event=>setFields({...fields,category:event.target.value||null})}/></label><label>除外キーワード<input value={fields.excludeKeywords.join("、")} onChange={event=>setFields({...fields,excludeKeywords:splitKeywords(event.target.value)})}/></label></div><fieldset className={styles.compactConditions}><legend>商品状態</legend>{options?.conditions.map(option=><label key={option.value}><input type="checkbox" checked={fields.conditions.includes(option.value)} onChange={()=>{const next=option.value==="unspecified"?["unspecified" as const]:fields.conditions.includes(option.value)?fields.conditions.filter(value=>value!==option.value):[...fields.conditions.filter(value=>value!=="unspecified"),option.value];setFields({...fields,conditions:next.length?next:["unspecified"]});}}/>{option.label}</label>)}</fieldset></section>
    <section className={styles.panel}><header><span>AI補助</span><h2>商品候補</h2><p>提案は自動適用されません。採用・編集・却下を利用者が決めます。</p></header>{candidates.length?<div className={styles.suggestionList}>{candidates.map(candidate=><article key={candidate.id} data-decision={candidate.decision}><div><strong>{candidate.productName}</strong><small>{[candidate.brand,candidate.modelNumber,candidate.category].filter(Boolean).join(" / ")}</small><span>確度 {Math.round(candidate.confidence*100)}%・{candidate.decision==="accepted"?"採用済み":candidate.decision==="rejected"?"却下済み":"未確認"}</span></div><div className={styles.suggestionActions}><button type="button" onClick={()=>decideCandidate(candidate,"accepted")}>{candidate.decision==="accepted"?"採用中":"採用して編集"}</button><button type="button" onClick={()=>decideCandidate(candidate,"rejected")}>却下</button></div></article>)}</div>:<p className={styles.muted}>商品候補はありません。左の入力内容を使用します。</p>}{item.suggestions.warnings.map(warning=><p className={styles.warningText} key={warning}><AlertTriangle size={17}/>{warning}</p>)}</section>
    <section className={styles.panel}><header><span>検索条件</span><h2>検索キーワードを1件選択</h2><p>選択した1件だけでYahoo!オークションの落札相場を取得します。</p></header><div className={styles.queryList}>{allQueries.map(query=><label key={query.id} data-selected={query.decision==="accepted"}><input type="radio" name="query" checked={query.decision==="accepted"} onChange={()=>setQuery(query)}/><span><strong>{query.keyword}</strong><small>{query.source==="ai"?"AI提案":query.source==="edited"?"編集済み":"利用者入力"}・{query.breadth==="strict"?"厳密":query.breadth==="broad"?"広め":"標準"}</small></span></label>)}</div>{fields.searchQueries.filter(query=>query.decision==="accepted").map(query=><label className={styles.editQuery} key={query.id}>選択中の検索キーワード<input value={query.keyword} onChange={event=>setFields({...fields,searchQueries:fields.searchQueries.map(item=>item.id===query.id?{...item,keyword:event.target.value,source:"edited"}:item)})}/></label>)}</section>
    <footer className={styles.stickyAction}><button type="button" className={styles.secondaryButton} onClick={()=>go("input")}><ArrowLeft size={18}/>入力へ戻る</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={()=>void confirm()}>{busy?<LoaderCircle className={styles.spin} size={18}/>:<Search size={18}/>}直近90日を検索</button></footer>
  </div>;
}

function ProgressView({searchId,go,setGlobalError}:{searchId:string;options?:MarketPriceOptionsDto;go:(view:View,id?:string,mode?:"push"|"replace")=>void;setGlobalError:(value:string)=>void}){
  const [item,setItem]=useState<MarketPriceSearchDto>();const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{if(!searchId)return true;try{const value=await resources.marketPriceSearch(searchId);setItem(value);if(["ready","partial","confirmed"].includes(value.status)){go(value.status==="confirmed"?"result":"candidates",value.id,"replace");return true;}return terminalStatuses.has(value.status);}catch(reason){setGlobalError(errorMessage(reason));return true;}},[searchId,go,setGlobalError]);
  useEffect(()=>{let active=true;let timer=0;async function poll(){const done=await load();if(active&&!done)timer=window.setTimeout(poll,document.visibilityState==="visible"?2000:10000);}void poll();return()=>{active=false;window.clearTimeout(timer);};},[load]);
  async function act(kind:"retry"|"cancel"){if(!item)return;setBusy(true);try{if(kind==="retry")await resources.retryMarketPriceSearch(item.id);else await resources.cancelMarketPriceSearch(item.id);await load();}catch(reason){setGlobalError(errorMessage(reason));}finally{setBusy(false);}}
  if(!searchId)return <EmptyState title="検索IDがありません" body="商品入力から検索を始めてください。" action={()=>go("input")}/>;
  if(!item)return <LoadingState title="検索状態を確認しています"/>;
  const stages=["検索条件を検証","落札候補を取得","候補を正規化","集計結果を準備"];
  return <section className={styles.progressPanel}><div className={styles.statusIcon} data-status={item.status}>{item.status==="blocked"||item.status==="failed"?<ShieldAlert size={30}/>:item.status==="cancelled"?<X size={30}/>:<LoaderCircle className={!terminalStatuses.has(item.status)?styles.spin:undefined} size={30}/>}</div><span>{statusLabel(item.status)}</span><h2>{item.status==="blocked"?"安全のため取得を停止しました":item.status==="failed"?"取得を完了できませんでした":item.status==="cancelled"?"検索を取り消しました":"落札相場を確認しています"}</h2><p>取得件数ではなく実際の処理状態を表示しています。画面を閉じても処理は続きます。</p><ol>{stages.map((stage,index)=><li key={stage} data-active={index<=(["queued","planning"].includes(item.status)?0:item.status==="fetching"?1:item.status==="normalizing"?2:3)}><Check size={17}/><span>{stage}</span></li>)}</ol>{item.failureClass?<p className={styles.failure}>停止理由: {item.failureClass}</p>:null}<div className={styles.actionRow}>{["blocked","failed"].includes(item.status)?<button type="button" className={styles.primaryButton} disabled={busy} onClick={()=>void act("retry")}><RefreshCw size={18}/>途中から再試行</button>:null}{!["blocked","failed","cancelled"].includes(item.status)?<button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>void act("cancel")}>検索を取り消す</button>:null}<button type="button" className={styles.secondaryButton} onClick={()=>go("history")}>履歴を見る</button></div></section>;
}

function CandidatesView({searchId,options,go,setGlobalError}:{searchId:string;options?:MarketPriceOptionsDto;go:(view:View,id?:string,mode?:"push"|"replace")=>void;setGlobalError:(value:string)=>void}){
  const [item,setItem]=useState<MarketPriceSearchDto>();const [filter,setFilter]=useState<"all"|"included"|"excluded">("all");const [policy,setPolicy]=useState<MarketPriceOutlierPolicy>({enabled:true,deviationThreshold:.2,minimumGroupSize:5});const [busy,setBusy]=useState("");
  const load=useCallback(async()=>{if(!searchId)return;try{const value=await resources.marketPriceSearch(searchId);setItem(value);setPolicy(value.outlierPolicy);}catch(reason){setGlobalError(errorMessage(reason));}},[searchId,setGlobalError]);
  useEffect(()=>{let active=true;if(!searchId)return;void resources.marketPriceSearch(searchId).then(value=>{if(active){setItem(value);setPolicy(value.outlierPolicy);}}).catch(reason=>{if(active)setGlobalError(errorMessage(reason));});return()=>{active=false;};},[searchId,setGlobalError]);
  useEffect(()=>{if(item?.status==="confirmed")go("result",item.id,"replace");},[item?.id,item?.status,go]);
  if(!searchId)return <EmptyState title="検索IDがありません" body="履歴から検索結果を選択してください。" action={()=>go("history")}/>;
  if(!item)return <LoadingState title="落札候補を読み込んでいます"/>;
  if(!["ready","partial","review_required","confirmed"].includes(item.status))return <EmptyState title="候補を確認できる状態ではありません" body={`現在の状態: ${statusLabel(item.status)}`} action={()=>go("progress",item.id)}/>;
  if(item.status==="confirmed")return <LoadingState title="確定した相場を読み込んでいます"/>;
  const search=item;const candidates=search.candidates.filter(candidate=>filter==="all"||(filter==="included"?candidate.included:!candidate.included));
  async function toggle(candidateId:string,included:boolean){if(busy)return;const decision=included?"exclude":"include";setItem(current=>current?withCandidateStatistics(current,current.candidates.map(candidate=>candidate.id===candidateId?{...candidate,inclusionOverride:decision,included:!included,decisionSource:"manual"}:candidate)):current);setBusy(candidateId);try{await resources.overrideMarketPriceCandidate(search.id,candidateId,decision);await load();}catch(reason){setGlobalError(errorMessage(reason));await load();}finally{setBusy("");}}
  async function applyPolicy(){if(busy)return;setItem(current=>current?previewOutlierPolicy(current,policy):current);setBusy("policy");try{await resources.updateMarketPriceOutlierPolicy(search.id,policy);await load();}catch(reason){setGlobalError(errorMessage(reason));await load();}finally{setBusy("");}}
  async function confirm(){if(busy)return;setBusy("confirm");try{const latest=await resources.marketPriceSearch(search.id);await resources.confirmMarketPriceSearch(search.id,latest.lockVersion);go("result",search.id,"replace");}catch(reason){setGlobalError(errorMessage(reason));await load();}finally{setBusy("");}}
  return <div className={styles.candidateWorkspace}>
    <aside className={styles.filterPanel}><header><SlidersHorizontal size={20}/><div><span>検索条件</span><h2>候補を絞り込む</h2></div></header><dl><div><dt>期間</dt><dd>{new Date(item.periodStart).toLocaleDateString("ja-JP")}〜{new Date(item.periodEnd).toLocaleDateString("ja-JP")}</dd></div><div><dt>商品状態</dt><dd>{item.conditions.map(value=>conditionLabel(value,options)).join("、")}</dd></div><div><dt>取得完全性</dt><dd>{item.coverageStatus==="complete"?"直近90日の取得完了":"一部の取得結果"}</dd></div></dl><fieldset><legend>候補の表示</legend>{(["all","included","excluded"] as const).map(value=><label key={value}><input type="radio" checked={filter===value} onChange={()=>setFilter(value)}/>{value==="all"?"すべて":value==="included"?"集計対象":"除外"}</label>)}</fieldset><div className={styles.policy}><label><input type="checkbox" checked={policy.enabled} onChange={event=>setPolicy({...policy,enabled:event.target.checked})}/>価格外れ値を自動除外</label><label>中央値からの乖離率<strong>{Math.round(policy.deviationThreshold*100)}%</strong><input type="range" min="5" max="100" step="5" value={Math.round(policy.deviationThreshold*100)} onChange={event=>setPolicy({...policy,deviationThreshold:Number(event.target.value)/100})}/></label><small>同一状態が{policy.minimumGroupSize}件以上ある場合に判定します。</small><button type="button" onClick={()=>void applyPolicy()} disabled={Boolean(busy)}>{busy==="policy"?"再計算中…":"基準を再適用"}</button></div></aside>
    <section className={styles.candidatePanel}>
      <header><div><span>{item.candidateCount}件を取得</span><h2>落札候補を確認</h2><p>誤一致や外れ値を確認し、集計対象を切り替えられます。</p></div><div className={styles.segmented}>{(["all","included","excluded"] as const).map(value=><button type="button" key={value} data-active={filter===value} onClick={()=>setFilter(value)}>{value==="all"?"全件":value==="included"?"採用":"除外"}</button>)}</div></header>
      {item.coverageStatus!=="complete"?<div className={styles.partial}><AlertTriangle size={22}/><span><strong>一部の取得結果です</strong><small>直近90日の取得完了は確認できていません。取得できた範囲の参考値として確認してください。</small></span></div>:null}
      {candidates.length?<>
        <div className={styles.candidateTableWrap}>
          <table className={styles.candidateTable}>
            <caption>取得した落札候補と集計対象の判定</caption>
            <thead><tr><th scope="col">落札商品</th><th scope="col">落札価格</th><th scope="col">集計判定</th><th scope="col">操作</th></tr></thead>
            <tbody>{candidates.map(candidate=><tr key={candidate.id} data-included={candidate.included}>
              <td><span className={styles.stateBadge}>{conditionLabel(candidate.normalizedCondition,options)}</span><strong>{candidate.title}</strong><small>{candidate.matchReasons.join("・")||"検索条件に一致"}・{new Date(candidate.endedAt).toLocaleDateString("ja-JP")}終了</small></td>
              <td><strong>{yen.format(candidate.closingPrice)}</strong>{candidate.priceDeviationRate!=null?<small>中央値差 {Math.round(candidate.priceDeviationRate*100)}%</small>:null}</td>
              <td>{candidate.exclusionReasons.length?<span>{candidate.exclusionReasons.map(reasonLabel).join("・")}</span>:<span>自動採用</span>}</td>
              <td><button type="button" disabled={Boolean(busy)} onClick={()=>void toggle(candidate.id,candidate.included)}>{candidate.included?"集計から除外":"集計へ戻す"}</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.candidateCards}>{candidates.map(candidate=><article key={candidate.id} data-included={candidate.included}><div className={styles.candidateMain}><span className={styles.stateBadge}>{conditionLabel(candidate.normalizedCondition,options)}</span><h3>{candidate.title}</h3><p>{candidate.matchReasons.join("・")||"検索条件に一致"}</p><small>{new Date(candidate.endedAt).toLocaleDateString("ja-JP")} 終了</small></div><div className={styles.candidatePrice}><strong>{yen.format(candidate.closingPrice)}</strong>{candidate.priceDeviationRate!=null?<small>中央値差 {Math.round(candidate.priceDeviationRate*100)}%</small>:null}</div><div className={styles.candidateDecision}>{candidate.exclusionReasons.length?<small>{candidate.exclusionReasons.map(reasonLabel).join("・")}</small>:<small>自動採用</small>}<button type="button" disabled={Boolean(busy)} onClick={()=>void toggle(candidate.id,candidate.included)}>{candidate.included?"集計から除外":"集計へ戻す"}</button></div></article>)}</div>
      </>:<p className={styles.emptyList}>条件に一致する候補はありません。</p>}
    </section>
    <aside className={styles.summaryPanel}><span>現在の集計</span><h2>{item.medianPrice==null?"—":yen.format(item.medianPrice)}</h2><p>中央値</p><dl><div><dt>最低価格</dt><dd>{item.minimumPrice==null?"—":yen.format(item.minimumPrice)}</dd></div><div><dt>最高価格</dt><dd>{item.maximumPrice==null?"—":yen.format(item.maximumPrice)}</dd></div><div><dt>採用件数</dt><dd>{item.includedCount}件</dd></div><div><dt>除外件数</dt><dd>{Math.max(0,item.candidateCount-item.includedCount)}件</dd></div></dl><button type="button" className={styles.primaryButton} disabled={Boolean(busy)||item.includedCount<1} onClick={()=>void confirm()}><CheckCircle2 size={18}/>{busy==="confirm"?"確定中…":"この相場を確定"}</button></aside>
  </div>;
}

function ResultView({searchId,go,setGlobalError}:{searchId:string;options?:MarketPriceOptionsDto;go:(view:View,id?:string,mode?:"push"|"replace")=>void;setGlobalError:(value:string)=>void}){
  const [item,setItem]=useState<MarketPriceSearchDto>();const [busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;if(!searchId)return;void resources.marketPriceSearch(searchId).then(value=>{if(active)setItem(value);}).catch(reason=>{if(active)setGlobalError(errorMessage(reason));});return()=>{active=false;};},[searchId,setGlobalError]);
  async function repeat(){if(!item)return;setBusy(true);try{const next=await resources.repeatMarketPriceSearch(item.id);go("progress",next.searchId,"replace");}catch(reason){setGlobalError(errorMessage(reason));}finally{setBusy(false);}}
  if(!item)return <LoadingState title="相場結果を読み込んでいます"/>;
  if(item.status!=="confirmed")return <EmptyState title="相場はまだ確定されていません" body="落札候補を確認して相場を確定してください。" action={()=>go("candidates",item.id)}/>;
  const automaticExclusions=Object.entries(item.exclusionCounts).filter(([,count])=>count>0).map(([reason,count])=>`${reasonLabel(reason)} ${count}件`);const manualExclusions=item.candidates.filter(candidate=>candidate.inclusionOverride==="exclude").length;const exclusionSummary=[...automaticExclusions,...(manualExclusions?[`手動 ${manualExclusions}件`]:[])].join("、")||"なし";
  return <section className={styles.resultPanel}><div className={styles.resultCheck}><CheckCircle2 size={34}/></div><span>相場を確定しました</span><h2>{item.medianPrice==null?"—":yen.format(item.medianPrice)}</h2><p>直近90日の落札候補から算出した中央値</p><div className={styles.resultStats}><article><span>最低価格</span><strong>{item.minimumPrice==null?"—":yen.format(item.minimumPrice)}</strong></article><article><span>除外前中央値</span><strong>{item.medianPriceBeforeOutlierExclusion==null?"—":yen.format(item.medianPriceBeforeOutlierExclusion)}</strong></article><article><span>中央値</span><strong>{item.medianPrice==null?"—":yen.format(item.medianPrice)}</strong></article><article><span>最高価格</span><strong>{item.maximumPrice==null?"—":yen.format(item.maximumPrice)}</strong></article><article><span>採用件数</span><strong>{item.includedCount}件</strong></article></div><dl className={styles.resultMeta}><div><dt>取得期間</dt><dd>{new Date(item.periodStart).toLocaleDateString("ja-JP")}〜{new Date(item.periodEnd).toLocaleDateString("ja-JP")}</dd></div><div><dt>完全性</dt><dd>{item.coverageStatus==="complete"?"直近90日の取得完了":"一部取得・参考値"}</dd></div><div><dt>除外内訳</dt><dd>{exclusionSummary}</dd></div><div><dt>確定日時</dt><dd>{item.confirmedAt?dateTime.format(new Date(item.confirmedAt)):"—"}</dd></div></dl><div className={styles.actionRow}><button type="button" className={styles.primaryButton} disabled={busy} onClick={()=>void repeat()}><RotateCcw size={18}/>同じ条件で再検索</button><button type="button" className={styles.secondaryButton} onClick={()=>go("identify",item.identificationId)}>条件を編集して再検索</button><button type="button" className={styles.secondaryButton} onClick={()=>go("history")}>履歴を見る</button></div></section>;
}

function HistoryView({go}:{go:(view:View,id?:string,mode?:"push"|"replace")=>void}){
  const [items,setItems]=useState<MarketPriceSearchDto[]>();const [error,setError]=useState("");
  useEffect(()=>{let active=true;void resources.marketPriceSearches().then(value=>{if(active)setItems(value.items);}).catch(reason=>{if(active)setError(errorMessage(reason));});return()=>{active=false;};},[]);
  return <section className={styles.historyPanel}><header><div><span>保存済みの検索</span><h2>買取相場の履歴</h2><p>確定結果の再表示、同条件の再検索、未完了検索の再開ができます。</p></div><button type="button" className={styles.primaryButton} onClick={()=>go("input")}><Search size={18}/>新しく調べる</button></header>{error?<p role="alert" className={styles.error}>{error}</p>:null}{!items?<LoadingState title="検索履歴を読み込んでいます"/>:items.length?<div className={styles.historyList}>{items.map(item=><article key={item.id}><div className={styles.historyStatus} data-status={item.status}><Clock3 size={18}/><span>{statusLabel(item.status)}</span></div><div><h3>{typeof item.query?.keyword==="string"?item.query.keyword:"保存済みの相場検索"}</h3><p>{new Date(item.createdAt).toLocaleString("ja-JP")}・{item.candidateCount}件取得・{item.includedCount}件採用</p></div><strong>{item.medianPrice==null?"—":yen.format(item.medianPrice)}</strong><button type="button" onClick={()=>go(item.status==="confirmed"?"result":["ready","partial","review_required"].includes(item.status)?"candidates":"progress",item.id)}>開く<ArrowRight size={17}/></button></article>)}</div>:<EmptyState title="検索履歴はありません" body="商品を入力して最初の相場検索を始めてください。" action={()=>go("input")}/>}</section>;
}

function LoadingState({title,body}:{title:string;body?:string}){return <section className={styles.loadingState} aria-live="polite"><LoaderCircle className={styles.spin} size={30}/><h2>{title}</h2>{body?<p>{body}</p>:null}</section>;}
function EmptyState({title,body,action}:{title:string;body:string;action:()=>void}){return <section className={styles.loadingState}><h2>{title}</h2><p>{body}</p><button className={styles.primaryButton} type="button" onClick={action}>移動する</button></section>;}
