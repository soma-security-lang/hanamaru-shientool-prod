"use client";

import Link from "next/link";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import {
  AlertTriangle, ArrowRight, BookOpen, Check, ChevronRight,
  Filter, Headphones, ListChecks, MessageCircle, Mic2,
  Play, RotateCcw, Search, Send, ShieldCheck, Sparkles, UploadCloud, UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {recordingConsentNotice} from "@hanamaru/contracts";
import {GoogleSignInButton} from "@/components/auth/GoogleSignInButton";
import {DrivePickerButton} from "@/components/drive/DrivePickerButton";
import {TechnicalDetails} from "@/components/technical-details/TechnicalDetails";
import {ApiClientError} from "@/lib/api/client";
import {resources,type ContentPolicyDto,type JobDto,type OperationsHealthDto,type PreparationDto,type RetentionBindingDto,type RetentionPolicyDto,type ReviewDimension,type TranscriptQualityAssessmentDto,type TranscriptQualityFlag,type VisitWorkspaceDto} from "@/lib/api/resources";
import type { ContentDetail, ContentSummary, ContentType } from "@/lib/content/types";
import type { ScreenKind } from "@/lib/prototype/types";
import {approvalStateLabel,attemptResultLabel,auditActionLabel,auditResultLabel,businessText,contentRoute,contentTypeLabel,deletionStateLabel,entityTypeLabel,jobStateLabel,jobTypeLabel,membershipStateLabel,publicationStateLabel,statusDisplayLabel,visitStateLabel} from "@/lib/ui-vocabulary";
import styles from "./Experience.module.css";

type Props = { kind: ScreenKind; viewerId?: string; capabilities?:string[]; featureFlags?:Record<string,boolean> };
type SearchResult = { items: ContentSummary[]; total: number; hasMore: boolean };

function visitSteps(id:string){return [["訪問情報",`/visits/${id}/import`],["訪問前チェック",`/visits/${id}/preparation`],["録音・文字起こし",`/visits/${id}/transcription`],["振り返り",`/visits/${id}/review/input`]] as const;}
const knowledgeTabs = [
  ["切り返しトーク集", "/knowledge/talks"], ["困ったときのフロー集", "/knowledge/flows"],
  ["用語集・金券買取価格表", "/knowledge/reference"], ["接客マニュアル・法務", "/knowledge/manuals"],
] as const;
const trainingTabs = [["AIロープレ", "/training/roleplay"], ["動画ライブラリ", "/training/videos"]] as const;
const adminTabs = [
  ["コンテンツ", "/admin/contents"], ["利用者・権限", "/admin/users"],
  ["システム運用", "/admin/operations"], ["コンテンツ承認", "/admin/approvals"],
  ["チーム分析", "/admin/analytics"],
] as const;

export function WebExperience({ kind,viewerId,capabilities,featureFlags }: Props) {
  const pilotContentAi=Boolean(featureFlags?.pilot_content_ai);
  switch (kind) {
    case "auth": return <Login />;
    case "aiHome": return <AiHome pilotContentAi={pilotContentAi} />;
    case "visitList": return <VisitList />;
    case "visitImport": return <VisitImport />;
    case "visitPreparation": return <VisitPreparation pilotContentAi={pilotContentAi} />;
    case "transcription": return <Transcription />;
    case "reviewInput": return <ReviewInput />;
    case "reviewResult": return <ReviewResult />;
    case "reviews": return <ReviewHistory />;
    case "talks": return <ContentExplorer title="切り返しトーク集" types={["talk"]} />;
    case "flows": return <ContentExplorer title="困ったときのフロー集" types={["flow"]} />;
    case "reference": return <Reference />;
    case "manuals": return <ContentExplorer title="接客マニュアル・法務" types={["manual", "legal"]} reader />;
    case "videos": return <Videos />;
    case "roleplay": return <Roleplay pilotContentAi={pilotContentAi} />;
    case "contentsAdmin": return <ContentsAdmin />;
    case "usersAdmin": return <UsersAdmin viewerId={viewerId} />;
    case "operations": return <Operations capabilities={capabilities??[]} />;
    case "approval": return <Approval />;
    case "analytics": return <Analytics />;
    default: return null;
  }
}

function Login() {
  const router=useRouter();
  const [error,setError]=useState("");
  const success=useMemo(()=>()=>{router.replace("/");router.refresh();},[router]);
  const failed=useMemo(()=>(message:string)=>setError(message),[]);
  return (
    <section className={styles.loginPage} aria-labelledby="login-title">
      <div className={styles.loginCard}>
        <div className={styles.loginBrand} aria-hidden="true">華</div>
        <h1 id="login-title">買取支援ツール</h1>
        <p>業務用Googleアカウントでログインしてください。</p>
        <div className={styles.googleButton}><GoogleSignInButton onSuccess={success} onError={failed}/></div>
        {error?<p role="alert">{error}</p>:null}
        <a className={styles.helpLink} href="mailto:support@example.invalid">ログインできない場合</a>
      </div>
    </section>
  );
}

function PageTitle({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <header className={styles.pageTitle}><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{action}</header>;
}

function PilotContentNotice({enabled,policy}:{enabled:boolean;policy?:ContentPolicyDto}){
  if(!enabled&&!policy?.usesUnapprovedContent)return null;
  return <div className={styles.pilotNotice} role="status"><AlertTriangle size={20} aria-hidden="true"/><div><strong>未承認コンテンツ使用・要確認</strong><p>{policy?.notice??"限定運用では、移行内容が未承認のコンテンツを使用する場合があります。回答や提案は原文と照合して判断してください。"}</p>{policy?.contentVersionIds.length?<small>使用版: {policy.contentVersionIds.join(", ")}</small>:null}</div></div>;
}

function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;const previous=document.activeElement as HTMLElement|null;if(dialog&&!dialog.open){if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");}const firstField=dialog?.querySelector<HTMLElement>("form input:not([type='hidden']),form select,form textarea");(firstField??dialog?.querySelector<HTMLElement>("button"))?.focus();return()=>{if(dialog?.open){if(typeof dialog.close==="function")dialog.close();else dialog.removeAttribute("open");}previous?.focus();};},[]);
  return <dialog className={styles.modal} ref={ref} aria-labelledby="modal-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}><section><header><h2 id="modal-title">{title}</h2><button type="button" aria-label="閉じる" onClick={onClose}>×</button></header>{children}</section></dialog>;
}

function Subnav({ items, current }: { items: ReadonlyArray<readonly [string, string]>; current: string }) {
  return <nav className={styles.subnav} aria-label="セクションメニュー">{items.map(([label, href]) => <Link aria-current={label === current ? "page" : undefined} href={href} key={href}>{label}</Link>)}</nav>;
}

function SearchBox({ value, onChange, placeholder = "キーワードで検索" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [composing, setComposing] = useState(false);
  return <label className={styles.searchBox}><Search size={18} aria-hidden="true" /><span className={styles.srOnly}>検索</span><input value={value} placeholder={placeholder} onCompositionStart={() => setComposing(true)} onCompositionEnd={(event) => { setComposing(false); onChange(event.currentTarget.value); }} onChange={(event) => { if (!composing) onChange(event.target.value); }} /></label>;
}

function useContentSearch(types: ContentType[], query: string, pageSize = 40, revision = 0, page = 1) {
  const key = types.join(",");
  const [result, setResult] = useState<SearchResult>({ items: [], total: 0, hasMore: false });
  useEffect(() => {
    let live = true;
    const timer=window.setTimeout(()=>{void import("@/lib/content/repository").then(({ getContentRepository }) => getContentRepository()).then((repository) => repository.search({ type: types, text: query, page, pageSize })).then((value) => { if (live) setResult(value); }).catch(()=>{if(live)setResult({items:[],total:0,hasMore:false});});},query?220:0);
    return () => { live = false;window.clearTimeout(timer); };
  }, [key, page, pageSize, query,revision]); // eslint-disable-line react-hooks/exhaustive-deps
  return result;
}

function useContentDetail(id: string | undefined,revision=0) {
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  useEffect(() => {
    let live = true;
    if (!id) return;
    void import("@/lib/content/repository").then(({ getContentRepository }) => getContentRepository()).then((repository) => repository.get(id)).then((value) => { if (live) setDetail(value); }).catch(()=>{if(live)setDetail(null);});
    return () => { live = false; };
  }, [id,revision]);
  return id ? detail : null;
}

function useRemote<T>(key:string,load:()=>Promise<T>){const [value,setValue]=useState<T>();const [error,setError]=useState("");const [loading,setLoading]=useState(true);const [version,setVersion]=useState(0);useEffect(()=>{let live=true;void load().then(result=>{if(live){setValue(result);setError("");}}).catch(reason=>{if(live)setError(reason instanceof Error?reason.message:"読込に失敗しました");}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[key,version]);return{value,error,loading,refresh:()=>setVersion(current=>current+1)};} // eslint-disable-line react-hooks/exhaustive-deps
function useVisitId(){return usePathname().split("/")[2]??"";}
function useProtectedFileUrl(kind:"document"|"recording",id:string|undefined,revision=0){const requestKey=`${kind}:${id??""}:${revision}`;const [state,setState]=useState({key:"",value:"",error:""});useEffect(()=>{let active=true;let objectUrl="";if(!id)return;void resources.protectedFileAccess(kind,id).then(async access=>{if(!access.requiresBearer)return access.url;const blob=await resources.protectedFileBlob(access.url.replace(/^\/api\/v1/,""));objectUrl=URL.createObjectURL(blob);return objectUrl;}).then(url=>{if(active)setState({key:requestKey,value:url,error:""});}).catch(reason=>{if(active)setState({key:requestKey,value:"",error:reason instanceof Error?reason.message:"ファイルを読み込めませんでした"});});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[id,kind,requestKey]);return state.key===requestKey?{value:state.value,error:state.error}:{value:"",error:""};}
function useTrainingVideoUrl(contentId:string|undefined,revision=0){const requestKey=`video:${contentId??""}:${revision}`;const [state,setState]=useState({key:"",value:""});useEffect(()=>{let active=true;let objectUrl="";if(!contentId)return;void resources.trainingVideoAccess(contentId).then(async access=>{if(!access.requiresBearer)return access.url;const blob=await resources.protectedFileBlob(`/training/videos/${contentId}/file`);objectUrl=URL.createObjectURL(blob);return objectUrl;}).then(url=>{if(active)setState({key:requestKey,value:url});}).catch(()=>{if(active)setState({key:requestKey,value:""});});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[contentId,requestKey]);return state.key===requestKey?state.value:"";}
function formatDate(value:string|null|undefined){if(!value)return"未設定";return new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
async function audioDuration(file:File):Promise<number|null>{return new Promise(resolve=>{const url=URL.createObjectURL(file);const audio=new Audio();const finish=(value:number|null)=>{URL.revokeObjectURL(url);audio.removeAttribute("src");resolve(value);};const timeout=window.setTimeout(()=>finish(null),5000);audio.preload="metadata";audio.onloadedmetadata=()=>{window.clearTimeout(timeout);finish(Number.isFinite(audio.duration)?Math.round(audio.duration*1000):null);};audio.onerror=()=>{window.clearTimeout(timeout);finish(null);};audio.src=url;});}
function displayLegacyTitle(value:string){return value.replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]+\s*/u,"");}
function nextVisitAction(status:string,id:string){if(status==="draft"||status==="ready")return{label:"訪問前チェック",href:`/visits/${id}/preparation`};if(status==="visited")return{label:"録音・文字起こし",href:`/visits/${id}/transcription`};if(status==="reviewed"||status==="closed")return{label:"振り返りを見る",href:`/visits/${id}/review`};return{label:"訪問情報を確認",href:`/visits/${id}/import`};}
const qualityFlagLabels:Record<TranscriptQualityFlag,{title:string;description:string}>={
  many_speakers:{title:"話者候補が多い音声です",description:"チャンクごとの話者ラベルを確認し、査定員とお客様を割り当ててください。"},
  possible_media:{title:"放送・動画などの音声が含まれる可能性があります",description:"接客以外の音声が混ざっていないか、代表区間を再生して確認してください。"},
  long_non_dialogue:{title:"会話ではない長い区間がある可能性があります",description:"長い無音や一人語りが接客記録として適切か確認してください。"},
  assessment_unavailable:{title:"音声品質を自動判定できませんでした",description:"音声を確認してから、利用継続または差し替えを選んでください。"},
};
const reviewDimensionOptions:ReadonlyArray<{id:ReviewDimension;label:string}>=[
  {id:"strength",label:"接客の良かった点"},
  {id:"improvement",label:"改善できる点"},
  {id:"talk",label:"利用できたトーク"},
  {id:"compliance",label:"法令・コンプライアンス"},
  {id:"next_action",label:"次回の助言"},
  {id:"revisit",label:"再訪可能性"},
];
function qualityRequiresAcknowledgement(assessment:TranscriptQualityAssessmentDto|null|undefined){return Boolean(assessment&&(assessment.status==="assessment_unavailable"||assessment.flags.length>0)&&assessment.continuationDecision!=="continue");}

function AiHome({pilotContentAi}:{pilotContentAi:boolean}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [answer,setAnswer]=useState<Awaited<ReturnType<typeof resources.assistAnswer>>|null>(null);
  const [working,setWorking]=useState(false);const [error,setError]=useState("");
  const { items, total } = useContentSearch(["talk", "flow", "glossary", "price", "manual", "legal", "roleplay"], submitted, 8);
  const [selected, setSelected] = useState<string>();
  const evidence=answer?.citations??items.map(item=>({id:item.id,type:item.type,title:item.title}));
  const selectedId = evidence.some((item) => item.id === selected) ? selected : evidence[0]?.id;
  const detail = useContentDetail(selectedId);
  const dashboard=useRemote("dashboard",resources.dashboard);const activeVisit=dashboard.value?.visits[0]?.id;
  async function ask(question:string){const normalized=question.trim();if(!normalized||working)return;setSubmitted(normalized);setWorking(true);setError("");setAnswer(null);setSelected(undefined);try{const result=await resources.assistAnswer(normalized);if(!result.grounded)throw new Error("回答根拠を確認できませんでした");setAnswer(result);}catch{setError("回答を作成できませんでした。質問を短く言い換えるか、現場の知識から検索してください。");}finally{setWorking(false);}}
  function submit(event: React.FormEvent) { event.preventDefault(); void ask(query); }
  return <>
    <PageTitle title="買取支援AI" description="接客や査定で迷ったことを、現場知識を根拠に確認できます。" action={<Link className={styles.secondaryButton} href="/visits">今日の訪問を見る</Link>} />
    <PilotContentNotice enabled={pilotContentAi} policy={answer?.contentPolicy}/>
    <div className={styles.homeGrid}>
      <section className={styles.chatWorkspace} aria-labelledby="answer-title">
        {submitted?<div className={styles.question}><UserRound size={20} aria-hidden="true" /><p>{submitted}</p></div>:null}
        <div className={styles.answer}><Sparkles size={20} aria-hidden="true" /><div><h2 id="answer-title">{working?"根拠を確認しています":answer?"回答":"何を確認しますか？"}</h2><p>{working?(pilotContentAi?"公開済み情報と限定運用の要確認コンテンツを区別して、回答根拠を確認しています。":"承認・公開済みの現場知識だけを根拠に回答を作成しています。"):answer?.answer??"接客中の迷いや、訪問前に確認したいことを入力してください。"}</p>{error?<p role="alert">{error}</p>:null}{answer?.suggestedQuestions.length?<div className={styles.suggestedQuestions}>{answer.suggestedQuestions.map(question=><button key={question} onClick={()=>void ask(question)}>{question}</button>)}</div>:null}</div></div>
        <form className={styles.composer} onSubmit={submit}><label><span className={styles.srOnly}>質問</span><textarea rows={2} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：査定額が安いと言われたら？" /></label><button aria-label="質問を送る" disabled={!query.trim()||working}><Send size={19} /></button></form>
      </section>
      <aside className={styles.homeAside}>
        <section><h2>根拠となる現場知識</h2><p className={styles.resultCount}>{answer?`${answer.citations.length}件を回答根拠として確認済み`:submitted?`${total.toLocaleString()}件から関連候補を表示`:"回答すると根拠を表示します"}</p><div className={styles.compactList}>{evidence.slice(0, 8).map((item) => <button data-selected={selectedId === item.id} key={item.id} onClick={() => setSelected(item.id)}><span>{typeLabel(item.type as ContentType)}{detail?.id===item.id?`・${detail.category}`:""}{"requiresReview" in item&&item.requiresReview?"・要確認":""}</span><strong>{item.title}</strong></button>)}</div>{detail?<Link className={styles.textButton} href={contentRoute(detail.type)}>選択した根拠を開く<ArrowRight size={16}/></Link>:null}</section>
        <section><h2>業務を始める</h2><div className={styles.quickLinks}><Link href={activeVisit?`/visits/${activeVisit}/preparation`:"/visits"}><ListChecks />訪問前チェック<ChevronRight /></Link><Link href={activeVisit?`/visits/${activeVisit}/review/input`:"/reviews"}><MessageCircle />振り返り<ChevronRight /></Link><Link href="/training/roleplay"><Sparkles />AIロープレ<ChevronRight /></Link></div></section>
      </aside>
    </div>
  </>;
}

interface VisitRow{id:string;resourceId:string;time:string;branch:string;status:string;next:string;href:string}

function VisitList() {
  const [query, setQuery] = useState("");
  const [statusFilter,setStatusFilter]=useState("all");
  const remote=useRemote<VisitRow[]>(`visits:${query}`,async()=>{const response=await resources.visits(query);return response.items.map(visit=>{const action=nextVisitAction(visit.status,visit.id);return{id:visit.caseNumber,time:formatDate(visit.scheduledAt),branch:visit.branchName??"所属店舗",status:visit.status,next:action.label,href:action.href,resourceId:visit.id};});});
  const filtered=(remote.value??[]).filter(visit=>statusFilter==="all"||visit.status===statusFilter);const [selectedId,setSelectedId]=useState<string>();const selected=filtered.find(visit=>visit.resourceId===selectedId)??filtered[0];
  return <>
    <PageTitle title="訪問支援" description="訪問の準備から振り返りまで、現在地と次の作業を確認できます。" action={<div className={styles.actionGroup}><Link className={styles.secondaryButton} href="/visits/new/import"><UploadCloud size={17}/>PDFから訪問を登録</Link>{selected?<Link className={styles.primaryButton} href={selected.href}>次の作業へ</Link>:null}</div>} />
    <div className={styles.toolbar}><SearchBox value={query} onChange={setQuery} placeholder="案件番号・状態・店舗で検索" /><label className={styles.filterSelect}><Filter size={17}/><span className={styles.srOnly}>状態で絞り込み</span><select aria-label="状態で絞り込み" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="all">すべての状態</option>{Array.from(new Set((remote.value??[]).map(visit=>visit.status))).map(status=><option key={status} value={status}>{visitStateLabel(status).label}</option>)}</select></label><span>{filtered.length}件</span></div>
    <div className={styles.listDetail}>
      <section className={styles.tablePane} aria-label="訪問一覧">{remote.error?<p role="alert">訪問一覧を読み込めませんでした。時間をおいて再読み込みしてください。</p>:null}<table><thead><tr><th>訪問日時</th><th>案件番号</th><th>店舗</th><th>状態</th><th>次の作業</th></tr></thead><tbody>{filtered.map(visit=><tr data-selected={selected===visit} key={visit.resourceId}><td data-label="訪問日時">{visit.time}</td><td data-label="案件番号"><button className={styles.tableSelectButton} aria-pressed={selected===visit} onClick={()=>setSelectedId(visit.resourceId)}><strong>{visit.id}</strong></button></td><td data-label="店舗">{visit.branch}</td><td data-label="状態"><Status>{visitStateLabel(visit.status).label}</Status></td><td data-label="次の作業">{visit.next}</td></tr>)}</tbody></table></section>
      {selected?<aside className={styles.detailPane}><span className={styles.kicker}>選択中の訪問</span><h2>{selected.id}</h2><dl><div><dt>訪問日時</dt><dd>{selected.time}</dd></div><div><dt>担当店舗</dt><dd>{selected.branch}</dd></div><div><dt>現在の状態</dt><dd>{visitStateLabel(selected.status).label}</dd></div></dl><Link className={styles.primaryButton} href={selected.href}>{selected.next}<ArrowRight size={17} /></Link><Link className={styles.textButton} href={`/visits/${selected.resourceId}/import`}>訪問情報を確認</Link></aside>:<aside className={styles.detailPane}><h2>訪問はありません</h2><p>PDFから訪問を登録すると、準備状況がここに表示されます。</p></aside>}
    </div>
  </>;
}

function VisitNavigation({ current,id }: { current: string;id:string }) { return <Subnav items={visitSteps(id)} current={current} />; }

function VisitImport() {
  const id=useVisitId();
  const router=useRouter();
  const isNew=id==="new";
  const labelFor=(key:string)=>({visitDate:"訪問予定日",visitTime:"訪問予定時間",visitDateTime:"訪問予定日時",scheduledAt:"訪問予定日時",customerLabel:"お客様表示名",customerName:"お客様表示名",appraisalItems:"査定品",visitAddress:"住所",contact:"連絡先",parking:"駐車場",campaign:"キャンペーン",notes:"備考",assignedStaffName:"担当"}[key]??key);
  const remote=useRemote<VisitWorkspaceDto|null>(`workspace:${id}`,()=>isNew?Promise.resolve(null):resources.workspace(id));
  const [state,setState]=useState<"idle"|"uploading"|"queued"|"saving"|"saved"|"error">("idle");
  const [localPreviewUrl,setLocalPreviewUrl]=useState("");
  const localPreviewRef=useRef("");
  const [selectedFile,setSelectedFile]=useState("");
  const [edits,setEdits]=useState<Record<string,string>>({});
  const [validationMessage,setValidationMessage]=useState("");
  const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
  const fields=(remote.value?.fields??[]).map(field=>({key:field.fieldKey,label:labelFor(field.fieldKey),valueType:field.valueType,value:String(field.textValue??field.numberValue??field.dateValue??field.booleanValue??""),confidence:field.confidence??0}));
  const extractionJob=remote.value?.jobs.find(job=>job.jobType==="pdf_extract");
  const extractionActive=Boolean(extractionJob&&["queued","running","retry_wait"].includes(extractionJob.status));
  const extractionFailed=extractionJob?.status==="failed"||extractionJob?.status==="cancelled";
  const remotePreview=useProtectedFileUrl("document",remote.value?.document?.id);
  const previewUrl=localPreviewUrl||remotePreview.value;
  const effectiveState=fields.length?"extracted":extractionActive?"queued":extractionFailed?"error":state;

  useEffect(()=>()=>{if(localPreviewRef.current)URL.revokeObjectURL(localPreviewRef.current);},[]);
  useEffect(()=>{
    const awaitingExtraction=remote.value?.document&&!remote.value.extraction&&!extractionFailed;
    if(isNew||(!extractionActive&&!awaitingExtraction))return;
    const timer=window.setInterval(remote.refresh,1200);
    return()=>window.clearInterval(timer);
  },[extractionActive,extractionFailed,isNew,remote.value?.document,remote.value?.extraction]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(file:File|undefined){
    if(!file)return;
    if(file.type!=="application/pdf"||file.size>30_000_000){setState("error");return;}
    setSelectedFile(file.name);setState("uploading");setEdits({});setValidationMessage("");setFieldErrors({});
    if(localPreviewRef.current)URL.revokeObjectURL(localPreviewRef.current);
    const localUrl=URL.createObjectURL(file);localPreviewRef.current=localUrl;setLocalPreviewUrl(localUrl);
    try{
      if(isNew){const created=await resources.importVisitFromPdf(file);setState("queued");router.replace(`/visits/${created.visitId}/import`);}
      else{await resources.uploadDocument(id,file);setState("queued");remote.refresh();}
    }catch{setState("error");}
  }
  async function retryExtraction(){
    const documentId=remote.value?.document?.id;if(!documentId)return;
    setState("queued");
    try{await resources.requestExtraction(documentId);remote.refresh();}catch{setState("error");}
  }
  async function confirm(){
    if(!fields.length||!remote.value?.extraction||isNew)return;
    setState("saving");setValidationMessage("");setFieldErrors({});
    try{
      const extraction=remote.value.extraction;
      const updated=await resources.updateExtraction(extraction.id,extraction.lockVersion,fields.map(field=>({fieldKey:field.key,valueType:field.valueType,value:edits[field.key]??field.value})));
      await resources.confirmExtraction(extraction.id,updated.lockVersion);
      await resources.requestPreparation(id).catch(()=>undefined);
      setState("saved");router.push(`/visits/${id}/preparation`);
    }catch(error){
      setState("error");
      if(error instanceof ApiClientError&&error.code==="VALIDATION_FAILED"){
        setValidationMessage(error.message);
        setFieldErrors(Object.fromEntries(error.fieldErrors.map(item=>[item.field,item.message])));
      }
      remote.refresh();
    }
  }
  const hasDocument=Boolean(previewUrl||remote.value?.document);
  return <><PageTitle title={isNew?"PDFから訪問を登録":"PDF取込・情報確認"} description="PDFを取り込み、抽出した情報を原本と見比べて確定します。" />{!isNew?<VisitNavigation current="訪問情報" id={id}/>:null}{remote.error?<div className={styles.recovery} role="alert"><p>訪問情報を読み込めませんでした。通信状態を確認して再読込してください。</p><button className={styles.secondaryButton} onClick={remote.refresh}><RotateCcw size={17}/>再読み込み</button></div>:null}<div className={styles.split57}>
    <section className={styles.pdfPane}><div className={styles.pdfToolbar}><strong>{selectedFile||remote.value?.document?"取込済みPDF":"訪問情報PDF"}</strong><span>{effectiveState==="uploading"?"アップロード中":effectiveState==="queued"?"抽出中":hasDocument?"取込済み":"未選択"}</span></div>{previewUrl?<iframe className={styles.pdfFrame} src={previewUrl} title="取込済み訪問情報PDF"/>:hasDocument?<div className={styles.pdfPaper}><span>訪問受付票</span><h2>訪問概要</h2><div className={styles.redacted} /><div className={styles.redacted} /><div className={styles.redactedShort} /><hr /><h3>品物情報</h3><div className={styles.redacted} /><div className={styles.redactedShort} /></div>:<div className={styles.uploadPrompt}><UploadCloud size={36}/><h2>訪問情報PDFを選択</h2><p>選択すると訪問を仮登録し、記載内容の抽出を開始します。</p></div>}<label className={styles.secondaryButton}><UploadCloud size={17}/>{effectiveState==="uploading"?"アップロード中…":hasDocument?"別のPDFを選択":"PDFを選択"}<input className={styles.srOnly} type="file" accept="application/pdf" disabled={effectiveState==="uploading"||effectiveState==="queued"} onChange={event=>void choose(event.target.files?.[0])}/></label>{effectiveState==="queued"?<p role="status">PDFを保存しました。記載内容を抽出しています。</p>:extractionFailed?<div className={styles.recovery} role="alert"><p>PDFから情報を抽出できませんでした。原本を確認して再実行するか、別のPDFを選択してください。</p><button className={styles.secondaryButton} disabled={state==="queued"} onClick={()=>void retryExtraction()}><RotateCcw size={17}/>抽出を再実行</button></div>:effectiveState==="error"?<p role="alert">PDFを処理できませんでした。PDF形式・30MB以下であることを確認して、もう一度お試しください。</p>:null}</section>
    <section className={styles.formPane}><div className={styles.paneHeader}><div><h2>抽出した訪問情報</h2><p>{fields.length?"原本と照合し、必要な箇所を修正してください。":state==="queued"?"抽出が完了すると自動で項目を表示します。":"PDFを選択すると、ここに抽出結果が表示されます。"}</p></div>{hasDocument?<Status>{remote.value?.extraction?.status??(fields.length?"要確認":"処理中")}</Status>:null}</div>{validationMessage?<div className={styles.recovery} role="alert"><p>{validationMessage}</p><p>赤字の項目を原本で確認して入力してください。</p></div>:null}<div className={styles.formGrid}>{fields.map(field=><label key={field.key} data-warning={Boolean(fieldErrors[field.key])||field.confidence>0&&field.confidence<.8}><span>{field.label}{fieldErrors[field.key]?<small>{fieldErrors[field.key]}</small>:field.confidence>0&&field.confidence<.8?<small>原本を確認</small>:null}</span><input aria-invalid={Boolean(fieldErrors[field.key])} type={field.valueType==="date"?"date":field.key==="visitTime"?"time":"text"} value={edits[field.key]??field.value} onChange={event=>{setEdits(current=>({...current,[field.key]:event.target.value}));setFieldErrors(current=>{const next={...current};delete next[field.key];return next;});}}/></label>)}</div><div className={styles.stickyActions}><Link className={styles.secondaryButton} href="/visits">一覧へ戻る</Link><button className={styles.primaryButton} disabled={!fields.length||state==="saving"||state==="saved"} onClick={()=>void confirm()}>{state==="saved"?<><Check size={17}/>確定しました</>:state==="saving"?"保存しています…":"内容を確定して訪問前チェックへ"}</button></div></section>
  </div></>;
}

function VisitPreparation({pilotContentAi}:{pilotContentAi:boolean}) {
  const id=useVisitId();
  const workspace=useRemote<VisitWorkspaceDto|null>(`workspace:${id}`,()=>resources.workspace(id));
  const preparation=useRemote<PreparationDto|null>(`preparation:${id}`,()=>resources.preparation(id));
  const [checked,setChecked]=useState<string[]>([]);
  const [action,setAction]=useState<"idle"|"requesting"|"confirming"|"error">("idle");
  const latestJob=workspace.value?.jobs.find(job=>job.jobType==="preparation");
  const processing=latestJob&&["queued","running","retry_wait"].includes(latestJob.status);
  const result=preparation.value?.structuredResult;
  const laws=result?.legalChecks??[];
  const confirmed=preparation.value?.status==="confirmed";
  useEffect(()=>{if(!processing)return;const timer=window.setInterval(()=>{workspace.refresh();preparation.refresh();},1500);return()=>window.clearInterval(timer);},[processing]); // eslint-disable-line react-hooks/exhaustive-deps
  async function request(){setAction("requesting");try{await resources.requestPreparation(id);workspace.refresh();preparation.refresh();setAction("idle");}catch{setAction("error");}}
  async function complete(){const current=preparation.value;if(!current||current.status!=="generated"||checked.length!==laws.length)return;setAction("confirming");try{await resources.confirmPreparation(id,current.lockVersion);preparation.refresh();workspace.refresh();setAction("idle");}catch{setAction("error");preparation.refresh();}}
  return <><PageTitle title="訪問前チェック" description="確定済みの訪問情報と利用可能なナレッジから生成した内容を確認します。" action={result?<button className={styles.primaryButton} disabled={checked.length!==laws.length||confirmed||action==="confirming"} onClick={()=>void complete()}>{confirmed?<><Check size={17}/>準備完了</>:action==="confirming"?"確定しています…":"確認して準備を完了"}</button>:<button className={styles.primaryButton} disabled={Boolean(processing)||action==="requesting"} onClick={()=>void request()}>{processing||action==="requesting"?"生成しています…":"訪問前チェックを生成"}</button>} /><VisitNavigation current="訪問前チェック" id={id}/>
    <PilotContentNotice enabled={pilotContentAi} policy={result?.contentPolicy}/>
    {processing?<p className={styles.notice} role="status">訪問前チェックを生成しています。このページを閉じても処理は継続します。</p>:null}
    {latestJob?.status==="failed"||action==="error"||workspace.error||preparation.error?<p role="alert">訪問前チェックを表示できませんでした。抽出結果が確定済みか確認し、もう一度生成してください。</p>:null}
    {!result&&!processing?<section className={styles.emptyState}><Sparkles size={28}/><h2>訪問前チェックは未生成です</h2><p>PDFから抽出した内容を確定したあと、生成を開始してください。</p><Link className={styles.secondaryButton} href={`/visits/${id}/import`}>訪問情報を確認</Link></section>:null}
    {result?<div className={styles.prepGrid}><section className={styles.prepSummary}><h2>今回の訪問</h2><dl><div><dt>訪問日時</dt><dd>{formatDate(workspace.value?.visit.scheduledAt)}</dd></div>{result.customerFacts.map(fact=><div key={`${fact.label}-${fact.sourceFieldKey??fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl><h3>想定される心理</h3>{result.anticipatedPsychology.map(item=><article key={item.title}><strong>{item.title}</strong><p>{item.description}</p></article>)}<Link className={styles.textButton} href={`/visits/${id}/import`}>抽出元を見直す</Link></section>
      <section className={styles.prepMain}><div className={styles.paneHeader}><div><h2>法令・接客チェック</h2><p>{checked.length} / {laws.length}項目を確認</p></div><Status>{preparation.value?.status}</Status></div><div className={styles.checkList}>{laws.map((law,index)=>{const key=`${index}-${law.title}`;return <label key={key}><input type="checkbox" checked={checked.includes(key)} disabled={confirmed} onChange={(event)=>setChecked(event.target.checked?[...checked,key]:checked.filter(item=>item!==key))}/><span><strong>{law.title}</strong><small>{law.description}</small></span></label>;})}</div>{laws.length!==4?<div className={styles.notice}><AlertTriangle size={18}/><span>法令確認が4項目揃っていません。準備を完了せず、管理者へ処理状況を連絡してください。</span></div>:null}<div className={styles.callout}><ShieldCheck size={20}/><div><strong>根拠を限定しています</strong><p>{result.contentPolicy?.usesUnapprovedContent?"確定済み抽出値と限定運用の要確認コンテンツを根拠に生成しています。原文照合が必要です。":"確定済み抽出値と承認・公開済みナレッジを根拠に生成されています。"}</p></div></div></section>
      <aside className={styles.prepAside}><section><h2>想定トーク</h2>{result.suggestedTalks.map(item=><article key={item.title}><strong>{item.title}</strong><blockquote>{item.script}</blockquote></article>)}{!result.suggestedTalks.length?<p>生成された想定トークはありません。</p>:null}</section><section><h2>想定Q&amp;A</h2>{result.anticipatedQuestions.map((item,index)=><details open={index===0} key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}{!result.anticipatedQuestions.length?<p>生成された想定Q&amp;Aはありません。</p>:null}</section></aside>
    </div>:null}
  </>;
}

function Transcription() {
  const id=useVisitId();
  const remote=useRemote<VisitWorkspaceDto|null>(`workspace:${id}`,()=>resources.workspace(id));
  const transcriptId=remote.value?.transcript?.id;
  const [consent,setConsent]=useState(false);
  const [state,setState]=useState<"idle"|"uploading"|"queued"|"confirmed"|"error">("idle");
  const [confirming,setConfirming]=useState(false);
  const [retrying,setRetrying]=useState(false);
  const [edits,setEdits]=useState<Record<string,string>>({});
  const [speakerRoles,setSpeakerRoles]=useState<Record<string,"staff"|"customer"|"unknown">>({});
  const [selectedSource,setSelectedSource]=useState("");
  const [driveJobId,setDriveJobId]=useState("");
  const [driveStatus,setDriveStatus]=useState("");
  const [mediaRevision,setMediaRevision]=useState(0);
  const [mediaError,setMediaError]=useState(false);
  const [qualityAction,setQualityAction]=useState<"idle"|"acknowledging"|"error">("idle");
  const recordingInput=useRef<HTMLInputElement>(null);
  const segments=remote.value?.segments??[];
  const consentGranted=consent||remote.value?.consent?.status==="granted";
  const latestJob=remote.value?.jobs.find(job=>job.jobType==="transcribe");
  const processing=latestJob&&["queued","running","retry_wait"].includes(latestJob.status);
  const transcriptionFailed=latestJob?.status==="failed"||latestJob?.status==="cancelled";
  const recordingMedia=useProtectedFileUrl("recording",remote.value?.recording?.id,mediaRevision);
  const audioUrl=recordingMedia.value;
  const audioFailed=mediaError||Boolean(recordingMedia.error);
  const allSpeakersAssigned=segments.length>0&&segments.every(segment=>(speakerRoles[segment.id]??segment.speakerRole)!=="unknown");
  const assessment=remote.value?.qualityAssessment;

  useEffect(()=>{if(!processing)return;const timer=window.setInterval(remote.refresh,1500);return()=>window.clearInterval(timer);},[processing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!driveJobId)return;let checking=false;const check=async()=>{if(checking)return;checking=true;try{const job=await resources.job(driveJobId);setDriveStatus(job.status);if(job.status==="succeeded"){setDriveJobId("");setState("queued");remote.refresh();}else if(["failed","cancelled"].includes(job.status)){setDriveJobId("");setState("error");}}catch{setDriveJobId("");setState("error");}finally{checking=false;}};void check();const timer=window.setInterval(()=>void check(),1500);return()=>window.clearInterval(timer);},[driveJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(file:File|undefined){
    if(!file||!consentGranted)return;
    if(!file.type.startsWith("audio/")||file.size>1_000_000_000){setState("error");return;}
    setState("uploading");
    try{
      if(transcriptId&&assessment&&qualityRequiresAcknowledgement(assessment))await resources.acknowledgeTranscriptQuality(transcriptId,"replace",assessment.lockVersion);
      const consentId=await ensureConsent();
      const durationMs=await audioDuration(file);
      await resources.uploadRecording(id,file,consentId,{capturedAt:new Date().toISOString(),durationMs});
      setSelectedSource(file.name);setState("queued");remote.refresh();
    }catch{setState("error");}
  }
  async function ensureConsent(){if(!consentGranted)throw new Error("録音同意を確認してください");const existing=remote.value?.consent?.id;if(existing)return existing;const created=await resources.consent(id);setConsent(true);return created.id;}
  async function retryTranscription(){
    const recordingId=remote.value?.recording?.id;if(!recordingId)return;
    setRetrying(true);
    try{await resources.requestTranscription(recordingId);setState("queued");remote.refresh();}catch{setState("error");}finally{setRetrying(false);}
  }
  async function confirm(){
    const transcript=remote.value?.transcript;if(!transcript||!allSpeakersAssigned)return;
    setConfirming(true);
    try{await resources.confirmTranscript(transcript.id,transcript.lockVersion,segments.map(segment=>({id:segment.id,text:edits[segment.id]??segment.editedText??segment.text,speakerRole:speakerRoles[segment.id]??segment.speakerRole})));setState("confirmed");remote.refresh();}catch{setState("error");remote.refresh();}finally{setConfirming(false);}
  }
  async function acknowledgeQuality(){if(!transcriptId||!assessment||qualityAction==="acknowledging")return;setQualityAction("acknowledging");try{await resources.acknowledgeTranscriptQuality(transcriptId,"continue",assessment.lockVersion);setQualityAction("idle");remote.refresh();}catch{setQualityAction("error");}}
  return <><PageTitle title="録音・文字起こし" description="録音の取込状況を確認し、音声を聴きながら文字起こしを修正します。" action={<button className={styles.primaryButton} disabled={!remote.value?.transcript||!allSpeakersAssigned||confirming} onClick={()=>void confirm()}>{state==="confirmed"?<><Check size={17}/>確定しました</>:confirming?"確定しています…":"文字起こしを確定"}</button>} /><VisitNavigation current="録音・文字起こし" id={id}/>{remote.error?<div className={styles.recovery} role="alert"><p>録音と文字起こしを読み込めませんでした。通信状態を確認して再読込してください。</p><button className={styles.secondaryButton} onClick={remote.refresh}><RotateCcw size={17}/>再読み込み</button></div>:null}<details><summary>録音とAI利用の説明を確認</summary><p>{recordingConsentNotice}</p></details><div className={styles.split39}>
    <aside className={styles.recordingPane}><h2>録音</h2><label className={styles.consent}><input type="checkbox" checked={consentGranted} onChange={event=>setConsent(event.target.checked)} disabled={remote.value?.consent?.status==="granted"}/><span><strong>録音同意を確認済み</strong><small>{remote.value?.consent?"記録済み":"口頭で確認"}</small></span></label><label className={styles.uploadBox} aria-disabled={!consentGranted}><Mic2/><strong>{state==="uploading"?"取込中…":"端末の音声ファイルを選択"}</strong><span>M4A / MP3 / WAV</span><input ref={recordingInput} className={styles.srOnly} disabled={!consentGranted} type="file" accept="audio/mp4,audio/mpeg,audio/wav,audio/aac,audio/webm" onChange={event=>void choose(event.target.files?.[0])}/></label><div className={styles.sourceDivider}><span>または</span></div><DrivePickerButton visitId={id} disabled={!consentGranted||Boolean(driveJobId)} ensureConsent={ensureConsent} className={styles.secondaryButton} onStarted={(jobId,fileName)=>{setSelectedSource(fileName);setDriveJobId(jobId);setDriveStatus("queued");setState("queued");}}/><div className={styles.jobCard}><Status>{driveJobId?driveStatus||"queued":latestJob?.status??(state==="queued"?"待機中":"完了")}</Status><strong>{selectedSource||remote.value?.recording?.durationMs?selectedSource||`${Math.round((remote.value?.recording?.durationMs??0)/1000)}秒`:"録音未選択"}</strong><span>{driveJobId?"Driveから取込中":`${segments.length}区間`}</span></div>{state==="error"?<p role="alert">音声を取り込めませんでした。</p>:null}<p className={styles.muted}>このページを閉じても取込処理は継続します。</p></aside>
    <section className={styles.transcriptPane}>{audioUrl?<audio key={`${audioUrl}-${mediaRevision}`} className={styles.audioBar} controls preload="metadata" src={audioUrl} onCanPlay={()=>setMediaError(false)} onError={()=>setMediaError(true)}>音声を再生できません。</audio>:<div className={styles.audioBar}><span>{remote.value?.recording?"音声を読み込んでいます…":"音声ファイルを取り込んでください"}</span></div>}{audioFailed?<div className={styles.recovery} role="alert"><p>音声ストリームを読み込めませんでした。接続を確認して再接続してください。</p><button className={styles.secondaryButton} onClick={()=>{setMediaError(false);setMediaRevision(current=>current+1);}}><RotateCcw size={17}/>音声へ再接続</button></div>:null}{transcriptionFailed?<div className={styles.recovery} role="alert"><p>文字起こしを完了できませんでした。録音を確認して、もう一度実行してください。</p><button className={styles.secondaryButton} disabled={retrying} onClick={()=>void retryTranscription()}><RotateCcw size={17}/>{retrying?"再実行しています…":"文字起こしを再実行"}</button></div>:null}{processing?<p role="status">音声を文字起こししています。このページを閉じても処理は継続します。</p>:null}{transcriptId?<QualityAssessment assessment={assessment} loading={remote.loading} error={remote.error||qualityAction==="error"} acknowledging={qualityAction==="acknowledging"} onAcknowledge={()=>void acknowledgeQuality()} onReplace={()=>recordingInput.current?.click()}/>:null}<div className={styles.transcriptList}>{segments.map(segment=>{const role=speakerRoles[segment.id]??segment.speakerRole;return <label key={segment.id}><span><strong>{segment.speakerLabel??`話者 ${segment.sequenceNo+1}`}</strong>{Math.floor(segment.startMs/60000)}:{String(Math.floor(segment.startMs/1000)%60).padStart(2,"0")}<select aria-label={`発話 ${segment.sequenceNo+1} の役割`} value={role} onChange={event=>setSpeakerRoles(current=>({...current,[segment.id]:event.target.value as "staff"|"customer"|"unknown"}))}><option value="unknown">未確認</option><option value="staff">査定員</option><option value="customer">お客様</option></select></span><textarea aria-label={`発話 ${segment.sequenceNo+1}`} value={edits[segment.id]??segment.editedText??segment.text} onChange={event=>setEdits(current=>({...current,[segment.id]:event.target.value}))} rows={2}/></label>;})}</div>{segments.length&&!allSpeakersAssigned?<p role="alert">すべての発話区間を「査定員」または「お客様」に割り当ててください。</p>:null}</section>
  </div></>;
}

function QualityAssessment({assessment,loading,error,acknowledging,onAcknowledge,onReplace}:{assessment:TranscriptQualityAssessmentDto|null|undefined;loading:boolean;error:string|boolean;acknowledging:boolean;onAcknowledge:()=>void;onReplace:()=>void}){
  if(loading)return <p className={styles.notice} role="status">音声品質を確認しています。完了後に振り返りへ進めます。</p>;
  if(!assessment||error)return <div className={styles.qualityWarning} role="alert"><AlertTriangle/><div><strong>音声品質の判定を確認できません</strong><p>音声を再確認して、差し替えるか、判定の復旧後に振り返りへ進んでください。</p><button className={styles.secondaryButton} onClick={onReplace}>音声を差し替える</button></div></div>;
  if(assessment.status==="evaluated"&&!assessment.flags.length)return <div className={styles.qualityClear} role="status"><ShieldCheck/><span>音声品質の自動確認で注意事項は見つかりませんでした。</span></div>;
  return <div className={styles.qualityWarning} role={assessment.continuationDecision?"status":"alert"}><AlertTriangle/><div><strong>振り返り前に音声を確認してください</strong><ul>{assessment.flags.map(flag=><li key={flag}><b>{qualityFlagLabels[flag].title}</b><span>{qualityFlagLabels[flag].description}</span></li>)}</ul>{assessment.continuationDecision==="continue"?<p><Check size={16}/>確認して利用継続する判断を記録済みです。</p>:assessment.continuationDecision==="replace"?<p>音声の差し替えを選択しました。新しいファイルの処理完了を待ってください。</p>:<div className={styles.actionGroup}><button className={styles.secondaryButton} onClick={onReplace}>音声を差し替える</button><button className={styles.primaryButton} disabled={acknowledging} onClick={onAcknowledge}>{acknowledging?"記録しています…":"内容を確認して利用継続"}</button></div>}</div></div>;
}

function ReviewInput() {
  const router=useRouter();
  const id=useVisitId();const remote=useRemote<VisitWorkspaceDto|null>(`workspace:${id}`,()=>resources.workspace(id));const [working,setWorking]=useState(false);const [error,setError]=useState("");const [manualText,setManualText]=useState("");const [dimensionSelection,setDimensionSelection]=useState<ReviewDimension[]|null>(null);const transcript=remote.value?.transcript;
  const qualityBlocked=Boolean(transcript&&(!remote.value?.qualityAssessment||qualityRequiresAcknowledgement(remote.value.qualityAssessment)));
  const latestDimensions=remote.value?.review?.analysisDimensions??[];const dimensions=dimensionSelection??(latestDimensions.length?[...latestDimensions]:reviewDimensionOptions.map(option=>option.id));const sameAsLatest=Boolean(remote.value?.review&&dimensions.length===latestDimensions.length&&dimensions.every(dimension=>latestDimensions.includes(dimension)));
  function toggleDimension(dimension:ReviewDimension,checked:boolean){setDimensionSelection(checked?[...dimensions,dimension]:dimensions.filter(item=>item!==dimension));setError("");}
  async function create(){if(!dimensions.length){setError("分析する観点を1項目以上選択してください。");return;}setWorking(true);setError("");try{const transcriptId=transcript?.id??(await resources.createManualTranscript(id,manualText)).id;await resources.requestReview(transcriptId,dimensions);router.push(`/visits/${id}/review`);}catch{setError(transcript?"振り返りの作成を開始できませんでした。文字起こしと音声品質の状態を確認してください。":"手入力は各行を「査定員:」または「お客様:」で始めてください。");}finally{setWorking(false);}}
  return <><PageTitle title="振り返りを作成" description="録音を使う場合も使わない場合も、会話を確認して振り返りを作成できます。" /><VisitNavigation current="振り返り" id={id}/>{remote.error?<div className={styles.recovery} role="alert"><p>振り返り入力を読み込めませんでした。</p><button className={styles.secondaryButton} onClick={remote.refresh}><RotateCcw size={17}/>再読み込み</button></div>:null}{qualityBlocked?<div className={styles.qualityWarning} role="alert"><AlertTriangle/><div><strong>音声品質の確認が必要です</strong><p>混在音声や多数話者の可能性があります。録音・文字起こし画面で音声を確認し、「利用継続」を記録するか音声を差し替えてください。</p><Link className={styles.secondaryButton} href={`/visits/${id}/transcription`}>音声品質を確認</Link></div></div>:null}<div className={styles.split84}><section className={styles.editorPane}><div className={styles.paneHeader}><div><h2>{transcript?"確定済みの会話":"録音を使わない会話入力"}</h2><p>{transcript?"修正は文字起こし画面で行います。":"録音を拒否・撤回した場合も、役割を付けた会話から振り返れます。"}</p></div>{transcript?<Link className={styles.secondaryButton} href={`/visits/${id}/transcription`}><Headphones size={17}/>録音を確認</Link>:null}</div><textarea aria-label="会話内容" className={styles.reviewTextarea} value={transcript?.fullText??manualText} onChange={event=>setManualText(event.target.value)} readOnly={Boolean(transcript)} placeholder={"査定員: 本日はどのようなお品物でしょうか。\nお客様: 時計の査定をお願いします。"}/>{!transcript?<p className={styles.muted}>1行ごとに「査定員:」または「お客様:」を付けてください。音声・録音同意は保存しません。</p>:null}{remote.loading?<p role="status">会話を読み込んでいます。</p>:null}</section><aside className={styles.conditionPane}><h2>分析する観点</h2><p className={styles.muted}>必要な観点を1項目以上選択してください。選択内容だけをAIが分析します。</p>{reviewDimensionOptions.map(option=><label key={option.id}><input type="checkbox" checked={dimensions.includes(option.id)} onChange={event=>toggleDimension(option.id,event.target.checked)}/><span>{option.label}</span></label>)}{!dimensions.length?<p role="alert">分析する観点を1項目以上選択してください。</p>:null}{sameAsLatest?<Link className={styles.primaryButton} href={`/visits/${id}/review`}>現在の結果を見る<ArrowRight size={17}/></Link>:<button className={styles.primaryButton} disabled={working||qualityBlocked||!dimensions.length||(transcript?transcript.status!=="confirmed":manualText.trim().length<10)} onClick={()=>void create()}>{working?"作成を受け付けています…":remote.value?.review?"選択した観点で再分析":"AI振り返りを作成"}<ArrowRight size={17}/></button>}{error?<p role="alert">{error}</p>:null}<p>結果は育成支援のための提案です。人事評価には使用しません。</p></aside></div></>;
}

function ReviewResult() {
  const id=useVisitId();const remote=useRemote<VisitWorkspaceDto|null>(`workspace:${id}`,()=>resources.workspace(id));const sections=(remote.value?.findings??[]).map(finding=>[finding.title,finding.description,`${finding.evidence.length}件の根拠発話`] as string[]);const evidence=(remote.value?.segments??[]).map(segment=>segment.editedText??segment.text);const [selected, setSelected] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [action,setAction]=useState<"idle"|"retrying"|"acknowledging"|"error">("idle");
  const reviewJob=remote.value?.jobs.find(job=>job.jobType==="review");const processing=reviewJob&&["queued","running","retry_wait"].includes(reviewJob.status);
  const reviewFailed=reviewJob?.status==="failed"||reviewJob?.status==="cancelled";
  useEffect(()=>{if(!processing)return;const timer=window.setInterval(remote.refresh,1500);return()=>window.clearInterval(timer);},[processing]); // eslint-disable-line react-hooks/exhaustive-deps
  async function retry(){const transcript=remote.value?.transcript;if(!transcript)return;setAction("retrying");try{await resources.requestReview(transcript.id,reviewJob?.analysisDimensions??remote.value?.review?.analysisDimensions??reviewDimensionOptions.map(option=>option.id));remote.refresh();setAction("idle");}catch{setAction("error");}}
  async function acknowledge(){if(!remote.value?.review)return;setAction("acknowledging");try{await resources.acknowledgeReview(remote.value.review.id,remote.value.review.lockVersion);setConfirmed(true);remote.refresh();setAction("idle");}catch{setAction("error");remote.refresh();}}
  return <><PageTitle title="AI振り返り結果" description="分析結果と、その判断につながった会話を並べて確認します。" action={<button className={styles.primaryButton} disabled={!sections.length||action==="acknowledging"||confirmed||remote.value?.review?.status==="acknowledged"} onClick={()=>void acknowledge()}><Check size={17}/>{confirmed||remote.value?.review?.status==="acknowledged"?"確認済み":action==="acknowledging"?"確認しています…":"確認を完了"}</button>} /><VisitNavigation current="振り返り" id={id}/>{remote.error?<div className={styles.recovery} role="alert"><p>振り返り結果を読み込めませんでした。通信状態を確認して再読込してください。</p><button className={styles.secondaryButton} onClick={remote.refresh}><RotateCcw size={17}/>再読み込み</button></div>:null}{reviewFailed?<div className={styles.recovery} role="alert"><p>AI振り返りを作成できませんでした。確定済み文字起こしから再実行できます。</p><button className={styles.secondaryButton} disabled={action==="retrying"} onClick={()=>void retry()}><RotateCcw size={17}/>{action==="retrying"?"再実行しています…":"振り返りを再実行"}</button></div>:null}{action==="error"?<p role="alert">操作を完了できませんでした。内容を再読込して、もう一度お試しください。</p>:null}<div className={styles.split57}><section className={styles.evidencePane}><h2>会話の根拠</h2><div className={styles.audioMini}><Play size={16}/><span>確定済み文字起こし</span></div>{evidence.map((text,index)=><button data-highlight={selected===index||(selected>3&&index===2)} key={`${index}-${text}`} onClick={()=>setSelected(Math.min(index,Math.max(0,sections.length-1)))}><span>{index%2?"お客様":"査定員"}・発話 {index+1}</span><p>{text}</p></button>)}</section><section className={styles.analysisPane}><div className={styles.notice}><Sparkles size={19}/><span>{sections.length?(confirmed?"振り返りを確認済みにしました。":"AIの提案です。会話の根拠を確認して活用してください。"):reviewFailed?"振り返りの再実行が必要です。":"分析処理中です。このページは後から再確認できます。"}</span></div><div className={styles.analysisList}>{sections.map(([title,body,meta],index)=><button aria-pressed={selected===index} data-selected={selected===index} key={title} onClick={()=>setSelected(index)}><div><span>{index+1}</span><h2>{title}</h2><small>{meta}</small></div><p>{body}</p></button>)}</div></section></div></>;
}

function ReviewHistory() {
  const [query,setQuery]=useState("");const remote=useRemote("history",async()=>(await resources.history()).items);const reviews=(remote.value??[]).filter(item=>`${item.caseNumber} ${item.summary}`.toLocaleLowerCase("ja").includes(query.toLocaleLowerCase("ja")));const [selectedId,setSelectedId]=useState<string>();const selected=reviews.find(item=>item.reviewId===selectedId)??reviews[0];
  return <><PageTitle title="振り返り履歴" description="過去の訪問と学びを見返し、次の接客に活かします。" /><div className={styles.toolbar}><SearchBox value={query} onChange={setQuery} placeholder="案件番号・振り返り内容で検索"/><span>{reviews.length}件</span></div><div className={styles.listDetail}><section className={styles.historyList}>{remote.loading?<p role="status">履歴を読み込んでいます。</p>:null}{remote.error?<p role="alert">履歴を読み込めませんでした。</p>:null}{reviews.map(item=><button data-selected={selected===item} key={item.reviewId} onClick={()=>setSelectedId(item.reviewId)}><span><strong>{formatDate(item.scheduledAt)}・{item.caseNumber}</strong><small>{item.summary}</small></span><Status>{item.reviewStatus==="acknowledged"?"確認済み":"完了"}</Status></button>)}</section>{selected?<aside className={styles.reviewDetail}><span className={styles.kicker}>今回の学び</span><h2>{selected.caseNumber}</h2><article><strong>振り返り概要</strong><p>{selected.summary}</p></article><Link className={styles.primaryButton} href={`/visits/${selected.visitId}/review`}>振り返り結果を開く</Link></aside>:<aside className={styles.reviewDetail}><h2>{remote.loading?"読み込んでいます":"履歴はありません"}</h2></aside>}</div></>;
}

function ContentExplorer({ title, types, reader = false }: { title: string; types: ContentType[]; reader?: boolean }) {
  const [query, setQuery] = useState("");
  const [page,setPage]=useState(1);
  const { items, total, hasMore } = useContentSearch(types, query, 60,0,page);
  const [selected, setSelected] = useState<string>();
  const selectedId = items.some((item) => item.id === selected) ? selected : items[0]?.id;
  const detail = useContentDetail(selectedId);
  const categories = useMemo(() => [...new Set(items.map((item) => item.category))].slice(0, 12), [items]);
  const [category, setCategory] = useState("すべて");
  const visible = category === "すべて" ? items : items.filter((item) => item.category === category);
  return <><PageTitle title={title} description="公開済みの現場知識から、今の状況に合う内容を探します。" /><Subnav items={knowledgeTabs} current={title} /><div className={reader ? styles.knowledgeReaderGrid : styles.knowledgeGrid}>
    <aside className={styles.categoryPane}><SearchBox value={query} onChange={value=>{setQuery(value);setPage(1);}} /><h2>カテゴリ</h2><button data-selected={category === "すべて"} onClick={() => setCategory("すべて")}>すべて<span>{total}</span></button>{categories.map((item) => <button data-selected={category === item} key={item} onClick={() => setCategory(item)}>{item}</button>)}</aside>
    <section className={styles.resultPane}><div className={styles.paneHeader}><div><h2>検索結果</h2><p><span>{total.toLocaleString()}件</span>・<small>{page}ページ</small></p></div></div><div className={styles.resultList}>{visible.map((item) => <button data-selected={selectedId === item.id} key={item.id} onClick={() => setSelected(item.id)}><span>{item.category}</span><strong>{item.title}</strong><small>{typeLabel(item.type)}</small></button>)}</div><div className={styles.toolbar}><button className={styles.secondaryButton} disabled={page===1} onClick={()=>{setPage(current=>Math.max(1,current-1));setSelected(undefined);}}>前のページ</button><button className={styles.secondaryButton} disabled={!hasMore} onClick={()=>{setPage(current=>current+1);setSelected(undefined);}}>次のページ</button></div></section>
    <article className={styles.contentDetail} tabIndex={0} aria-label="コンテンツ詳細">{detail ? <><div className={styles.detailHeader}><span>{typeLabel(detail.type)}・{detail.category}</span><h2>{detail.title}</h2><div>{detail.tags.map((tag) => <em key={tag}>{tag}</em>)}</div></div><div className={styles.readableBody}>{renderContentBody(detail)}</div>{detail.type === "talk" ? <TalkGuidance detail={detail} /> : null}</> : <div className={styles.emptyDetail}><BookOpen /><p>一覧から内容を選択してください。</p></div>}</article>
  </div></>;
}

function TalkGuidance({ detail }: { detail: ContentDetail }) {
  const payload = detail.legacyPayload;
  return <div className={styles.guidance}>{typeof payload.point === "string" ? <div><strong>ポイント</strong><p>{payload.point}</p></div> : null}{typeof payload.ng === "string" ? <div data-danger><strong>避ける表現</strong><p>{payload.ng}</p></div> : null}</div>;
}

function Reference() {
  const [tab, setTab] = useState<"glossary" | "price">("glossary");
  return <><PageTitle title="用語集・金券買取価格表" description="査定用語と金券の買取価格を、最新の利用可能な内容で確認します。" /><Subnav items={knowledgeTabs} current="用語集・金券買取価格表" /><div className={styles.segmented}><button data-active={tab === "glossary"} onClick={() => setTab("glossary")}>用語集</button><button data-active={tab === "price"} onClick={() => setTab("price")}>金券買取価格表</button></div><ContentExplorerInner types={[tab]} /></>;
}

function ContentExplorerInner({ types }: { types: ContentType[] }) {
  const [query, setQuery] = useState("");
  const [page,setPage]=useState(1);
  const { items, total, hasMore } = useContentSearch(types, query, 80,0,page);
  const [selected, setSelected] = useState<string>();
  const selectedId = items.some((item) => item.id === selected) ? selected : items[0]?.id;
  const detail = useContentDetail(selectedId);
  const subjectLabel = types[0] === "price" ? "券種" : "用語";
  return <div className={styles.referenceGrid}><section className={styles.referenceTable}><div className={styles.toolbar}><SearchBox value={query} onChange={value=>{setQuery(value);setPage(1);}} /><span>{total}件・{page}ページ</span></div><table><thead><tr><th>{subjectLabel}</th><th>カテゴリ</th><th>詳細</th></tr></thead><tbody>{items.map((item) => <tr data-selected={selectedId === item.id} key={item.id}><td data-label={subjectLabel}><button className={styles.tableSelectButton} aria-pressed={selectedId === item.id} onClick={() => setSelected(item.id)}><strong>{item.title}</strong></button></td><td data-label="カテゴリ">{item.category}</td><td data-label="詳細"><ChevronRight size={16} /></td></tr>)}</tbody></table><div className={styles.toolbar}><button className={styles.secondaryButton} disabled={page===1} onClick={()=>{setPage(current=>Math.max(1,current-1));setSelected(undefined);}}>前のページ</button><button className={styles.secondaryButton} disabled={!hasMore} onClick={()=>{setPage(current=>current+1);setSelected(undefined);}}>次のページ</button></div></section><article className={styles.contentDetail} tabIndex={0} aria-label="コンテンツ詳細">{detail ? <><div className={styles.detailHeader}><span>{detail.category}</span><h2>{detail.title}</h2></div><div className={styles.readableBody}>{renderContentBody(detail)}</div></> : null}</article></div>;
}

function Videos() {
  const {items,total}=useContentSearch(["video"],"",50);
  const [selected,setSelected]=useState<string>();
  const selectedId=items.some(item=>item.id===selected)?selected:items[0]?.id;
  const detail=useContentDetail(selectedId);
  const videoUrl=useTrainingVideoUrl(selectedId);
  return <><PageTitle title="動画ライブラリ" description="公開済みの研修動画と文字版を確認できます。" /><Subnav items={trainingTabs} current="動画ライブラリ" /><div className={styles.videoGrid}><aside className={styles.videoList}><h2>研修動画</h2><p>{total}件</p>{items.map(item=><button data-selected={selectedId===item.id} onClick={()=>setSelected(item.id)} key={item.id}><span className={styles.thumbnail}><Play /></span><span><strong>{item.title}</strong><small>{item.category}</small></span></button>)}{!items.length?<p>公開済みの研修動画はありません。</p>:null}</aside><section className={styles.videoPlayer}>{detail?<>{videoUrl?<video className={styles.player} controls preload="metadata" src={videoUrl}>動画を再生できません。</video>:<div className={styles.player}><BookOpen/><span>動画ファイルはまだ登録されていません</span></div>}<h2>{detail.title}</h2><p>{detail.body||"文字版は登録されていません。"}</p></>:<><h2>動画を選択してください</h2><p>公開後の動画がここに表示されます。</p></>}</section></div></>;
}

function Roleplay({pilotContentAi}:{pilotContentAi:boolean}){
  const [scenarioQuery,setScenarioQuery]=useState("");const [scenarioPage,setScenarioPage]=useState(1);const {items,hasMore}=useContentSearch(["roleplay"],scenarioQuery,16,0,scenarioPage);const [selected,setSelected]=useState<string>();const selectedId=selected??items[0]?.id;const detail=useContentDetail(selectedId);
  const history=useRemote("roleplay-sessions",async()=>(await resources.roleplaySessions()).items);
  const [sessionId,setSessionId]=useState<string>();const [sessionStatus,setSessionStatus]=useState<"new"|"active"|"completed">("new");
  const [messages,setMessages]=useState<Array<{role:"staff"|"customer";text:string}>>([]);const [reply,setReply]=useState("");const [feedback,setFeedback]=useState<Array<{category:string;message:string}>>([]);const [contentPolicy,setContentPolicy]=useState<ContentPolicyDto>();const [selfNote,setSelfNote]=useState("");const [working,setWorking]=useState(false);const [error,setError]=useState("");
  function begin(itemId:string){setSelected(itemId);setSessionId(undefined);setSessionStatus("new");setMessages([]);setFeedback([]);setContentPolicy(undefined);setSelfNote("");setError("");}
  async function send(event:React.FormEvent){event.preventDefault();if(!reply.trim()||!selectedId||sessionStatus==="completed")return;const staff={role:"staff" as const,text:reply.trim()};const next=[...messages,staff];setMessages(next);setReply("");setWorking(true);setError("");try{const result=await resources.roleplayTurn(selectedId,[staff],sessionId);setSessionId(result.sessionId);setSessionStatus("active");setMessages([...next,{role:"customer",text:result.customerReply}]);setFeedback(result.feedback);setContentPolicy(result.contentPolicy);history.refresh();}catch{setError("応答を作成できませんでした。入力内容を保持したまま再度お試しください。");}finally{setWorking(false);}}
  async function resume(id:string){setWorking(true);setError("");try{const saved=await resources.roleplaySession(id);setSelected(saved.scenarioContentItemId);setSessionId(saved.status==="active"?saved.id:undefined);setSessionStatus(saved.status);setMessages(saved.turns.flatMap(turn=>[{role:"staff" as const,text:turn.staffText},{role:"customer" as const,text:turn.customerReply}]));setFeedback(saved.turns.at(-1)?.feedback??[]);setSelfNote(saved.selfNote??"");}catch{setError("練習履歴を読み込めませんでした。");}finally{setWorking(false);}}
  async function complete(){if(!sessionId||sessionStatus!=="active")return;setWorking(true);setError("");try{await resources.completeRoleplaySession(sessionId,selfNote);setSessionId(undefined);setSessionStatus("completed");history.refresh();}catch{setError("練習を完了できませんでした。最新の状態を確認してください。");}finally{setWorking(false);}}
  return <><PageTitle title="AIロープレ" description="現場に近いシナリオで、自由な会話を練習します。"/><Subnav items={trainingTabs} current="AIロープレ"/><PilotContentNotice enabled={pilotContentAi} policy={contentPolicy}/><div className={styles.roleplayGrid}><aside className={styles.scenarioList}><SearchBox value={scenarioQuery} onChange={value=>{setScenarioQuery(value);setScenarioPage(1);}} placeholder="シナリオを検索"/><h2>シナリオ</h2>{items.map(item=><button data-selected={selectedId===item.id} onClick={()=>begin(item.id)} key={item.id}><span>{item.category}・{item.difficulty??"標準"}{item.requiresReview?"・要確認":""}</span><strong>{displayLegacyTitle(item.title)}</strong></button>)}<div className={styles.toolbar}><button className={styles.secondaryButton} disabled={scenarioPage===1} onClick={()=>{setScenarioPage(current=>Math.max(1,current-1));setSelected(undefined);}}>前のページ</button><button className={styles.secondaryButton} disabled={!hasMore} onClick={()=>{setScenarioPage(current=>current+1);setSelected(undefined);}}>次のページ</button></div></aside><section className={styles.roleplayChat}><header><h2>{detail?displayLegacyTitle(detail.title):"シナリオを選択"}</h2><p>{typeof detail?.legacyPayload.customerProfile==="string"?detail.legacyPayload.customerProfile:detail?.body||"シナリオを選ぶと練習を始められます。"}</p></header><div className={styles.messages}>{messages.length?messages.map((message,index)=><p data-self={message.role==="staff"} key={`${message.text}-${index}`}>{message.text}</p>):<p>最初の声かけを入力してください。</p>}</div><form onSubmit={event=>void send(event)}><textarea rows={2} value={reply} onChange={event=>setReply(event.target.value)} disabled={sessionStatus==="completed"} placeholder={sessionStatus==="completed"?"完了済みの練習です":"お客様への返答を入力"}/><button disabled={!reply.trim()||working||!selectedId||sessionStatus==="completed"} aria-label="返答を送る"><Send/></button></form>{error?<p role="alert">{error}</p>:null}</section><aside className={styles.feedbackPane}><h2>今回のフィードバック</h2>{feedback.length?<ul>{feedback.map(item=><li key={`${item.category}-${item.message}`}><Check/>{item.message}</li>)}</ul>:<p>会話を進めると、良かった点と次の一歩を表示します。</p>}<label className={styles.selfNote}>自分用メモ<textarea rows={3} maxLength={2000} value={selfNote} onChange={event=>setSelfNote(event.target.value)} disabled={sessionStatus==="completed"}/></label><button className={styles.primaryButton} disabled={!sessionId||sessionStatus!=="active"||working} onClick={()=>void complete()}>{sessionStatus==="completed"?"練習完了":"練習を完了"}</button><section className={styles.roleplayHistory}><h3>自分の練習履歴</h3>{history.error?<p role="alert">履歴を読み込めませんでした。</p>:null}{(history.value??[]).slice(0,5).map(saved=><button key={saved.id} onClick={()=>void resume(saved.id)}><strong>{displayLegacyTitle(saved.title)}</strong><small>{formatDate(saved.startedAt)}・{saved.turnCount}往復・{saved.status==="completed"?"完了":"練習中"}</small></button>)}{!history.loading&&!history.value?.length?<p>練習履歴はありません。</p>:null}</section><div><strong>育成支援として表示</strong><p>点数、順位、人事評価には使用しません。</p></div></aside></div></>;
}

function ContentsAdmin() {
  const [type, setType] = useState<ContentType>("talk");
  const [revision,setRevision]=useState(0);
  const { items, total } = useContentSearch([type], "", 50,revision);
  const [selected, setSelected] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [creating,setCreating]=useState(false);
  const [savedVersion,setSavedVersion]=useState<{id:string;version:number}|null>(null);
  const [error,setError]=useState("");
  const [videoFile,setVideoFile]=useState<File|null>(null);
  const [videoState,setVideoState]=useState<"idle"|"working"|"done">("idle");
  const selectedId=creating?undefined:selected??items[0]?.id;
  const detail = useContentDetail(selectedId,revision);
  const previewVideoUrl=useTrainingVideoUrl(type==="video"?selectedId:undefined,revision);
  const publishVersion=savedVersion&&savedVersion.id===detail?.id?savedVersion.version:detail?.version;
  async function save(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);const title=String(form.get("title")??"");const category=String(form.get("category")??"");const body=String(form.get("body")??"");setError("");try{let target:{id:string;versionId:string;version:number};if(creating){target=await resources.createContent({type,stableKey:`manual-${type}-${crypto.randomUUID()}`,title,category,body:{body,tags:[]}});setSelected(target.id);setSavedVersion({id:target.id,version:target.version});setCreating(false);}else if(detail){target=await resources.updateContent(detail.id,{expectedVersion:publishVersion,title,category,body:{body,tags:detail.tags,legacyPayload:detail.legacyPayload,legacyId:detail.legacyId,sourceRef:detail.sourceRef},changeSummary:"管理画面から下書きを更新"});setSavedVersion({id:detail.id,version:target.version});}else return;if(type==="video"&&videoFile){setVideoState("working");await resources.uploadTrainingVideo(target.id,target.versionId,videoFile);setVideoFile(null);setVideoState("done");}setSaved(true);setRevision(value=>value+1);}catch{setVideoState("idle");setError("下書きまたは動画を保存できませんでした。ファイル形式と最新の版を確認してください。");}}
  async function publish(){if(!detail||!publishVersion)return;setError("");try{await resources.publishContent(detail.id,publishVersion);setSaved(true);setRevision(value=>value+1);}catch{setError("この版を公開できませんでした。最新の版を開き直してください。");}}
  const editorKey=creating?`create-${type}`:`${detail?.id}-${detail?.version}`;
  return <><PageTitle title="コンテンツ管理" description="現場で使う内容を一覧、編集、プレビューで確認します。" action={<button className={styles.primaryButton} onClick={()=>{setCreating(true);setSelected(undefined);setSaved(false);setError("");}}>新しい下書き</button>} /><Subnav items={adminTabs} current="コンテンツ"/><div className={styles.adminTriple}><section className={styles.adminList}><div className={styles.toolbar}><select aria-label="コンテンツ種別" value={type} onChange={event=>{setType(event.target.value as ContentType);setSelected(undefined);setCreating(false);setSaved(false);setVideoFile(null);setVideoState("idle");}}>{["talk","flow","glossary","price","manual","legal","video","roleplay"].map(value=><option value={value} key={value}>{typeLabel(value as ContentType)}</option>)}</select><span>{total}件</span></div><div className={styles.resultList}>{items.map(item=><button data-selected={!creating&&selectedId===item.id} onClick={()=>{setSelected(item.id);setCreating(false);setSaved(false);setError("");}} key={item.id}><span>{item.category}</span><strong>{item.title}</strong><small>{publicationStateLabel(item.publicationState).label}</small></button>)}</div></section><form className={styles.adminEditor} key={editorKey} onSubmit={event=>void save(event)}><h2>{creating?"新しい下書き":"編集"}</h2><label>タイトル<input name="title" maxLength={300} required defaultValue={creating?"":detail?.title??""}/></label><label>カテゴリ<input name="category" maxLength={200} defaultValue={creating?"":detail?.category??""}/></label><label>本文<textarea name="body" required defaultValue={creating?"":detail?.body??""} rows={14}/></label>{type==="video"?<label>動画ファイル（MP4 / WebM・2GB・4時間以内）<input type="file" accept="video/mp4,video/webm" onChange={event=>{setVideoFile(event.target.files?.[0]??null);setVideoState("idle");}}/>{videoState==="working"?<small role="status">動画を検査・保存しています…</small>:videoState==="done"?<small>動画を保存しました</small>:null}</label>:null}{error?<p role="alert">{error}</p>:null}<button className={styles.primaryButton} type="submit" disabled={(!creating&&!detail)||videoState==="working"}>{saved?<><Check size={17}/>保存しました</>:"下書きを保存"}</button><button className={styles.secondaryButton} type="button" disabled={creating||!detail||!publishVersion} onClick={()=>void publish()}>現在の版を公開</button></form><article className={styles.adminPreview}><span className={styles.kicker}>プレビュー</span>{type==="video"&&previewVideoUrl?<video className={styles.player} controls preload="metadata" src={previewVideoUrl} aria-label="下書き動画プレビュー">動画を再生できません。</video>:null}<h2>{creating?"新しいコンテンツ":detail?.title}</h2><p>{creating?"保存後に内容を確認できます。":detail?.body}</p></article></div></>;
}

function UsersAdmin({viewerId}:{viewerId?:string}) {
  const remote=useRemote("users",async()=>(await resources.users()).items);const users=remote.value??[];const [selectedId,setSelectedId]=useState<string>();const [confirming,setConfirming]=useState<"role"|"suspend"|null>(null);const [pendingRoles,setPendingRoles]=useState<string[]|null>(null);const [inviting,setInviting]=useState(false);const [inviteState,setInviteState]=useState<"idle"|"working"|"error">("idle");const selected=users.find(user=>user.id===selectedId)??users[0];const roleName=(role:string)=>({assessor:"査定員",manager:"管理者",educator:"教育担当",content_approver:"承認担当",system_admin:"システム管理者"}[role]??role);const roleOptions=["assessor","manager","educator","content_approver"];
  const roleDraft=pendingRoles??selected?.roles??[];
  const selectedIsSelf=Boolean(selected&&viewerId&&selected.id===viewerId);
  const selectedIsSystemAdmin=Boolean(selected?.roles.includes("system_admin"));
  const accessChangeLocked=selectedIsSelf||selectedIsSystemAdmin;
  async function applyRole(){if(!selected||!roleDraft.length||accessChangeLocked||roleDraft.includes("system_admin"))return;if(confirming!=="role"){setConfirming("role");return;}await resources.replaceRoles(selected.id,{roles:roleDraft,branchId:selected.branchId});setConfirming(null);setPendingRoles(null);remote.refresh();}
  async function suspend(){if(!selected||accessChangeLocked)return;if(confirming!=="suspend"){setConfirming("suspend");return;}await resources.updateUser(selected.id,{status:"suspended",expectedLockVersion:selected.lockVersion});setConfirming(null);remote.refresh();}
  async function invite(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setInviteState("working");try{await resources.inviteUser({displayName:String(form.get("displayName")??""),email:String(form.get("email")??""),roles:[String(form.get("role")??"assessor")]});setInviting(false);setInviteState("idle");remote.refresh();}catch{setInviteState("error");}}
  return <><PageTitle title="利用者・権限" description="利用者の所属、権限、利用状態を影響確認付きで管理します。" action={<button className={styles.primaryButton} onClick={()=>setInviting(true)}>利用者を招待</button>} /><Subnav items={adminTabs} current="利用者・権限"/><div className={styles.listDetail}><section className={styles.tablePane}>{remote.error?<p role="alert">利用者を読み込めませんでした。時間をおいて再読み込みしてください。</p>:null}<table><thead><tr><th>利用者</th><th>メール</th><th>権限</th><th>状態</th></tr></thead><tbody>{users.map(user=><tr data-selected={selected===user} key={user.id}><td data-label="利用者"><button className={styles.tableSelectButton} aria-pressed={selected===user} onClick={()=>{setSelectedId(user.id);setConfirming(null);setPendingRoles(user.roles);}}><strong>{user.displayName}</strong></button></td><td data-label="メール">{user.emailMasked}</td><td data-label="権限">{user.roles.map(roleName).join("、")}</td><td data-label="状態"><Status>{membershipStateLabel(user.status).label}</Status></td></tr>)}</tbody></table></section>{selected?<aside className={styles.detailPane}><span className={styles.kicker}>利用者詳細</span><h2>{selected.displayName}</h2><fieldset className={styles.roleChecklist} disabled={accessChangeLocked}><legend>業務権限（複数選択可）</legend>{roleOptions.map(role=><label key={role}><input type="checkbox" checked={roleDraft.includes(role)} onChange={event=>{const next=event.target.checked?[...new Set([...roleDraft,role])]:roleDraft.filter(value=>value!==role);setPendingRoles(next);setConfirming(null);}}/>{roleName(role)}</label>)}</fieldset>{selectedIsSelf?<p className={styles.notice}>自分自身の権限と利用状態は、この画面から変更できません。</p>:selectedIsSystemAdmin?<p className={styles.notice}>システム管理者は管理専用アカウントです。権限と利用状態は運用責任者が別経路で管理します。</p>:null}{!roleDraft.length?<p role="alert">権限を1件以上選択してください。</p>:null}{confirming?<div className={styles.notice}><AlertTriangle size={18}/><span>{confirming==="role"?"権限変更後は現在のセッションが失効します。":"利用停止後は対象利用者のセッションが失効します。"}もう一度同じ操作をすると確定します。</span></div>:null}<button className={styles.primaryButton} disabled={!roleDraft.length||accessChangeLocked} onClick={()=>void applyRole()}>{confirming==="role"?"権限変更を確定":"変更内容を確認"}</button><button className={styles.dangerButton} disabled={accessChangeLocked} onClick={()=>void suspend()}>{confirming==="suspend"?"利用停止を確定":"利用を停止"}</button></aside>:null}</div>{inviting?<Modal title="利用者を招待" onClose={()=>{setInviting(false);setInviteState("idle");}}><form className={styles.modalForm} onSubmit={event=>void invite(event)}><label>表示名<input name="displayName" maxLength={200} required autoComplete="name"/></label><label>業務用Googleアカウント<input name="email" type="email" maxLength={320} required autoComplete="email" placeholder="name@example.invalid"/></label><label>最初の業務権限<select name="role" defaultValue="assessor">{roleOptions.map(role=><option value={role} key={role}>{roleName(role)}</option>)}</select></label>{inviteState==="error"?<p role="alert">招待を登録できませんでした。アカウントと権限を確認してください。</p>:null}<footer><button type="button" className={styles.secondaryButton} onClick={()=>setInviting(false)}>キャンセル</button><button type="submit" className={styles.primaryButton} disabled={inviteState==="working"}>{inviteState==="working"?"登録しています…":"招待を登録"}</button></footer></form></Modal>:null}</>;
}

function Operations({capabilities}:{capabilities:string[]}) {
  const params = useSearchParams();
  const availableTabs=[
    ...(capabilities.includes("job:manage")?["ジョブ","AI機能"]:[]),
    ...(capabilities.includes("retention:manage")?["保存・削除"]:[]),
    ...(capabilities.includes("audit:read")?["監査ログ"]:[]),
  ];
  const requested=params.get("tab") === "retention" ? "保存・削除" : params.get("tab") === "audit" ? "監査ログ" : "ジョブ";
  const initial=availableTabs.includes(requested)?requested:availableTabs[0]??"ジョブ";
  const [tab, setTab] = useState(initial);
  return <><PageTitle title="システム運用" description="処理状況、機能制御、保存と削除、監査証跡を権限の範囲で確認します。" /><Subnav items={adminTabs} current="システム運用" />{capabilities.includes("job:manage")?<OperationsHealth onOpenJobs={()=>setTab("ジョブ")}/>:null}<div className={styles.segmented}>{availableTabs.map((item) => <button data-active={tab === item} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>{tab === "ジョブ" ? <OperationsJobs /> : tab === "AI機能"?<FeatureFlags/>:tab === "保存・削除" ? <Retention /> : <Audit />}</>;
}

function OperationsHealth({onOpenJobs}:{onOpenJobs:()=>void}){
  const remote=useRemote<OperationsHealthDto>("operations-health",resources.operationsHealth);
  const health=remote.value;
  const statusLabel=!health?"確認中":health.status==="critical"?"重大な異常あり":health.status==="warning"?"確認が必要":"正常";
  const alertLabels:Record<OperationsHealthDto["alerts"][number]["failureClass"],string>={STT_HEARTBEAT_STALE:"文字起こしの更新停止",STT_LRO_TIMEOUT:"Chirp 3処理の長時間化",RETRY_WAIT_OVERDUE:"再試行の遅延",MODEL_OUTPUT_INVALID:"AI出力形式の不整合",EVIDENCE_INVALID:"振り返り根拠の不整合",RETRY_LIMIT_EXCEEDED:"再試行上限到達"};
  return <section className={styles.healthSummary} aria-labelledby="operations-health-title" data-status={health?.status??"loading"}><header><div><h2 id="operations-health-title">稼働状況</h2><p>{health?`${formatDate(health.scannedAt)}時点の検査結果`:"最新の検査結果を読み込んでいます。"}</p></div><strong>{statusLabel}</strong></header>{remote.error?<div className={styles.recovery} role="alert"><p>稼働状況を読み込めませんでした。</p><button className={styles.secondaryButton} onClick={remote.refresh}><RotateCcw size={17}/>再読み込み</button></div>:health?<><div className={styles.healthMetrics}><article><span>警告</span><strong>{health.counts.warning}</strong></article><article><span>重大</span><strong>{health.counts.critical}</strong></article><article><span>検出件数</span><strong>{health.alerts.length}</strong></article></div>{health.alerts.length?<div className={styles.healthAlerts}>{health.alerts.slice(0,4).map(alert=><button key={`${alert.jobId}-${alert.failureClass}`} onClick={onOpenJobs}><span>{alert.severity==="critical"?"重大":"警告"}</span><strong>{alertLabels[alert.failureClass]??"運用異常"}</strong><small>{jobTypeLabel(alert.jobType).label}・試行 {alert.attempt}/{alert.maxAttempts}</small></button>)}</div>:<p className={styles.healthEmpty}><ShieldCheck size={17}/>監視対象の異常はありません。</p>}</>:null}</section>;
}

function FeatureFlags(){const remote=useRemote("feature-flags",async()=>(await resources.featureFlags()).items);const [working,setWorking]=useState<string>();const [error,setError]=useState("");const labels:Record<string,string>={pilot_content_ai:"未承認コンテンツのAI利用",content_approval:"カテゴリ承認",team_analytics:"チーム分析"};async function toggle(key:string,enabled:boolean){setWorking(key);setError("");try{await resources.updateFeatureFlag(key,enabled,enabled?"管理画面から機能を有効化":"障害・費用・品質リスクのため機能単位で停止");await remote.refresh();}catch{setError("機能状態を変更できませんでした。最新状態を再読み込みしてください。");}finally{setWorking(undefined);}}return <section className={styles.retentionPolicies}><header><div><h2>機能単位の緊急スイッチ</h2><p>PDF、文字起こし、履歴を止めず、AIや承認機能だけを制御します。</p></div></header>{error?<p role="alert">{error}</p>:null}<div>{(remote.value??[]).map(flag=><article key={flag.flagKey}><strong>{labels[flag.flagKey]??flag.flagKey}</strong><span>{flag.enabled?"稼働中":"停止中"}</span><small>{flag.rollbackNote}</small><button className={flag.enabled?styles.dangerButton:styles.primaryButton} disabled={working===flag.flagKey} onClick={()=>void toggle(flag.flagKey,!flag.enabled)}>{working===flag.flagKey?"変更中…":flag.enabled?"この機能だけ停止":"有効に戻す"}</button></article>)}</div>{remote.error?<p role="alert">機能状態を読み込めませんでした。</p>:null}</section>;}

function OperationsJobs(){
  const remote=useRemote("admin-jobs",async()=>(await resources.jobs()).items);
  const jobs=remote.value??[];
  const [selectedId,setSelectedId]=useState<string>();
  const selected=jobs.find(job=>job.id===selectedId)??jobs[0];
  const detail=useRemote<JobDto|null>(`admin-job:${selected?.id??"none"}`,()=>selected?resources.job(selected.id):Promise.resolve(null));
  const current=detail.value??selected;
  const [action,setAction]=useState<"idle"|"retry"|"cancel"|"error">("idle");
  async function retry(){if(!selected)return;setAction("retry");try{await resources.retryJob(selected.id);remote.refresh();detail.refresh();}catch{setAction("error");}}
  async function cancel(){if(!selected)return;setAction("cancel");try{await resources.cancelJob(selected.id);remote.refresh();detail.refresh();}catch{setAction("error");}}
  return <div className={styles.operationsGrid}><section className={styles.tablePane}>{remote.loading?<p role="status">ジョブを読み込んでいます。</p>:null}{remote.error?<p role="alert">ジョブを読み込めませんでした。</p>:null}<table><thead><tr><th>処理</th><th>対象</th><th>状態</th><th>開始</th></tr></thead><tbody>{jobs.map(job=><tr data-selected={selected===job} key={job.id}><td data-label="処理"><button className={styles.tableSelectButton} aria-pressed={selected===job} onClick={()=>{setSelectedId(job.id);setAction("idle");}}>{jobTypeLabel(job.jobType).label}</button></td><td data-label="対象">{entityTypeLabel(job.entityType).label}</td><td data-label="状態"><Status>{job.status}</Status></td><td data-label="開始">{formatDate(job.createdAt)}</td></tr>)}</tbody></table></section>{current?<aside className={styles.detailPane}><h2>{jobTypeLabel(current.jobType).label}・{entityTypeLabel(current.entityType).label}</h2><Status>{current.status}</Status><p>{jobStateLabel(current.status).description}</p><dl><div><dt>試行回数</dt><dd>{current.attemptCount} / {current.maxAttempts}</dd></div><div><dt>完了</dt><dd>{formatDate(current.finishedAt)}</dd></div></dl>{detail.loading?<p role="status">試行履歴を読み込んでいます。</p>:null}{detail.error?<p role="alert">ジョブ詳細を読み込めませんでした。</p>:null}{current.attempts?.length?<section><h3>試行履歴</h3><ol>{current.attempts.map(attempt=><li key={attempt.attemptNo}><strong>試行 {attempt.attemptNo}</strong><span>{attempt.resultStatus?attemptResultLabel(attempt.resultStatus).label:"実行中"}・{formatDate(attempt.startedAt)}</span>{attempt.errorCode?<small>技術詳細を確認してください</small>:null}</li>)}</ol></section>:null}<TechnicalDetails items={[{label:"ジョブID",value:current.id,copyable:true},{label:"エラーコード",value:current.errorCode,copyable:true},...(current.attempts??[]).filter(attempt=>attempt.errorCode).map(attempt=>({label:`試行 ${attempt.attemptNo} エラーコード`,value:attempt.errorCode,copyable:true}))]}/>{action==="error"?<p role="alert">状態が更新されています。詳細を再読み込みしてから操作してください。</p>:null}<div className={styles.actionGroup}><button className={styles.secondaryButton} disabled={!['failed','retry_wait'].includes(current.status)||action!=="idle"} onClick={()=>void retry()}><RotateCcw size={17}/>{action==="retry"?"受付済み":"今すぐ再試行"}</button><button className={styles.dangerButton} disabled={!['queued','running','retry_wait'].includes(current.status)||action!=="idle"} onClick={()=>void cancel()}>{action==="cancel"?"取消を要求しました":"処理を取り消す"}</button></div></aside>:null}</div>;
}
function Retention(){
  const policiesRemote=useRemote("retention-policies",resources.retentionPolicies);
  const deletionRemote=useRemote("deletions",async()=>(await resources.deletions()).items);
  const visitsRemote=useRemote("retention-visits",async()=>(await resources.visits()).items);
  const policies=policiesRemote.value?.policies??[];const items=deletionRemote.value??[];
  const [selectedId,setSelectedId]=useState<string>();const selected=items.find(item=>item.id===selectedId)??items[0];
  const [bindingVisitId,setBindingVisitId]=useState("");
  const bindingsRemote=useRemote<RetentionBindingDto[]>(`retention-bindings:${bindingVisitId||"none"}`,async()=>bindingVisitId?(await resources.retentionBindings(bindingVisitId)).items:[]);
  const [dialog,setDialog]=useState<"policy"|"deletion"|"hold"|null>(null);
  const [requestState,setRequestState]=useState<"idle"|"working"|"error">("idle");
  const policyLabel=(type:string)=>({pdf:"PDF",audio:"録音",video:"研修動画",transcript:"文字起こし",review:"振り返り",audit:"監査ログ"}[type]??type);
  const activePolicies=policies.filter(policy=>policy.status==="active");
  async function createPolicy(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setRequestState("working");try{await resources.createRetentionPolicy({dataType:String(form.get("dataType")),retentionDays:Number(form.get("retentionDays")),legalHoldSupported:form.get("legalHoldSupported")==="on",effectiveFrom:new Date(String(form.get("effectiveFrom"))).toISOString()});setDialog(null);setRequestState("idle");policiesRemote.refresh();}catch{setRequestState("error");}}
  async function requestDeletion(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);if(form.get("confirmation")!=="削除を要求"){setRequestState("error");return;}setRequestState("working");try{await resources.requestDeletion(String(form.get("visitId")),String(form.get("reasonCode")));setDialog(null);setRequestState("idle");deletionRemote.refresh();policiesRemote.refresh();}catch{setRequestState("error");}}
  async function changeHold(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(!selected)return;const form=new FormData(event.currentTarget);setRequestState("working");try{if(selected.status==="held")await resources.releaseLegalHold(selected.visitId,String(form.get("reason")));else await resources.createLegalHold(selected.visitId,String(form.get("reasonCode")),String(form.get("reason")));setDialog(null);setRequestState("idle");deletionRemote.refresh();}catch{setRequestState("error");}}
  return <><section className={styles.retentionPolicies}><header><div><h2>現在の保存方針</h2><p>有効な方針のみを表示しています。</p></div><div className={styles.actionGroup}><button className={styles.secondaryButton} onClick={()=>{setDialog("policy");setRequestState("idle");}}>保存方針を変更</button><button className={styles.dangerButton} onClick={()=>{setDialog("deletion");setRequestState("idle");}}>削除要求を作成</button></div></header><div>{activePolicies.map((policy:RetentionPolicyDto)=><article key={policy.id}><strong>{policyLabel(policy.dataType)}</strong><span>{policy.retentionDays}日</span><small>v{policy.version}・保持停止{policy.legalHoldSupported?"対応":"非対応"}</small></article>)}</div>{policiesRemote.error?<p role="alert">保存方針を読み込めませんでした。</p>:null}</section><section className={styles.retentionBindings} aria-labelledby="retention-bindings-title"><header><div><h2 id="retention-bindings-title">案件へ実際に適用された保存期限</h2><p>現在の方針ではなく、各データの作成時に固定された日数と削除予定日を表示します。</p></div><label>対象案件<select aria-label="保存期限を確認する案件" value={bindingVisitId} onChange={event=>setBindingVisitId(event.target.value)}><option value="">案件を選択</option>{(visitsRemote.value??[]).map(visit=><option value={visit.id} key={visit.id}>{visit.caseNumber}</option>)}</select></label></header>{bindingsRemote.loading&&bindingVisitId?<p role="status">適用済みの保存期限を読み込んでいます。</p>:null}{bindingsRemote.error?<p role="alert">保存期限を読み込めませんでした。案件への権限と最新の状態を確認してください。</p>:null}{bindingVisitId?<div className={styles.tablePane}><table><thead><tr><th>データ</th><th>状態</th><th>適用版</th><th>保存日数</th><th>削除予定日</th><th>保持停止</th></tr></thead><tbody>{(bindingsRemote.value??[]).map(binding=><tr key={`${binding.resourceType}-${binding.resourceId}`}><td data-label="データ">{policyLabel(binding.resourceType==="document"?"pdf":binding.resourceType==="recording"?"audio":binding.resourceType)}</td><td data-label="状態">{binding.status}</td><td data-label="適用版">v{binding.policyVersion}</td><td data-label="保存日数">{binding.retentionDays}日</td><td data-label="削除予定日">{formatDate(binding.retentionUntil)}</td><td data-label="保持停止">{binding.legalHoldActive?"設定中":"なし"}</td></tr>)}</tbody></table>{!bindingsRemote.loading&&!bindingsRemote.value?.length?<p>この案件には保存対象データがありません。</p>:null}<TechnicalDetails items={(bindingsRemote.value??[]).flatMap(binding=>[{label:`${policyLabel(binding.resourceType)} ポリシーID`,value:binding.policyId,copyable:true},{label:`${policyLabel(binding.resourceType)} データID`,value:binding.resourceId,copyable:true}])}/></div>:<p className={styles.muted}>案件を選ぶと、PDF・録音・文字起こし・振り返りの保存期限を確認できます。</p>}</section><div className={styles.operationsGrid}><section className={styles.tablePane}>{deletionRemote.loading?<p role="status">削除要求を読み込んでいます。</p>:null}<table><thead><tr><th>要求</th><th>対象</th><th>状態</th><th>要求日</th></tr></thead><tbody>{items.map((item,index)=><tr data-selected={selected===item} key={item.id}><td data-label="要求ID"><button className={styles.tableSelectButton} aria-pressed={selected===item} onClick={()=>setSelectedId(item.id)}>{`削除要求 ${index+1}`}</button></td><td data-label="対象">訪問案件</td><td data-label="状態"><Status>{item.status}</Status></td><td data-label="要求日">{formatDate(item.requestedAt)}</td></tr>)}</tbody></table>{!items.length&&!deletionRemote.loading?<p>削除要求はありません。</p>:null}</section>{selected?<aside className={styles.dangerPane}><AlertTriangle/><h2>削除要求の状態</h2><p>対象、保持停止、完了状態を確認してください。</p><dl><div><dt>対象</dt><dd>訪問案件</dd></div><div><dt>理由</dt><dd>管理者による削除要求</dd></div><div><dt>状態</dt><dd>{deletionStateLabel(selected.status).label}</dd></div><div><dt>完了</dt><dd>{formatDate(selected.completedAt)}</dd></div></dl><TechnicalDetails items={[{label:"削除要求ID",value:selected.id,copyable:true},{label:"訪問案件ID",value:selected.visitId,copyable:true},{label:"理由コード",value:selected.reasonCode,copyable:true},{label:"処理ジョブID",value:selected.jobId,copyable:true}]}/><button className={selected.status==="held"?styles.secondaryButton:styles.dangerButton} onClick={()=>{setDialog("hold");setRequestState("idle");}}>{selected.status==="held"?"保持停止を解除":"保持停止を設定"}</button></aside>:<aside className={styles.detailPane}><h2>削除要求はありません</h2><p>新しい要求は、対象案件と保存方針を確認してから作成します。</p></aside>}</div>
    {dialog==="policy"?<Modal title="保存方針を変更" onClose={()=>setDialog(null)}><form className={styles.modalForm} onSubmit={event=>void createPolicy(event)}><label>データ種別<select name="dataType" defaultValue="pdf">{["pdf","audio","transcript","review","audit"].map(type=><option key={type} value={type}>{policyLabel(type)}</option>)}</select></label><label>保存日数<input name="retentionDays" type="number" min="1" max="3650" required defaultValue="365"/></label><label>適用開始日<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)}/></label><label className={styles.consent}><input name="legalHoldSupported" type="checkbox" defaultChecked/><span>保持停止に対応する</span></label>{requestState==="error"?<p role="alert">保存日数と適用日を確認してください。</p>:null}<footer><button type="button" className={styles.secondaryButton} onClick={()=>setDialog(null)}>キャンセル</button><button type="submit" className={styles.primaryButton} disabled={requestState==="working"}>{requestState==="working"?"保存しています…":"新しい版を適用"}</button></footer></form></Modal>:null}
    {dialog==="deletion"?<Modal title="削除要求を作成" onClose={()=>setDialog(null)}><form className={styles.modalForm} onSubmit={event=>void requestDeletion(event)}><div className={styles.notice}><AlertTriangle size={18}/><span>受付後は非同期削除へ進み、保持停止がない場合は完了後に復元できません。</span></div><label>対象案件<select name="visitId" required defaultValue=""><option value="" disabled>案件を選択</option>{(visitsRemote.value??[]).map(visit=><option key={visit.id} value={visit.id}>{visit.caseNumber}</option>)}</select></label><label>理由コード<input name="reasonCode" required maxLength={50} defaultValue="manual_admin_request"/></label><label>確認のため「削除を要求」と入力<input name="confirmation" required autoComplete="off"/></label>{requestState==="error"?<p role="alert">対象案件、確認文言、保持停止の状態を確認してください。</p>:null}<footer><button type="button" className={styles.secondaryButton} onClick={()=>setDialog(null)}>キャンセル</button><button type="submit" className={styles.dangerButton} disabled={requestState==="working"}>{requestState==="working"?"受け付けています…":"削除を要求する"}</button></footer></form></Modal>:null}
    {dialog==="hold"&&selected?<Modal title={selected.status==="held"?"保持停止を解除":"保持停止を設定"} onClose={()=>setDialog(null)}><form className={styles.modalForm} onSubmit={event=>void changeHold(event)}><dl><div><dt>対象</dt><dd>訪問案件</dd></div><div><dt>削除状態</dt><dd>{deletionStateLabel(selected.status).label}</dd></div></dl>{selected.status!=="held"?<label>理由コード<input name="reasonCode" required maxLength={50} defaultValue="investigation"/></label>:null}<label>理由・根拠<textarea name="reason" required maxLength={500} rows={4}/></label>{requestState==="error"?<p role="alert">保持停止の最新状態を確認して、もう一度操作してください。</p>:null}<footer><button type="button" className={styles.secondaryButton} onClick={()=>setDialog(null)}>キャンセル</button><button type="submit" className={selected.status==="held"?styles.dangerButton:styles.primaryButton} disabled={requestState==="working"}>{requestState==="working"?"処理しています…":selected.status==="held"?"解除を確定":"設定を確定"}</button></footer></form></Modal>:null}
  </>;
}
function Audit(){const remote=useRemote("audits",async()=>(await resources.audits()).items);const items=remote.value??[];const [selectedId,setSelectedId]=useState<string>();const selected=items.find(item=>item.id===selectedId)??items[0];return <div className={styles.operationsGrid}><section className={styles.tablePane}>{remote.loading?<p role="status">監査ログを読み込んでいます。</p>:null}{remote.error?<p role="alert">監査ログを読み込めませんでした。</p>:null}<table><thead><tr><th>時刻</th><th>操作</th><th>結果</th></tr></thead><tbody>{items.map(item=><tr data-selected={selected===item} key={item.id}><td data-label="時刻">{formatDate(item.occurredAt)}</td><td data-label="操作"><button className={styles.tableSelectButton} aria-pressed={selected===item} onClick={()=>setSelectedId(item.id)}>{auditActionLabel(item.action).label}</button></td><td data-label="結果"><Status>{item.result}</Status></td></tr>)}</tbody></table></section>{selected?<aside className={styles.detailPane}><h2>{auditActionLabel(selected.action).label}</h2><dl><div><dt>発生</dt><dd>{formatDate(selected.occurredAt)}</dd></div><div><dt>対象</dt><dd>{entityTypeLabel(selected.resourceType).label}</dd></div><div><dt>結果</dt><dd>{auditResultLabel(selected.result).label}</dd></div></dl><TechnicalDetails items={[{label:"Request ID",value:selected.requestId,copyable:true},{label:"操作コード",value:selected.action,copyable:true},{label:"対象種別",value:selected.resourceType,copyable:true},{label:"対象ID",value:selected.resourceId,copyable:true}]}/><p>{selected.result==="denied"?"必要な権限がないため操作を拒否しました。":"監査イベントを記録しました。"}</p></aside>:null}</div>;}

export function approvalBody(value:Record<string,unknown>|null){return value?JSON.stringify(value,null,2):"（初版のため比較対象なし）";}

function Approval() {
  const remote=useRemote("approval-batches",resources.approvalBatches);const items=remote.value?.items??[];const candidates=remote.value?.candidates??[];const [selectedId,setSelectedId]=useState<string>();const selected=items.find(item=>item.id===selectedId)??items.find(item=>item.status==="in_review")??items[0];const [checks,setChecks]=useState<string[]>([]);const [reason,setReason]=useState("");const [decision,setDecision]=useState("");const [working,setWorking]=useState(false);const [decisionError,setDecisionError]=useState("");const criteria=["対象件数と版が固定されている","法令・価格を原文と照合した","個人情報や誤解を招く表現がない"];
  async function createBatch(type:string,category:string){setWorking(true);setDecisionError("");try{const created=await resources.createApprovalBatch({type,category});setSelectedId(created.id);await remote.refresh();}catch{setDecisionError("承認対象セットを作成できませんでした。対象が変更されていないか再確認してください。");}finally{setWorking(false);}}
  async function decide(value:"approved"|"rejected"){
    if(!selected||selected.selfSubmitted||!reason.trim())return;
    setWorking(true);setDecisionError("");
    try{await resources.decideApprovalBatch(selected.id,{decision:value,reason:reason.trim()});setDecision(value);setReason("");remote.refresh();}
    catch(error){setDecision("");setDecisionError(error instanceof ApiClientError&&error.status===403?"提出者または対象版の作成者は承認できません。別の承認担当者へ依頼してください。":"対象版が変更された可能性があります。最新状態を再読み込みしてください。");}
    finally{setWorking(false);}
  }
  return <><PageTitle title="コンテンツ承認" description="カテゴリと版を固定した承認対象セットで確認し、稼働を止めず正式版へ切り替えます。" /><Subnav items={adminTabs} current="コンテンツ承認"/>{remote.error?<div className={styles.recovery} role="alert"><p>承認情報を読み込めませんでした。</p><button className={styles.secondaryButton} onClick={remote.refresh}><RotateCcw size={17}/>再読み込み</button></div>:null}<div className={styles.approvalGrid}><aside className={styles.approvalList}><h2>承認対象セット</h2>{items.map(item=><button data-selected={selected===item} onClick={()=>{setSelectedId(item.id);setChecks([]);setReason("");setDecision("");setDecisionError("");}} key={item.id}><span>{contentTypeLabel(item.type).label}・{approvalStateLabel(item.status).label}{item.selfSubmitted?"・自分が提出":""}</span><strong>{businessText(item.category||"未分類")}</strong><small>{item.itemCount}件・承認 {item.approvalCount}/{item.requiredApprovals}</small></button>)}<h2>承認対象セットを作成</h2>{candidates.map(item=><button disabled={working} onClick={()=>void createBatch(item.type,item.category)} key={`${item.type}:${item.category}`}><span>{contentTypeLabel(item.type).label}・{item.requiredApprovals}名承認</span><strong>{businessText(item.category||"未分類")}</strong><small>{item.itemCount}件を固定</small></button>)}</aside>{selected?<section className={styles.diffPane}><header><span>{contentTypeLabel(selected.type).label}・{approvalStateLabel(selected.status).label}</span><h2>{businessText(selected.category||"未分類")}</h2><p>{selected.itemCount}件・承認 {selected.approvalCount}/{selected.requiredApprovals}</p><small>対象固定済み・完全性確認済み</small></header>{selected.selfSubmitted?<div className={styles.notice} role="status"><ShieldCheck size={18}/><span>提出者本人は判断できません。別の承認担当者が確認してください。</span></div>:null}<div className={styles.tablePane}><table><thead><tr><th>対象</th><th>版</th><th>原文確認</th></tr></thead><tbody>{selected.items.map(item=><tr key={item.versionId}><td>{item.title}</td><td>v{item.version}</td><td>照合対象</td></tr>)}</tbody></table></div><TechnicalDetails items={[{label:"承認対象セットID",value:selected.id,copyable:true},{label:"対象固定値（SHA-256）",value:selected.snapshotHash,copyable:true},...selected.items.map(item=>({label:`${item.title} 原文ハッシュ`,value:item.sourceHash,copyable:true}))]}/>{selected.decisions.length?<section><h3>判断履歴</h3>{selected.decisions.map((item,index)=><p key={`${item.decidedAt}-${index}`}>{item.decidedBy}・{approvalStateLabel(item.decision).label}・{item.reason}</p>)}</section>:null}{selected.status==="in_review"?<><div className={styles.approvalChecklist}><h3>承認基準</h3>{criteria.map(item=><label key={item}><input type="checkbox" checked={checks.includes(item)} onChange={event=>setChecks(current=>event.target.checked?[...current,item]:current.filter(value=>value!==item))}/>{item}</label>)}<label>判断理由<textarea rows={3} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)} required/></label></div>{decisionError?<div className={styles.recovery} role="alert"><p>{decisionError}</p><button className={styles.secondaryButton} onClick={()=>{setDecisionError("");remote.refresh();}}><RotateCcw size={17}/>最新状態を再読み込み</button></div>:null}<div className={styles.stickyActions}><button className={styles.secondaryButton} disabled={working||selected.selfSubmitted||!reason.trim()} onClick={()=>void decide("rejected")}>{decision==="rejected"?"差し戻しました":"承認対象セットを差し戻す"}</button><button className={styles.primaryButton} disabled={checks.length!==criteria.length||selected.selfSubmitted||working||!reason.trim()} onClick={()=>void decide("approved")}>{decision==="approved"?"判断を保存しました":working?"保存しています…":"承認対象セットを承認"}</button></div></>:null}</section>:<section className={styles.diffPane}><h2>承認対象はありません</h2><p>未承認カテゴリが追加されると、ここから承認対象セットを作成できます。</p></section>}</div></>;
}

function Analytics(){const remote=useRemote("analytics",resources.analytics);const groups=remote.value?.groups??[];const data=groups.map(group=>({name:group.name,value:group.visitCount?Math.round(group.reviewCount/group.visitCount*100):0,count:group.visitCount}));const overall=Math.round(groups.reduce((sum,group)=>sum+group.reviewCount,0)/Math.max(1,groups.reduce((sum,group)=>sum+group.visitCount,0))*100);return <><PageTitle title="チーム分析" description="店舗単位の集約値から、支援が必要なテーマを確認します。"/><Subnav items={adminTabs} current="チーム分析"/>{remote.error?<p role="alert">集約値を表示できません。対象母数または利用権限を確認してください。</p>:null}{remote.loading?<p role="status">集約値を読み込んでいます。</p>:null}<div className={styles.metrics}><article><span>振り返り実施率</span><strong>{groups.length?`${overall}%`:"—"}</strong><small>集約値</small></article><article><span>対象店舗</span><strong>{groups.length}</strong><small>最小母数 {remote.value?.minimumCohort??"—"}</small></article><article><span>個人データ</span><strong>非表示</strong><small>順位付けなし</small></article></div><div className={styles.analyticsGrid}><section><h2>店舗別の振り返り実施率</h2><div className={styles.barChart}>{data.map(item=><div key={item.name}><span>{item.name}</span><i><b style={{width:`${item.value}%`}}/></i><strong>{item.value}%</strong></div>)}</div></section><section><h2>同じ値を表で確認</h2><table><thead><tr><th>店舗</th><th>実施率</th><th>件数</th></tr></thead><tbody>{data.map(item=><tr key={item.name}><td data-label="店舗">{item.name}</td><td data-label="実施率">{item.value}%</td><td data-label="件数">{item.count}件</td></tr>)}</tbody></table></section></div></>;}

function Status({ children }: { children: React.ReactNode }) { const value=typeof children==="string"?statusDisplayLabel(children).label:children;return <span className={styles.status}>{value}</span>; }
function typeLabel(type: ContentType) { return contentTypeLabel(type).label; }
function renderContentBody(detail: ContentDetail) {
  const payload = detail.legacyPayload;
  if (detail.type === "flow" && Array.isArray(payload.steps)) return <><p>{String(payload.trigger ?? "")}</p><ol>{payload.steps.map((step) => <li key={String(step)}>{String(step)}</li>)}</ol>{typeof payload.point === "string" ? <p><strong>ポイント：</strong>{payload.point}</p> : null}</>;
  if (detail.type === "price") return <><p>{detail.body}</p>{Object.entries(payload).filter(([, value]) => typeof value === "string" || typeof value === "number").slice(0, 8).map(([key,value]) => <dl key={key}><dt>{key}</dt><dd>{String(value)}</dd></dl>)}</>;
  return <p>{detail.body}</p>;
}
