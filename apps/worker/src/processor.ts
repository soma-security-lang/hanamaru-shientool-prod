import { createHash, randomUUID } from "node:crypto";
import type { RequestContext } from "@hanamaru/contracts";
import type {
  HanamaruRepository,
  RepositoryTransaction,
} from "@hanamaru/database";
import type {
  PlatformProviders,
  SpeechTranscriptionResult,
  StorageProvider,
  TokenCipher,
} from "@hanamaru/platform";
import { createTokenCipher } from "@hanamaru/platform";

interface ClaimedJob {
  id: string;
  organization_id: string;
  job_type: string;
  entity_type: string;
  entity_id: string;
  input_redacted: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  requested_by_membership_id: string;
}

interface StoredObjectRow {
  id: string;
  object_name: string;
  object_generation: string;
  mime_type: string;
  bucket_name: string;
}

interface ExpiredUploadRow {
  id: string;
  visit_id: string;
  object_name: string;
}

interface TranscriptionOperationRow {
  provider_operation_id: string | null;
  provider_operation_state: Record<string,unknown>;
  provider_operation_started_at: Date | null;
}

interface VisitTranscriptionCleanupRow extends TranscriptionOperationRow {
  id:string;
}

interface TranscriptionRecording {
  id:string;
  visit_id:string;
  consent_id:string;
  bucket_name:string;
  object_name:string;
  object_generation:string;
  mime_type:string;
  size_bytes:string;
  duration_ms:string;
}

type HandlerOutcome="deferred"|void;
type ReviewResult=Awaited<ReturnType<PlatformProviders["ai"]["review"]>>;
type QualitySegment={id:string;start_ms:number;end_ms:number;speaker_label:string|null;text:string};
type QualityMetrics={segmentCount:number;chunkCount:number;maxLabelsPerChunk:number;speechOccupancyRatio:number};

export const QUALITY_ASSESSMENT_MAX_SEGMENTS_PER_REQUEST=160;
export const QUALITY_ASSESSMENT_MAX_TEXT_CHARACTERS_PER_SEGMENT=1000;

function boundedQualityText(value:string):string{
  const normalized=value.normalize("NFKC").trim();
  let bounded=normalized.slice(0,QUALITY_ASSESSMENT_MAX_TEXT_CHARACTERS_PER_SEGMENT);
  const finalCodeUnit=bounded.charCodeAt(bounded.length-1);
  if(finalCodeUnit>=0xd800&&finalCodeUnit<=0xdbff)bounded=bounded.slice(0,-1);
  return bounded;
}

export function transcriptQualityInputChunks(segments:QualitySegment[]):QualitySegment[][]{
  const bounded=segments.map(segment=>({...segment,text:boundedQualityText(segment.text)}));
  const chunks:QualitySegment[][]=[];
  for(let offset=0;offset<bounded.length;offset+=QUALITY_ASSESSMENT_MAX_SEGMENTS_PER_REQUEST){
    chunks.push(bounded.slice(offset,offset+QUALITY_ASSESSMENT_MAX_SEGMENTS_PER_REQUEST));
  }
  return chunks;
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const reviewCategories=["strength","improvement","talk","compliance","next_action","revisit"] as const;
export function reviewChunks(segments:Array<{id:string;text:string;sequence_no:number}>,targetCharacters=16000){
  const chunks:Array<typeof segments>=[];let current:typeof segments=[];let size=0;
  for(const segment of segments){const next=segment.text.length+1;if(current.length&&size+next>targetCharacters){chunks.push(current);current=[];size=0;}current.push(segment);size+=next;}
  if(current.length)chunks.push(current);return chunks;
}
export function aggregateReviewChunks(results:ReviewResult[]):ReviewResult{
  const findings=reviewCategories.map(category=>{const matches=results.flatMap(result=>result.findings.filter(finding=>finding.category===category));if(!matches.length)throw new Error(`PROVIDER_PERMANENT: review category missing: ${category}`);let title=matches[0]!.title;let description=[...new Set(matches.map(item=>item.description))].join("\n").slice(0,8000);
    if(category==="talk")description=[...new Set(matches.flatMap(item=>item.description.split("\n")).filter(Boolean))].slice(0,3).join("\n");
    if(category==="compliance"){
      const labels=["告知","クーリングオフ","書面交付","押し買い"] as const;const priority={"✅":3,"⚠️":2,"❌":1} as const;const status=(line:string):keyof typeof priority|undefined=>line.includes("✅")?"✅":line.includes("⚠️")?"⚠️":line.includes("❌")?"❌":undefined;
      description=labels.map(label=>{const candidates=matches.flatMap(item=>item.description.split("\n")).filter(line=>line.startsWith(`${label}:`));const selected=candidates.sort((a,b)=>(priority[status(b)??"❌"])-(priority[status(a)??"❌"]))[0];return selected??`${label}: ⚠️ 長文統合時に判定できませんでした`;}).join("\n");
    }
    if(category==="revisit"){
      const scorePriority={高:3,中:2,低:1};const scored=matches.map(item=>({item,score:(item.title.match(/[高中低]/u)?.[0]??item.description.match(/判定:\s*([高中低])/u)?.[1]??"低") as keyof typeof scorePriority})).sort((a,b)=>scorePriority[b.score]-scorePriority[a.score]);const selected=scored[0]!;const patterns=[...new Set(matches.flatMap(item=>item.description.match(/該当パターン:\s*(.+)/u)?.[1]?.split("、")??[]).filter(pattern=>pattern&&pattern!=="なし"))];title=`再訪問・アポ可能性：${selected.score}`;description=`判定: ${selected.score}\n理由: ${[...new Set(matches.map(item=>item.description.match(/理由:\s*(.+)/u)?.[1]).filter((item):item is string=>Boolean(item)))].join(" ").slice(0,6000)}\n該当パターン: ${patterns.length?patterns.join("、"):"なし"}`;
    }
    return{category,title,description,recommendedAction:(()=>{const actions=[...new Set(matches.map(item=>item.recommendedAction).filter((item):item is string=>Boolean(item)))];return actions.length?actions.join("\n").slice(0,4000):null;})(),evidenceSegmentIds:[...new Set(matches.flatMap(item=>item.evidenceSegmentIds))]};});
  return{model:results[0]?.model??"",summary:[...new Set(results.map(result=>result.summary))].join("\n").slice(0,8000),findings};
}
const pilotContentNotice =
  "限定運用の未承認コンテンツを使用しています。正式な承認済み情報ではないため、原文と照合して判断してください。";
const contentPolicy = (pilotEnabled: boolean, usesPilot: boolean,sources:Array<{id:string;versionId:string}>=[]) => ({
  mode: usesPilot ? ("pilot" as const) : ("published" as const),
  pilotContentEnabled: pilotEnabled,
  usesUnapprovedContent: usesPilot,
  requiresHumanReview: usesPilot,
  contentIds:[...new Set(sources.map(source=>source.id))],
  contentVersionIds:[...new Set(sources.map(source=>source.versionId))],
  policyNoticeVersion:"pilot-content-v1.0",
  notice: usesPilot ? pilotContentNotice : null,
});

function extractionValueType(property:Record<string,unknown>):"text"|"number"|"date"|"boolean"|"json"{
  if(property.type==="string"&&property.format==="date")return"date";
  if(property.type==="number"||property.type==="integer")return"number";
  if(property.type==="boolean")return"boolean";
  if(property.type==="object"||property.type==="array")return"json";
  return"text";
}

function normalizedExtractionValue(property:Record<string,unknown>,raw:unknown):{type:"text"|"number"|"date"|"boolean"|"json";value:unknown}|null{
  if(raw===null||raw===undefined)return null;
  if(property.type==="string"&&property.format==="date"){
    const value=String(raw).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(value)?{type:"date",value}:null;
  }
  if(property.type==="number"||property.type==="integer"){
    const value=Number(raw);
    return Number.isFinite(value)?{type:"number",value}:null;
  }
  if(property.type==="boolean"){
    if(typeof raw==="boolean")return{type:"boolean",value:raw};
    if(raw==="true"||raw==="false")return{type:"boolean",value:raw==="true"};
    return null;
  }
  if(property.type==="object"||property.type==="array"){
    if(typeof raw==="object")return{type:"json",value:raw};
    try{return{type:"json",value:JSON.parse(String(raw))};}catch{return null;}
  }
  const value=String(raw).trim();
  const maxLength=Number(property.maxLength??0);
  if(!value||(Number.isFinite(maxLength)&&maxLength>0&&value.length>maxLength))return null;
  if(typeof property.pattern==="string"&&!new RegExp(property.pattern).test(value))return null;
  return{type:"text",value};
}
export const driveCopyObjectName = (
  organizationId: string,
  visitId: string,
  importId: string,
  copyId: string = randomUUID(),
) =>
  `organizations/${organizationId}/visits/${visitId}/recordings/${importId}/copies/${copyId}/source`;

export async function cleanupExpiredUploadObjects(
  repository: HanamaruRepository,
  storage: StorageProvider,
  ctx: RequestContext,
  job: Pick<ClaimedJob,"id"|"organization_id">,
):Promise<number>{
  let deleted=0;
  for(let batch=0;batch<20;batch+=1){
    const candidates=await repository.withContext(ctx,async tx=>tx.query<ExpiredUploadRow>(
      `SELECT u.id,u.visit_id,u.object_name
         FROM upload_sessions u
        WHERE u.organization_id=$1 AND u.completed_at IS NULL
          AND u.expires_at<now()-interval '24 hours'
          AND NOT EXISTS(SELECT 1 FROM legal_holds h WHERE h.organization_id=u.organization_id AND h.visit_id=u.visit_id AND h.released_at IS NULL)
        ORDER BY u.expires_at,u.id LIMIT 500`,
      [job.organization_id],
    ));
    if(!candidates.rowCount)break;
    let progressed=0;
    for(const upload of candidates.rows){
      const claimed=await repository.withContext(ctx,async tx=>{
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[upload.visit_id]);
        await tx.query("DELETE FROM visit_deletion_fences f WHERE f.organization_id=$1 AND f.visit_id=$2 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=f.job_id AND j.status='running' AND j.lease_expires_at>now())",[job.organization_id,upload.visit_id]);
        const eligible=await tx.query(
          `SELECT u.id FROM upload_sessions u
            WHERE u.organization_id=$1 AND u.id=$2 AND u.completed_at IS NULL
              AND u.expires_at<now()-interval '24 hours'
              AND NOT EXISTS(SELECT 1 FROM legal_holds h WHERE h.organization_id=u.organization_id AND h.visit_id=u.visit_id AND h.released_at IS NULL)
            FOR UPDATE`,
          [job.organization_id,upload.id],
        );
        if(!eligible.rowCount)return false;
        const fence=await tx.query(
          "INSERT INTO visit_deletion_fences(organization_id,visit_id,job_id,operation) VALUES($1,$2,$3,'retention') ON CONFLICT(organization_id,visit_id) DO UPDATE SET job_id=EXCLUDED.job_id,operation=EXCLUDED.operation,created_at=now() WHERE visit_deletion_fences.job_id=EXCLUDED.job_id RETURNING visit_id",
          [job.organization_id,upload.visit_id,job.id],
        );
        return Boolean(fence.rowCount);
      });
      if(!claimed)continue;
      try{await storage.deleteIncompleteUpload(upload.object_name);}
      catch(error){await repository.withContext(ctx,async tx=>tx.query("DELETE FROM visit_deletion_fences WHERE organization_id=$1 AND visit_id=$2 AND job_id=$3",[job.organization_id,upload.visit_id,job.id])).catch(()=>undefined);throw error;}
      const removed=await repository.withContext(ctx,async tx=>{
        const result=await tx.query("DELETE FROM upload_sessions WHERE organization_id=$1 AND id=$2 AND completed_at IS NULL AND expires_at<now()-interval '24 hours'",[job.organization_id,upload.id]);
        await tx.query("DELETE FROM visit_deletion_fences WHERE organization_id=$1 AND visit_id=$2 AND job_id=$3",[job.organization_id,upload.visit_id,job.id]);
        return result.rowCount??0;
      });
      deleted+=removed;progressed+=removed;
    }
    if(candidates.rows.length<500||progressed===0)break;
  }
  return deleted;
}
const speechPhrases = [
  "ロレックス",
  "エルメス",
  "ルイ・ヴィトン",
  "シャネル",
  "カルティエ",
  "オメガ",
  "パテック フィリップ",
  "18金",
  "24金",
  "プラチナ",
  "ダイヤモンド",
  "査定額",
  "買取価格",
  "クーリングオフ",
  "書面交付",
  "押し買い",
];

function safeErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : "unknown";
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/gs:\/\/\S+/gi, "[gcs-object]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{40,}/g, "[credential]")
    .slice(0, 500);
}

function speakerChunk(label:string|null):string{
  const match=label?.match(/^(chunk-[^:]+):/u);
  return match?.[1]??"single";
}

export function transcriptQualityMetrics(segments:QualitySegment[],durationMs:number):QualityMetrics{
  const labelsByChunk=new Map<string,Set<string>>();
  const intervals=segments
    .filter(segment=>segment.end_ms>segment.start_ms)
    .map(segment=>[segment.start_ms,segment.end_ms] as const)
    .sort((a,b)=>a[0]-b[0]);
  for(const segment of segments){
    const chunk=speakerChunk(segment.speaker_label);
    const labels=labelsByChunk.get(chunk)??new Set<string>();
    if(segment.speaker_label)labels.add(segment.speaker_label);
    labelsByChunk.set(chunk,labels);
  }
  let covered=0;let start=-1;let end=-1;
  for(const [nextStart,nextEnd] of intervals){
    if(start<0){start=nextStart;end=nextEnd;continue;}
    if(nextStart<=end){end=Math.max(end,nextEnd);continue;}
    covered+=end-start;start=nextStart;end=nextEnd;
  }
  if(start>=0)covered+=end-start;
  return{
    segmentCount:segments.length,
    chunkCount:labelsByChunk.size,
    maxLabelsPerChunk:Math.max(0,...[...labelsByChunk.values()].map(labels=>labels.size)),
    speechOccupancyRatio:durationMs>0?Math.round(Math.min(1,covered/durationMs)*10_000)/10_000:0,
  };
}

export function deterministicTranscriptQualityFlags(metrics:QualityMetrics):Array<"many_speakers">{
  return metrics.maxLabelsPerChunk>=4?["many_speakers"]:[];
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /PROVIDER_TEMPORARY|QUOTA|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|timeout|ECONNRESET|ETIMEDOUT|429|502|503|504/i.test(
    message,
  );
}

export function classifyFailure(error:unknown,retryable:boolean):"MODEL_OUTPUT_INVALID"|"EVIDENCE_INVALID"|"PROVIDER_TEMPORARY"|"PROVIDER_PERMANENT"{
  const message=error instanceof Error?error.message:"";
  if(/evidence|unknown segment|根拠/iu.test(message))return"EVIDENCE_INVALID";
  if(/model output|model returned|output contract|missing review|invalid transcript quality|quality flag/iu.test(message))return"MODEL_OUTPUT_INVALID";
  return retryable?"PROVIDER_TEMPORARY":"PROVIDER_PERMANENT";
}

/**
 * Every handler follows three phases:
 * 1. short DB prepare/claim transaction,
 * 2. external provider call with no DB transaction held,
 * 3. short DB finalize transaction guarded by the prepared status.
 */
export class WorkerProcessor {
  private readonly cipher: TokenCipher;

  constructor(
    private readonly repository: HanamaruRepository,
    private readonly providers: PlatformProviders,
    private readonly revision = process.env.K_REVISION ?? "local",
  ) {
    this.cipher = createTokenCipher();
  }

  private async retentionPolicy(
    tx: RepositoryTransaction,
    organizationId: string,
    dataType: "pdf" | "audio" | "transcript" | "review" | "audit",
  ) {
    const result = await tx.query<{ id: string; retention_days: number }>(
      "SELECT id,retention_days FROM retention_policies WHERE organization_id=$1 AND data_type=$2 AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1",
      [organizationId, dataType],
    );
    if (!result.rows[0])
      throw new Error(`ACTIVE_RETENTION_POLICY_REQUIRED:${dataType}`);
    return result.rows[0];
  }

  private async assessTranscriptQuality(
    ctx:RequestContext,
    organizationId:string,
    transcriptId:string,
  ):Promise<void>{
    const prepared=await this.repository.withContext(ctx,async tx=>{
      const existing=await tx.query<{model_name:string|null}>(
        "SELECT model_name FROM transcript_quality_assessments WHERE organization_id=$1 AND transcript_id=$2",
        [organizationId,transcriptId],
      );
      if(existing.rows[0]?.model_name)return null;
      const transcript=await tx.query<{duration_ms:string}>(
        "SELECT r.duration_ms::text FROM transcripts t JOIN recordings r ON r.id=t.recording_id AND r.organization_id=t.organization_id WHERE t.organization_id=$1 AND t.id=$2",
        [organizationId,transcriptId],
      );
      if(!transcript.rows[0])throw new Error("PROVIDER_PERMANENT: transcript not available for quality assessment");
      const segments=await tx.query<QualitySegment>(
        "SELECT id,start_ms::int,end_ms::int,speaker_label,COALESCE(edited_text,text) text FROM transcript_segments WHERE organization_id=$1 AND transcript_id=$2 ORDER BY sequence_no",
        [organizationId,transcriptId],
      );
      return{durationMs:Number(transcript.rows[0].duration_ms),segments:segments.rows};
    });
    if(!prepared)return;
    const metrics=transcriptQualityMetrics(prepared.segments,prepared.durationMs);
    const deterministicFlags=deterministicTranscriptQualityFlags(metrics);
    let status:"evaluated"|"assessment_unavailable"="evaluated";
    let modelName:string|null=null;
    let qualityFailureClass:"MODEL_OUTPUT_INVALID"|"EVIDENCE_INVALID"|null=null;
    let confidence:number|null=deterministicFlags.length?1:null;
    const flags=new Set<string>(deterministicFlags);
    const evidenceIds=new Set<string>();
    try{
      if(!prepared.segments.length)throw new Error("quality assessment requires transcript segments");
      for(const chunk of transcriptQualityInputChunks(prepared.segments)){
        const validIds=new Set(chunk.map(segment=>segment.id));
        const result=await this.providers.ai.assessTranscriptQuality({
          durationMs:prepared.durationMs,
          segments:chunk.map(segment=>({id:segment.id,startMs:segment.start_ms,endMs:segment.end_ms,speakerLabel:segment.speaker_label,text:segment.text})),
        });
        modelName=result.model;
        for(const flag of result.flags){
          if(!flag.evidenceSegmentIds.length||flag.evidenceSegmentIds.some(id=>!validIds.has(id)))throw new Error("quality evidence references an unknown segment");
          flags.add(flag.type);
          confidence=Math.max(confidence??0,flag.confidence);
          for(const id of flag.evidenceSegmentIds)evidenceIds.add(id);
        }
      }
    }catch(error){
      status="assessment_unavailable";
      flags.clear();
      for(const flag of deterministicFlags)flags.add(flag);
      flags.add("assessment_unavailable");
      confidence=null;
      modelName=null;
      evidenceIds.clear();
      const classified=classifyFailure(error,isRetryable(error));
      qualityFailureClass=classified==="MODEL_OUTPUT_INVALID"||classified==="EVIDENCE_INVALID"?classified:null;
    }
    await this.repository.withContext(ctx,async tx=>{
      const assessmentId=randomUUID();
      const saved=await tx.query<{id:string}>(
        `INSERT INTO transcript_quality_assessments(id,organization_id,transcript_id,status,model_name,failure_class,flags,confidence,metrics)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(transcript_id) DO UPDATE SET status=EXCLUDED.status,model_name=EXCLUDED.model_name,failure_class=EXCLUDED.failure_class,
           flags=EXCLUDED.flags,confidence=EXCLUDED.confidence,metrics=EXCLUDED.metrics,
           continuation_decision=NULL,acknowledged_by_membership_id=NULL,acknowledged_at=NULL,
           lock_version=transcript_quality_assessments.lock_version+1,updated_at=now()
         WHERE transcript_quality_assessments.model_name IS NULL
         RETURNING id`,
        [assessmentId,organizationId,transcriptId,status,modelName,qualityFailureClass,[...flags],confidence,metrics],
      );
      const persistedId=saved.rows[0]?.id;
      if(!persistedId)return;
      await tx.query("DELETE FROM transcript_quality_evidence WHERE organization_id=$1 AND assessment_id=$2",[organizationId,persistedId]);
      for(const segmentId of evidenceIds)await tx.query(
        "INSERT INTO transcript_quality_evidence(organization_id,assessment_id,transcript_id,transcript_segment_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [organizationId,persistedId,transcriptId,segmentId],
      );
      await tx.audit("transcript.quality_assessed","transcript",transcriptId,status==="evaluated"?"allowed":"failed",{flags:[...flags],model:modelName??"unavailable"});
    });
  }

  async process(
    jobId: string,
    traceId: string = randomUUID(),
  ): Promise<
    "succeeded" | "retry_wait" | "failed" | "cancelled" | "not_claimed"
  > {
    const claimed = await this.repository.system<ClaimedJob>(
      "SELECT * FROM claim_job($1,$2,$3)",
      [jobId, this.revision, traceId],
    );
    const job = claimed.rows[0];
    if (!job) return "not_claimed";

    const membership = await this.repository.system<{ branch_id: string }>(
      "SELECT branch_id FROM memberships WHERE organization_id=$1 AND id=$2",
      [job.organization_id, job.requested_by_membership_id],
    );
    const ctx: RequestContext = {
      requestId: `job-${job.id}`,
      traceId,
      organizationId: job.organization_id,
      membershipId: job.requested_by_membership_id,
      branchId: membership.rows[0]?.branch_id ?? job.organization_id,
      roles: [],
      capabilities: [],
      authorizationScopes: [],
    };

    const heartbeat = setInterval(() => {
      void this.repository
        .system("SELECT heartbeat_job($1,$2)", [job.id, job.attempt_count])
        .catch((error: unknown) => {
          console.error("worker heartbeat failed", {
            jobId: job.id,
            error: safeErrorDetail(error),
          });
        });
    }, 60_000);
    heartbeat.unref();

    try {
      try {
        const outcome=await this.handle(ctx, job);
        if(outcome==="deferred")return "retry_wait";
        await this.repository.withContext(ctx, async (tx) => {
          await this.finish(tx, job, "succeeded");
          await tx.audit("job.succeeded", "job", job.id, "allowed", {
            job_type: job.job_type,
            attempt: job.attempt_count,
          });
        });
        return "succeeded";
      } catch (error) {
        if (error instanceof Error && error.message === "JOB_CANCELLED") {
          if(job.job_type==="transcribe")
            await this.cleanupTranscriptionOperation(ctx,job);
          await this.repository.withContext(ctx, async (tx) => {
            await this.markEntityCancelled(tx, job);
            await tx.query(
              "UPDATE job_attempts SET finished_at=now(),result_status='cancelled',error_code=NULL,error_detail_redacted=NULL WHERE job_id=$1 AND attempt_no=$2 AND finished_at IS NULL",
              [job.id, job.attempt_count],
            );
            await tx.query(
              "UPDATE jobs SET status='cancelled',finished_at=now(),input_redacted='{}'::jsonb,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=now(),error_code=NULL,error_detail_redacted=NULL WHERE id=$1",
              [job.id],
            );
            await tx.audit("job.cancelled", "job", job.id, "allowed", {
              job_type: job.job_type,
              attempt: job.attempt_count,
            });
          });
          return "cancelled";
        }
        const retryable =
          isRetryable(error) && job.attempt_count < job.max_attempts;
        const status = retryable ? "retry_wait" : "failed";
        const detail = safeErrorDetail(error);
        const failureClass=classifyFailure(error,retryable);
        await this.repository.withContext(ctx, async (tx) => {
          await this.markEntityFailure(tx, job, retryable);
          await this.finish(tx, job, status, detail,failureClass);
          await tx.audit("job.failed", "job", job.id, "failed", {
            job_type: job.job_type,
            attempt: job.attempt_count,
            error_code: failureClass,
          });
        });
        console.error("worker job failed", {
          operationalAlert:["MODEL_OUTPUT_INVALID","EVIDENCE_INVALID"].includes(failureClass),
          failureClass,
          jobType: job.job_type,
          attempt: job.attempt_count,
          maxAttempts:job.max_attempts,
          oldestAgeSeconds:0,
        });
        return status;
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async handle(ctx: RequestContext, job: ClaimedJob): Promise<HandlerOutcome> {
    switch (job.job_type) {
      case "pdf_extract":
        return this.pdf(ctx, job);
      case "preparation":
        return this.preparation(ctx, job);
      case "transcribe":
        return this.transcribe(ctx, job);
      case "review":
        return this.review(ctx, job);
      case "delete":
        return this.remove(ctx, job);
      case "retention_scan":
        return this.retention(ctx, job);
      case "drive_import":
        return this.drive(ctx, job);
      default:
        throw new Error("PROVIDER_PERMANENT: unsupported job type");
    }
  }

  private async finish(
    tx: RepositoryTransaction,
    job: ClaimedJob,
    status: "succeeded" | "retry_wait" | "failed",
    message?: string,
    failureCode?:string,
  ): Promise<void> {
    const code =
      failureCode??(status === "retry_wait"
        ? "PROVIDER_TEMPORARY"
        : status === "failed"
          ? "PROVIDER_PERMANENT"
          : null);
    await tx.query(
      "UPDATE job_attempts SET finished_at=now(),result_status=$3,error_code=$4,error_detail_redacted=$5 WHERE job_id=$1 AND attempt_no=$2 AND finished_at IS NULL",
      [
        job.id,
        job.attempt_count,
        status === "retry_wait" ? "retryable" : status,
        code,
        message ?? null,
      ],
    );
    const updated = await tx.query<{available_at:Date}>(
      `UPDATE jobs
         SET status=$2::varchar,
             available_at=CASE WHEN $2::text='retry_wait' THEN now()+(LEAST(300,power(2,$3))*interval '1 second') ELSE available_at END,
             finished_at=CASE WHEN $2::text IN ('succeeded','failed') THEN now() ELSE NULL END,
             input_redacted=CASE WHEN $2::text='succeeded' THEN '{}'::jsonb ELSE input_redacted END,
             error_code=$4,
             error_detail_redacted=$5,
             lease_owner=NULL,
             lease_expires_at=NULL,
             heartbeat_at=now()
       WHERE id=$1 AND status='running' AND ($2::text<>'succeeded' OR cancel_requested_at IS NULL)
       RETURNING available_at`,
      [job.id, status, job.attempt_count, code, message ?? null],
    );
    if(status==="retry_wait"&&updated.rows[0]){
      await tx.query(
        `INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key,available_at)
         VALUES($1,'job.dispatch','job',$2,$3,$4,$5) ON CONFLICT(organization_id,deduplication_key) DO NOTHING`,
        [job.organization_id,job.id,{job_id:job.id,job_type:job.job_type,attempt:job.attempt_count},`job:${job.id}:attempt:${job.attempt_count}`,updated.rows[0].available_at],
      );
    }
    if (status === "succeeded" && !updated.rowCount)
      throw new Error("JOB_CANCELLED");
  }

  private async markEntityFailure(
    tx: RepositoryTransaction,
    job: ClaimedJob,
    retryable: boolean,
  ): Promise<void> {
    if (retryable) return;
    if (job.job_type === "pdf_extract") {
      await tx.query(
        "UPDATE visit_documents SET status='failed' WHERE organization_id=$1 AND id=$2 AND status='extracting'",
        [job.organization_id, job.entity_id],
      );
    } else if (job.job_type === "transcribe") {
      await tx.query(
        "UPDATE recordings SET status='failed' WHERE organization_id=$1 AND id=$2 AND status='transcribing'",
        [job.organization_id, job.entity_id],
      );
    } else if (job.job_type === "drive_import") {
      await tx.query(
        "UPDATE drive_imports SET status='failed' WHERE organization_id=$1 AND id=$2 AND status='copying'",
        [job.organization_id, job.entity_id],
      );
    }
  }

  private async markEntityCancelled(
    tx: RepositoryTransaction,
    job: ClaimedJob,
  ): Promise<void> {
    if (job.job_type === "pdf_extract")
      await tx.query(
        "UPDATE visit_documents SET status='ready' WHERE organization_id=$1 AND id=$2 AND status='extracting'",
        [job.organization_id, job.entity_id],
      );
    else if (job.job_type === "transcribe")
      await tx.query(
        "UPDATE recordings SET status='ready' WHERE organization_id=$1 AND id=$2 AND status='transcribing'",
        [job.organization_id, job.entity_id],
      );
    else if (job.job_type === "drive_import")
      await tx.query(
        "UPDATE drive_imports SET status='cancelled' WHERE organization_id=$1 AND id=$2 AND status='copying'",
        [job.organization_id, job.entity_id],
      );
  }

  private async assertNotCancelled(job: ClaimedJob): Promise<void> {
    const result = await this.repository.system<{
      cancel_requested_at: Date | null;
    }>(
      "SELECT cancel_requested_at FROM jobs WHERE id=$1 AND attempt_count=$2",
      [job.id, job.attempt_count],
    );
    if (result.rows[0]?.cancel_requested_at) throw new Error("JOB_CANCELLED");
  }

  private transcriptionCleanupToken(state:Record<string,unknown>):string|null{
    return typeof state.cleanupToken==="string"?state.cleanupToken:null;
  }

  private async cleanupTranscriptionOperation(
    ctx:RequestContext,
    job:Pick<ClaimedJob,"id"|"organization_id">,
  ):Promise<void>{
    const current=await this.repository.withContext(ctx,async tx=>tx.query<TranscriptionOperationRow>(
      "SELECT provider_operation_id,provider_operation_state,provider_operation_started_at FROM jobs WHERE organization_id=$1 AND id=$2 AND job_type='transcribe'",
      [job.organization_id,job.id],
    ));
    const operation=current.rows[0];
    if(!operation)return;
    const cleanupToken=this.transcriptionCleanupToken(operation.provider_operation_state);
    if(cleanupToken){
      const cleanup=this.providers.speech.cleanupTranscription?.bind(this.providers.speech);
      const cancel=this.providers.speech.cancelTranscription?.bind(this.providers.speech);
      if(!cleanup&&!cancel)throw new Error("PROVIDER_PERMANENT: durable STT cleanup contract is unavailable");
      if(operation.provider_operation_id&&cancel)await cancel(operation.provider_operation_id,cleanupToken);
      else await cleanup!(cleanupToken);
    }
    await this.repository.withContext(ctx,async tx=>tx.query(
      "UPDATE jobs SET provider_operation_id=NULL,provider_operation_state='{}'::jsonb,provider_operation_started_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND job_type='transcribe'",
      [job.organization_id,job.id],
    ));
  }

  private async cleanupVisitTranscriptionOperations(
    ctx:RequestContext,
    organizationId:string,
    visitId:string,
  ):Promise<number>{
    const pending=await this.repository.withContext(ctx,async tx=>tx.query<VisitTranscriptionCleanupRow>(
      `SELECT j.id,j.provider_operation_id,j.provider_operation_state,j.provider_operation_started_at
         FROM jobs j JOIN recordings r ON r.organization_id=j.organization_id AND r.id=j.entity_id
        WHERE j.organization_id=$1 AND j.job_type='transcribe' AND r.visit_id=$2
          AND (j.provider_operation_id IS NOT NULL OR j.provider_operation_state<>'{}'::jsonb)
        ORDER BY j.id`,
      [organizationId,visitId],
    ));
    for(const operation of pending.rows){
      const cleanupToken=this.transcriptionCleanupToken(operation.provider_operation_state);
      if(cleanupToken){
        const cleanup=this.providers.speech.cleanupTranscription?.bind(this.providers.speech);
        const cancel=this.providers.speech.cancelTranscription?.bind(this.providers.speech);
        if(!cleanup&&!cancel)throw new Error("PROVIDER_PERMANENT: durable STT cleanup contract is unavailable");
        if(operation.provider_operation_id&&cancel)await cancel(operation.provider_operation_id,cleanupToken);
        else await cleanup!(cleanupToken);
      }
      await this.repository.withContext(ctx,async tx=>{
        await tx.query(
          "UPDATE job_attempts SET finished_at=COALESCE(finished_at,now()),result_status=CASE WHEN finished_at IS NULL THEN 'cancelled' ELSE result_status END,error_code=NULL,error_detail_redacted=NULL WHERE job_id=$1",
          [operation.id],
        );
        await tx.query(
          `UPDATE jobs SET provider_operation_id=NULL,provider_operation_state='{}'::jsonb,provider_operation_started_at=NULL,
                   cancel_requested_at=COALESCE(cancel_requested_at,now()),
                   status=CASE WHEN status IN ('queued','retry_wait','running') THEN 'cancelled' ELSE status END,
                   finished_at=CASE WHEN status IN ('queued','retry_wait','running') THEN now() ELSE finished_at END,
                   input_redacted='{}'::jsonb,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=now(),updated_at=now()
             WHERE organization_id=$1 AND id=$2 AND job_type='transcribe'`,
          [organizationId,operation.id],
        );
      });
    }
    return pending.rowCount??0;
  }

  private async assertCurrentConsent(
    tx: RepositoryTransaction,
    organizationId: string,
    visitId: string,
    consentId: string,
  ): Promise<void> {
    const consent = await tx.query(
      `SELECT 1 FROM recording_consents c
        WHERE c.organization_id=$1 AND c.id=$2 AND c.visit_id=$3 AND c.status='granted'
          AND NOT EXISTS(SELECT 1 FROM recording_consents newer WHERE newer.organization_id=c.organization_id AND newer.visit_id=c.visit_id AND (newer.created_at,newer.id)>(c.created_at,c.id))`,
      [organizationId, consentId, visitId],
    );
    if (!consent.rowCount) throw new Error("JOB_CANCELLED");
  }

  private async assertVisitWritable(
    tx: RepositoryTransaction,
    organizationId: string,
    visitId: string,
  ): Promise<void> {
    const writable = await tx.query(
      `SELECT 1 FROM visits v
        WHERE v.organization_id=$1 AND v.id=$2 AND v.deleted_at IS NULL
          AND v.status NOT IN ('deleting','deleted')
          AND NOT EXISTS(
            SELECT 1 FROM visit_deletion_fences f
             WHERE f.organization_id=v.organization_id AND f.visit_id=v.id AND f.operation='delete'
          )`,
      [organizationId, visitId],
    );
    if (!writable.rowCount) throw new Error("JOB_CANCELLED");
  }

  private async pdf(ctx: RequestContext, job: ClaimedJob): Promise<void> {
    const doc = await this.repository.withContext(ctx, async (tx) => {
      const identity = await tx.query<{visit_id:string}>(
        "SELECT visit_id FROM visit_documents WHERE organization_id=$1 AND id=$2",
        [job.organization_id,job.entity_id],
      );
      if(!identity.rows[0])throw new Error("PROVIDER_PERMANENT: document not available");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[identity.rows[0].visit_id]);
      await this.assertVisitWritable(tx,job.organization_id,identity.rows[0].visit_id);
      const result = await tx.query<{
        document_id: string;
        visit_id: string;
        bucket_name: string;
        object_name: string;
        object_generation: string;
        mime_type: string;
        schema_id: string;
        json_schema: Record<string, unknown>;
      }>(
        `UPDATE visit_documents d
            SET status='extracting',updated_at=now()
           FROM storage_objects s,form_schema_versions fs
          WHERE d.organization_id=$1 AND d.id=$2
            AND d.status IN ('ready','extracting','failed')
            AND s.id=d.storage_object_id AND s.status='available'
            AND fs.organization_id=d.organization_id AND fs.schema_key='visit_info' AND fs.status='active'
        RETURNING d.id document_id,d.visit_id,s.bucket_name,s.object_name,s.object_generation::text,s.mime_type,fs.id schema_id,fs.json_schema`,
        [job.organization_id, job.entity_id],
      );
      if (!result.rows[0])
        throw new Error("PROVIDER_PERMANENT: document not available");
      return result.rows[0];
    });

    let extracted;
    if (doc.bucket_name === "local") {
      const access = await this.providers.storage.createDownload(
        doc.object_name,
        doc.object_generation,
        doc.mime_type,
        new Date(Date.now() + 5 * 60_000),
      );
      if (access.kind !== "inline")
        throw new Error("PROVIDER_PERMANENT: PDF本文を読み込めません");
      extracted = await this.providers.ai.extract({
        content: access.body,
        mimeType: doc.mime_type,
        schema: doc.json_schema,
      });
    } else {
      extracted = await this.providers.ai.extract({
        sourceUri: `gs://${doc.bucket_name}/${doc.object_name}`,
        mimeType: doc.mime_type,
        schema: doc.json_schema,
      });
    }
    await this.assertNotCancelled(job);

    await this.repository.withContext(ctx, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [doc.visit_id]);
      await this.assertVisitWritable(tx, job.organization_id, doc.visit_id);
      const current = await tx.query(
        "SELECT 1 FROM visit_documents WHERE organization_id=$1 AND id=$2 AND status='extracting' FOR UPDATE",
        [job.organization_id, doc.document_id],
      );
      if (!current.rowCount)
        throw new Error(
          "PROVIDER_PERMANENT: document state changed during extraction",
        );
      const existing = await tx.query<{ id: string }>(
        "SELECT id FROM document_extractions WHERE organization_id=$1 AND job_id=$2",
        [job.organization_id, job.id],
      );
      if (existing.rows[0]) {
        await tx.query(
          "UPDATE visit_documents SET status='extracted',updated_at=now() WHERE id=$1",
          [doc.document_id],
        );
        return;
      }
      const extractionId = randomUUID();
      const version = await tx.query<{ version: number }>(
        "SELECT COALESCE(max(version),0)+1 version FROM document_extractions WHERE visit_document_id=$1",
        [doc.document_id],
      );
      await tx.query(
        `INSERT INTO document_extractions(id,organization_id,visit_document_id,form_schema_version_id,job_id,version,status,provider,model_name)
         VALUES($1,$2,$3,$4,$5,$6,'generated','google-vertex-ai',$7)`,
        [
          extractionId,
          job.organization_id,
          doc.document_id,
          doc.schema_id,
          job.id,
          version.rows[0]?.version ?? 1,
          extracted.model,
        ],
      );
      const properties=doc.json_schema.properties&&typeof doc.json_schema.properties==="object"&&!Array.isArray(doc.json_schema.properties)
        ? doc.json_schema.properties as Record<string,Record<string,unknown>>
        : {};
      const providerFields=new Map(extracted.fields.map(field=>[field.key,field]));
      for (const [index,[fieldKey,property]] of Object.entries(properties).entries()) {
        const field=providerFields.get(fieldKey);
        const normalized=normalizedExtractionValue(property,field?.value);
        const valueType=normalized?.type??extractionValueType(property);
        const values: unknown[] = [null, null, null, null, null];
        if(normalized)values[{ text: 0, number: 1, date: 2, boolean: 3, json: 4 }[valueType]??0]=normalized.value;
        await tx.query(
          `INSERT INTO visit_field_values(organization_id,document_extraction_id,field_key,value_type,text_value,number_value,date_value,boolean_value,json_value,source_page,source_excerpt,confidence,verification_status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'unverified')`,
          [
            job.organization_id,
            extractionId,
            fieldKey || `field_${index}`,
            valueType,
            ...values,
            field?.page??null,
            field?.excerpt??null,
            field?.confidence??null,
          ],
        );
      }
      await tx.query(
        "UPDATE visit_documents SET status='extracted',updated_at=now() WHERE id=$1",
        [doc.document_id],
      );
    });
  }

  private async transcribe(
    ctx: RequestContext,
    job: ClaimedJob,
  ): Promise<HandlerOutcome> {
    const startTranscription=this.providers.speech.startTranscription?.bind(this.providers.speech);
    const pollTranscription=this.providers.speech.pollTranscription?.bind(this.providers.speech);
    const cleanupTranscription=this.providers.speech.cleanupTranscription?.bind(this.providers.speech);
    if(Boolean(startTranscription)!==Boolean(pollTranscription))throw new Error("PROVIDER_PERMANENT: durable STT provider contract is incomplete");
    const durable=Boolean(startTranscription&&pollTranscription);
    const prepared = await this.repository.withContext(ctx, async (tx) => {
      const operationResult=await tx.query<TranscriptionOperationRow>(
        "SELECT provider_operation_id,provider_operation_state,provider_operation_started_at FROM jobs WHERE organization_id=$1 AND id=$2 AND status='running' FOR UPDATE",
        [job.organization_id,job.id],
      );
      const operation=operationResult.rows[0];
      if(!operation)throw new Error("PROVIDER_PERMANENT: transcription job is not running");
      const existing=await tx.query<{id:string}>("SELECT id FROM transcripts WHERE organization_id=$1 AND job_id=$2",[job.organization_id,job.id]);
      if(existing.rows[0])return{completed:true as const,operation,transcriptId:existing.rows[0].id};
      const identity = await tx.query<{ visit_id: string; consent_id: string }>(
        "SELECT visit_id,consent_id FROM recordings WHERE organization_id=$1 AND id=$2 AND status IN ('ready','transcribing','failed') FOR UPDATE",
        [job.organization_id, job.entity_id],
      );
      if (!identity.rows[0])
        throw new Error("PROVIDER_PERMANENT: recording not available");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        identity.rows[0].visit_id,
      ]);
      await this.assertVisitWritable(tx,job.organization_id,identity.rows[0].visit_id);
      await this.assertCurrentConsent(
        tx,
        job.organization_id,
        identity.rows[0].visit_id,
        identity.rows[0].consent_id,
      );
      const result = await tx.query<{
        id: string;
        visit_id: string;
        consent_id: string;
        bucket_name: string;
        object_name: string;
        object_generation: string;
        mime_type: string;
        size_bytes: string;
        duration_ms: string;
      }>(
        `UPDATE recordings rec
            SET status='transcribing',updated_at=now()
           FROM storage_objects s
          WHERE rec.organization_id=$1 AND rec.id=$2
            AND rec.status IN ('ready','transcribing','failed')
            AND s.id=rec.storage_object_id AND s.status='available'
        RETURNING rec.id,rec.visit_id,rec.consent_id,s.bucket_name,s.object_name,s.object_generation::text,s.mime_type,s.size_bytes::text,rec.duration_ms`,
        [job.organization_id, job.entity_id],
      );
      if (!result.rows[0])
        throw new Error("PROVIDER_PERMANENT: recording not available");
      if(durable&&!operation.provider_operation_id){
        const phase=typeof operation.provider_operation_state?.phase==="string"?operation.provider_operation_state.phase:null;
        if(phase==="starting")throw new Error("PROVIDER_PERMANENT: STT start acceptance is uncertain; management retry is locked for 9 hours");
        if(phase)throw new Error("PROVIDER_PERMANENT: invalid STT operation state");
        await tx.query(
          "UPDATE jobs SET provider_operation_state='{\"phase\":\"starting\"}'::jsonb,provider_operation_started_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='running' AND provider_operation_id IS NULL",
          [job.organization_id,job.id],
        );
        operation.provider_operation_state={phase:"starting"};
        operation.provider_operation_started_at=new Date();
      }
      return{completed:false as const,operation,recording:result.rows[0]};
    });

    if(prepared.completed){
      await this.assessTranscriptQuality(ctx,job.organization_id,prepared.transcriptId);
      if(cleanupTranscription)await cleanupTranscription(this.transcriptionCleanupToken(prepared.operation.provider_operation_state)).catch(()=>undefined);
      await this.repository.withContext(ctx,async tx=>tx.query("UPDATE jobs SET provider_operation_state='{}'::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2",[job.organization_id,job.id]));
      return;
    }
    const recording:TranscriptionRecording=prepared.recording;

    const languageCode = String(job.input_redacted.languageCode ?? "ja-JP");
    const uri =
      recording.bucket_name === "local"
        ? undefined
        : `gs://${recording.bucket_name}/${recording.object_name}`;
    const speechInput=async()=>uri?{
      uri,durationMs:Number(recording.duration_ms),mimeType:recording.mime_type,languageCode,phrases:speechPhrases,
    }:{
      stream:await this.providers.storage.openRead(recording.object_name,recording.object_generation),
      sizeBytes:Number(recording.size_bytes),durationMs:Number(recording.duration_ms),mimeType:recording.mime_type,languageCode,phrases:speechPhrases,
    };
    let transcription:SpeechTranscriptionResult;
    let providerOperationId=prepared.operation.provider_operation_id;
    let cleanupToken=this.transcriptionCleanupToken(prepared.operation.provider_operation_state);
    if(durable){
      if(!providerOperationId){
        let started:{providerOperationId:string;cleanupToken:string|null};
        try{started=await startTranscription!(await speechInput());}
        catch(error){
          if(!isRetryable(error)){
            await this.repository.withContext(ctx,async tx=>tx.query(
              "UPDATE jobs SET provider_operation_state='{}'::jsonb,provider_operation_started_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='running' AND provider_operation_id IS NULL AND provider_operation_state->>'phase'='starting'",
              [job.organization_id,job.id],
            ));
            throw error;
          }
          throw new Error("PROVIDER_PERMANENT: STT start acceptance is uncertain; management retry is locked for 9 hours");
        }
        providerOperationId=started.providerOperationId;
        cleanupToken=started.cleanupToken;
        const persisted=await this.repository.withContext(ctx,async tx=>{
          const updated=await tx.query(
            `UPDATE jobs SET provider_operation_id=$3,provider_operation_state=$4::jsonb,updated_at=now()
              WHERE organization_id=$1 AND id=$2 AND status='running' AND provider_operation_id IS NULL AND provider_operation_state->>'phase'='starting'
              RETURNING id`,
            [job.organization_id,job.id,providerOperationId,JSON.stringify({phase:"polling",cleanupToken})],
          );
          if(updated.rowCount)await tx.query("UPDATE job_attempts SET provider_operation_id_hash=$3 WHERE job_id=$1 AND attempt_no=$2",[job.id,job.attempt_count,sha(providerOperationId!)]);
          return Boolean(updated.rowCount);
        });
        if(!persisted)throw new Error("PROVIDER_PERMANENT: STT operation acceptance could not be persisted");
      }
      let polled:Awaited<ReturnType<NonNullable<typeof pollTranscription>>>;
      try{polled=await pollTranscription!(providerOperationId);}
      catch(error){
        if(isRetryable(error))throw error;
        if(cleanupTranscription)await cleanupTranscription(cleanupToken).catch(()=>undefined);
        await this.repository.withContext(ctx,async tx=>tx.query("UPDATE jobs SET provider_operation_id=NULL,provider_operation_state='{}'::jsonb,provider_operation_started_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2",[job.organization_id,job.id]));
        throw error;
      }
      if(polled.status==="pending"){
        await this.assertNotCancelled(job);
        if(job.attempt_count>=job.max_attempts){
          if(cleanupTranscription)await cleanupTranscription(cleanupToken).catch(()=>undefined);
          await this.repository.withContext(ctx,async tx=>tx.query("UPDATE jobs SET provider_operation_id=NULL,provider_operation_state='{}'::jsonb,provider_operation_started_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2",[job.organization_id,job.id]));
          throw new Error("PROVIDER_PERMANENT: STT polling attempt limit reached");
        }
        await this.repository.withContext(ctx,async tx=>{
          await this.finish(tx,job,"retry_wait");
          await tx.audit("job.deferred","job",job.id,"allowed",{job_type:job.job_type,attempt:job.attempt_count,reason:"provider_pending"});
        });
        return"deferred";
      }
      transcription=polled.result;
    }else{
      transcription=await this.providers.speech.transcribe(await speechInput());
    }
    await this.assertNotCancelled(job);

    const transcriptId=await this.repository.withContext(ctx, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        recording.visit_id,
      ]);
      await this.assertVisitWritable(tx, job.organization_id, recording.visit_id);
      await this.assertCurrentConsent(
        tx,
        job.organization_id,
        recording.visit_id,
        recording.consent_id,
      );
      const current = await tx.query(
        "SELECT 1 FROM recordings WHERE organization_id=$1 AND id=$2 AND status='transcribing' FOR UPDATE",
        [job.organization_id, recording.id],
      );
      if (!current.rowCount)
        throw new Error(
          "PROVIDER_PERMANENT: recording state changed during transcription",
        );
      const existing = await tx.query<{ id: string }>(
        "SELECT id FROM transcripts WHERE organization_id=$1 AND job_id=$2",
        [job.organization_id, job.id],
      );
      if (existing.rows[0]) {
        await tx.query(
          "UPDATE recordings SET status='transcribed',updated_at=now() WHERE id=$1",
          [recording.id],
        );
        return existing.rows[0].id;
      }
      const transcriptId = randomUUID();
      const version = await tx.query<{ version: number }>(
        "SELECT COALESCE(max(version),0)+1 version FROM transcripts WHERE recording_id=$1",
        [recording.id],
      );
      const policy = await this.retentionPolicy(
        tx,
        job.organization_id,
        "transcript",
      );
      await tx.query(
        `INSERT INTO transcripts(id,organization_id,recording_id,job_id,version,status,provider,model_name,provider_operation_id,provider_location,language_code,full_text,retention_until,retention_policy_id)
         VALUES($1,$2,$3,$4,$5,'generated',$6,$7,$8,$9,$10,$11,now()+($12||' days')::interval,$13)`,
        [
          transcriptId,
          job.organization_id,
          recording.id,
          job.id,
          version.rows[0]?.version ?? 1,
          transcription.provider,
          transcription.model,
          transcription.providerOperationId,
          transcription.location,
          languageCode,
          transcription.fullText,
          policy.retention_days,
          policy.id,
        ],
      );
      await tx.query(
        "UPDATE job_attempts SET provider_operation_id_hash=$3 WHERE job_id=$1 AND attempt_no=$2",
        [job.id, job.attempt_count, sha(transcription.providerOperationId)],
      );
      for (const [index, segment] of transcription.segments.entries()) {
        await tx.query(
          `INSERT INTO transcript_segments(organization_id,transcript_id,sequence_no,start_ms,end_ms,speaker_label,speaker_role,text,confidence)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            job.organization_id,
            transcriptId,
            index,
            segment.startMs,
            segment.endMs,
            segment.speakerLabel,
            segment.speakerRole,
            segment.text,
            segment.confidence,
          ],
        );
      }
      await tx.query(
        "UPDATE recordings SET status='transcribed',updated_at=now() WHERE id=$1",
        [recording.id],
      );
      return transcriptId;
    });
    await this.assessTranscriptQuality(ctx,job.organization_id,transcriptId);
    if(durable){
      if(cleanupTranscription)await cleanupTranscription(cleanupToken).catch(()=>undefined);
      await this.repository.withContext(ctx,async tx=>tx.query("UPDATE jobs SET provider_operation_state='{}'::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2",[job.organization_id,job.id]));
    }
  }

  private async preparation(
    ctx: RequestContext,
    job: ClaimedJob,
  ): Promise<void> {
    const prepared = await this.repository.withContext(ctx, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[job.entity_id]);
      await this.assertVisitWritable(tx,job.organization_id,job.entity_id);
      const extractionResult = await tx.query<{
        extraction_id: string;
        visit_id: string;
        lock_version: string;
        prompt_id: string;
      }>(
        `SELECT e.id extraction_id,d.visit_id,e.lock_version::text,p.id prompt_id
           FROM document_extractions e
           JOIN visit_documents d ON d.id=e.visit_document_id AND d.organization_id=e.organization_id
           JOIN LATERAL (
             SELECT id FROM prompt_versions
              WHERE organization_id=e.organization_id AND purpose='preparation' AND status IN ('provisional','approved')
              ORDER BY version DESC LIMIT 1
           ) p ON true
          WHERE e.organization_id=$1 AND d.visit_id=$2 AND e.status='confirmed'
          ORDER BY e.version DESC LIMIT 1`,
        [job.organization_id, job.entity_id],
      );
      const extraction = extractionResult.rows[0];
      if (!extraction)
        throw new Error("PROVIDER_PERMANENT: confirmed extraction is required");
      const fields = await tx.query<{
        key: string;
        value: unknown;
        source_page: number | null;
        source_excerpt: string | null;
      }>(
        `SELECT field_key key,
                COALESCE(to_jsonb(text_value),to_jsonb(number_value),to_jsonb(date_value),to_jsonb(boolean_value),json_value) value,
                source_page,source_excerpt
           FROM visit_field_values
          WHERE organization_id=$1 AND document_extraction_id=$2 AND verification_status IN ('confirmed','corrected')
          ORDER BY field_key`,
        [job.organization_id, extraction.extraction_id],
      );
      if (!fields.rowCount)
        throw new Error(
          "PROVIDER_PERMANENT: confirmed extraction fields are required",
        );
      const pilotFlag = await tx.query<{ enabled: boolean }>(
        "SELECT enabled FROM feature_flags WHERE organization_id=$1 AND flag_key='pilot_content_ai'",
        [job.organization_id],
      );
      const pilotEnabled = Boolean(pilotFlag.rows[0]?.enabled);
      const knowledge = await tx.query<{
        id: string;
        type: "talk" | "legal" | "manual";
        title: string;
        body: unknown;
        version_id: string;
        availability_state: "pilot" | "published";
      }>(
        `SELECT c.id,c.content_type type,c.title,cv.body_json body,cv.id version_id,c.availability_state
           FROM content_items c
           JOIN content_versions cv ON cv.id=CASE
             WHEN c.availability_state='published' THEN c.published_version_id
             WHEN $2::boolean AND c.availability_state='pilot' THEN c.current_version_id
           END
          WHERE c.organization_id=$1 AND c.deleted_at IS NULL
            AND (
              (c.status='published' AND c.availability_state='published' AND cv.review_status='approved' AND cv.published_at IS NOT NULL AND cv.migration_state NOT IN ('extracted_needs_review','blocked'))
              OR ($2::boolean AND c.status='draft' AND c.availability_state='pilot' AND cv.review_status='draft' AND cv.migration_state='extracted_needs_review' AND cv.published_at IS NULL)
            )
            AND c.content_type IN ('talk','legal','manual')
          ORDER BY CASE c.content_type WHEN 'legal' THEN 0 WHEN 'manual' THEN 1 ELSE 2 END,c.updated_at DESC,c.id
          LIMIT 48`,
        [job.organization_id, pilotEnabled],
      );
      const usesPilot = knowledge.rows.some(
        (item) => item.availability_state === "pilot",
      );
      return {
        ...extraction,
        fields: fields.rows.map((field) => ({
          key: field.key,
          value: field.value,
          sourcePage: field.source_page,
          sourceExcerpt: field.source_excerpt,
        })),
        knowledge: knowledge.rows.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          body: item.body,
        })),
        contentSources:knowledge.rows.map(item=>({id:item.id,versionId:item.version_id,availabilityState:item.availability_state})),
        pilotEnabled,
        inputHash: sha(
          JSON.stringify({
            extractionId: extraction.extraction_id,
            lockVersion: extraction.lock_version,
            fields: fields.rows,
            contentVersions: knowledge.rows.map((item) => item.version_id),
            contentPolicy: contentPolicy(pilotEnabled, usesPilot,knowledge.rows.map(item=>({id:item.id,versionId:item.version_id}))),
          }),
        ),
      };
    });

    const result = await this.providers.ai.prepareVisit({
      extractedFields: prepared.fields,
      knowledge: prepared.knowledge,
    });
    if (result.legalChecks.length !== 4)
      throw new Error(
        "PROVIDER_PERMANENT: preparation must contain exactly four legal checks",
      );
    const usedContentIds=[...new Set([...result.legalChecks,...result.suggestedTalks,...result.anticipatedQuestions].flatMap(item=>item.sourceContentIds))];
    const usedSources=prepared.contentSources.filter(source=>usedContentIds.includes(source.id));
    const usedPilot=usedSources.some(source=>source.availabilityState==="pilot");
    const finalContentPolicy=contentPolicy(prepared.pilotEnabled,usedPilot,usedSources.map(source=>({id:source.id,versionId:source.versionId})));
    await this.assertNotCancelled(job);

    await this.repository.withContext(ctx, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [prepared.visit_id]);
      await this.assertVisitWritable(tx, job.organization_id, prepared.visit_id);
      const extraction = await tx.query<{ lock_version: string }>(
        "SELECT lock_version::text FROM document_extractions WHERE organization_id=$1 AND id=$2 AND status='confirmed' FOR UPDATE",
        [job.organization_id, prepared.extraction_id],
      );
      if (extraction.rows[0]?.lock_version !== prepared.lock_version)
        throw new Error(
          "PROVIDER_PERMANENT: extraction changed during preparation",
        );
      const existing = await tx.query(
        "SELECT 1 FROM visit_preparations WHERE organization_id=$1 AND job_id=$2",
        [job.organization_id, job.id],
      );
      if (existing.rowCount) return;
      await tx.query(
        "UPDATE visit_preparations SET status='superseded' WHERE organization_id=$1 AND visit_id=$2 AND status IN ('generated','confirmed')",
        [job.organization_id, prepared.visit_id],
      );
      const version = await tx.query<{ version: number }>(
        "SELECT COALESCE(max(version),0)+1 version FROM visit_preparations WHERE visit_id=$1",
        [prepared.visit_id],
      );
      await tx.query(
        `INSERT INTO visit_preparations(id,organization_id,visit_id,document_extraction_id,job_id,prompt_version_id,version,model_name,input_hash,structured_result,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'generated')`,
        [
          randomUUID(),
          job.organization_id,
          prepared.visit_id,
          prepared.extraction_id,
          job.id,
          prepared.prompt_id,
          version.rows[0]?.version ?? 1,
          result.model,
          prepared.inputHash,
          { ...result, contentPolicy: finalContentPolicy },
        ],
      );
    });
  }

  private async review(ctx: RequestContext, job: ClaimedJob): Promise<void> {
    const prepared = await this.repository.withContext(ctx, async (tx) => {
      const result = await tx.query<{
        id: string;
        full_text: string;
        lock_version: string;
        prompt_id: string;
        prompt_version: number;
        system_instruction: string;
        model_name: string;
        criteria_id: string;
        criteria_version: number;
        criteria_json: unknown;
        visit_id: string;
      }>(
        `SELECT t.id,t.full_text,t.lock_version::text,pv.id prompt_id,pv.version prompt_version,pv.system_instruction,pv.model_name,rc.id criteria_id,rc.version criteria_version,rc.criteria_json,r.visit_id
           FROM transcripts t
           JOIN recordings r ON r.id=t.recording_id AND r.organization_id=t.organization_id
           JOIN LATERAL (SELECT id,version,system_instruction,model_name FROM prompt_versions WHERE organization_id=t.organization_id AND purpose='review' AND status='approved' ORDER BY version DESC LIMIT 1) pv ON true
           JOIN LATERAL (SELECT id,version,criteria_json FROM review_criteria_versions WHERE organization_id=t.organization_id AND status='approved' ORDER BY version DESC LIMIT 1) rc ON true
          WHERE t.organization_id=$1 AND t.id=$2 AND t.status='confirmed'`,
        [job.organization_id, job.entity_id],
      );
      const transcript = result.rows[0];
      if (!transcript)
        throw new Error("PROVIDER_PERMANENT: transcript not confirmed");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[transcript.visit_id]);
      await this.assertVisitWritable(tx,job.organization_id,transcript.visit_id);
      const segments = await tx.query<{ id: string; text: string; sequence_no:number }>(
        "SELECT id,COALESCE(edited_text,text) text,sequence_no FROM transcript_segments WHERE organization_id=$1 AND transcript_id=$2 ORDER BY sequence_no",
        [job.organization_id, transcript.id],
      );
      return { ...transcript, segments: segments.rows };
    });

    const objective =
      typeof job.input_redacted.objective === "string"
        ? job.input_redacted.objective
        : undefined;
    const chunks=reviewChunks(prepared.segments);const chunkResults:ReviewResult[]=[];
    for(const [chunkIndex,segments] of chunks.entries()){
      const chunkHash=sha(JSON.stringify({transcriptId:prepared.id,transcriptVersion:prepared.lock_version,promptId:prepared.prompt_id,promptVersion:prepared.prompt_version,criteriaId:prepared.criteria_id,criteriaVersion:prepared.criteria_version,model:prepared.model_name,objective:objective??"接客育成",segments:segments.map(segment=>[segment.id,segment.sequence_no,segment.text])}));
      const checkpoint=await this.repository.withContext(ctx,async tx=>tx.query<{input_hash:string;result_redacted:ReviewResult}>("SELECT input_hash,result_redacted FROM review_chunk_checkpoints WHERE organization_id=$1 AND job_id=$2 AND chunk_index=$3",[job.organization_id,job.id,chunkIndex]));
      if(checkpoint.rows[0]){if(checkpoint.rows[0].input_hash!==chunkHash)throw new Error("PROVIDER_PERMANENT: review chunk input changed");chunkResults.push(checkpoint.rows[0].result_redacted);continue;}
      await this.assertNotCancelled(job);
      const result=await this.providers.ai.review({transcript:segments.map(segment=>segment.text).join("\n"),segments,systemInstruction:prepared.system_instruction,criteria:prepared.criteria_json,promptVersion:prepared.prompt_version,criteriaVersion:prepared.criteria_version,modelName:prepared.model_name,...(objective?{objective}:{})});
      const chunkIds=new Set(segments.map(segment=>segment.id));if(result.findings.some(finding=>!finding.evidenceSegmentIds.length||finding.evidenceSegmentIds.some(id=>!chunkIds.has(id))))throw new Error("PROVIDER_PERMANENT: review chunk evidence must reference its transcript segments");
      await this.repository.withContext(ctx,async tx=>{await tx.query(`INSERT INTO review_chunk_checkpoints(organization_id,job_id,transcript_id,chunk_index,first_sequence_no,last_sequence_no,input_hash,result_redacted) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id,chunk_index) DO NOTHING`,[job.organization_id,job.id,prepared.id,chunkIndex,segments[0]!.sequence_no,segments.at(-1)!.sequence_no,chunkHash,result]);});chunkResults.push(result);
    }
    const reviewed=aggregateReviewChunks(chunkResults);
    const validSegmentIds=new Set(prepared.segments.map(segment=>segment.id));
    if(reviewed.findings.some(finding=>!finding.evidenceSegmentIds.length||finding.evidenceSegmentIds.some(id=>!validSegmentIds.has(id))))throw new Error("PROVIDER_PERMANENT: review evidence must reference confirmed transcript segments");
    await this.assertNotCancelled(job);

    await this.repository.withContext(ctx, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [prepared.visit_id]);
      await this.assertVisitWritable(tx, job.organization_id, prepared.visit_id);
      const current = await tx.query<{ lock_version: string }>(
        "SELECT lock_version::text FROM transcripts WHERE organization_id=$1 AND id=$2 AND status='confirmed' FOR UPDATE",
        [job.organization_id, prepared.id],
      );
      if (current.rows[0]?.lock_version !== prepared.lock_version)
        throw new Error("PROVIDER_PERMANENT: transcript changed during review");
      const existing = await tx.query<{ id: string }>(
        "SELECT id FROM reviews WHERE organization_id=$1 AND job_id=$2",
        [job.organization_id, job.id],
      );
      if (existing.rows[0]) return;
      const reviewId = randomUUID();
      const inputHash = sha(JSON.stringify({transcriptId:prepared.id,transcriptVersion:prepared.lock_version,promptId:prepared.prompt_id,promptVersion:prepared.prompt_version,criteriaId:prepared.criteria_id,criteriaVersion:prepared.criteria_version,model:prepared.model_name,objective:objective??"接客育成"}));
      const version = await tx.query<{ version: number }>(
        "SELECT COALESCE(max(version),0)+1 version FROM reviews WHERE transcript_id=$1",
        [prepared.id],
      );
      const policy = await this.retentionPolicy(
        tx,
        job.organization_id,
        "review",
      );
      await tx.query(
        `INSERT INTO reviews(id,organization_id,transcript_id,job_id,version,prompt_version_id,criteria_version_id,model_name,input_hash,summary,structured_result,status,retention_until,retention_policy_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'generated',now()+($12||' days')::interval,$13)`,
        [
          reviewId,
          job.organization_id,
          prepared.id,
          job.id,
          version.rows[0]?.version ?? 1,
          prepared.prompt_id,
          prepared.criteria_id,
          reviewed.model,
          inputHash,
          reviewed.summary,
          { findings: reviewed.findings },
          policy.retention_days,
          policy.id,
        ],
      );
      for (const [index, finding] of reviewed.findings.entries()) {
        const findingId = randomUUID();
        await tx.query(
          `INSERT INTO review_findings(id,organization_id,review_id,sequence_no,category,finding_type,severity,title,description,recommended_action)
           VALUES($1,$2,$3,$4,$5,$6,'info',$7,$8,$9)`,
          [
            findingId,
            job.organization_id,
            reviewId,
            index,
            finding.category,
            finding.category === "strength"
              ? "strength"
              : finding.category === "compliance"
                ? "warning"
                : "improvement",
            finding.title,
            finding.description,
            finding.recommendedAction,
          ],
        );
        for (const segmentId of finding.evidenceSegmentIds) {
          const segment = prepared.segments.find(
            (candidate) => candidate.id === segmentId,
          );
          if (!segment) continue;
          const excerpt = String(segment.text).slice(0, 1000);
          await tx.query(
            `INSERT INTO review_evidence(organization_id,review_finding_id,transcript_segment_id,excerpt,excerpt_hash)
             VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [job.organization_id, findingId, segmentId, excerpt, sha(excerpt)],
          );
        }
      }
    });
  }

  private async drive(ctx: RequestContext, job: ClaimedJob): Promise<void> {
    const item = await this.repository.withContext(ctx, async (tx) => {
      const result = await tx.query<{
        id: string;
        visit_id: string;
        requested_by_membership_id: string;
        refresh_token_ciphertext: Buffer;
        drive_file_id_ciphertext: Buffer;
        drive_file_version_hash: string;
      }>(
        `UPDATE drive_imports di
            SET status='copying',updated_at=now()
           FROM external_connections ec
          WHERE di.organization_id=$1 AND di.id=$2
            AND di.status IN ('queued','copying','failed')
            AND ec.id=di.external_connection_id AND ec.revoked_at IS NULL
        RETURNING di.id,di.visit_id,di.requested_by_membership_id,di.drive_file_id_ciphertext,di.drive_file_version_hash,ec.refresh_token_ciphertext`,
        [job.organization_id, job.entity_id],
      );
      if (!result.rows[0])
        throw new Error("PROVIDER_PERMANENT: Drive import not available");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        result.rows[0].visit_id,
      ]);
      await this.assertVisitWritable(tx,job.organization_id,result.rows[0].visit_id);
      await this.assertCurrentConsent(
        tx,
        job.organization_id,
        result.rows[0].visit_id,
        String(job.input_redacted.consentId),
      );
      return result.rows[0];
    });

    const refreshToken = this.cipher.decrypt(item.refresh_token_ciphertext);
    const accessToken =
      await this.providers.drive.refreshAccessToken(refreshToken);
    const fileId = this.cipher.decrypt(item.drive_file_id_ciphertext);
    const selected = await this.providers.drive.openFile({
      accessToken,
      fileId,
    });
    if (
      selected.sourceVersion &&
      sha(selected.sourceVersion) !== item.drive_file_version_hash
    ) {
      throw new Error(
        "PROVIDER_PERMANENT: Driveファイルが選択後に変更されました",
      );
    }
    // A provider retry must never overwrite a versioned GCS object. Each copy gets a write-once name;
    // the exact generation returned by Storage is persisted below.
    const objectName = driveCopyObjectName(
      job.organization_id,
      item.visit_id,
      item.id,
    );
    const stored = await this.providers.storage.putStream({
      organizationId: job.organization_id,
      objectName,
      mimeType: selected.mimeType,
      source: selected.source,
      sizeBytes: selected.sizeBytes,
    });
    let audioMetadata;
    try {
      audioMetadata = await this.providers.storage.probeAudio(
        stored.objectName,
        stored.generation,
      );
    } catch (error) {
      await this.providers.storage.delete(stored.objectName, stored.generation);
      throw error;
    }
    try {
      await this.assertNotCancelled(job);
    } catch (error) {
      await this.providers.storage.delete(stored.objectName, stored.generation);
      throw error;
    }

    try {
      await this.repository.withContext(ctx, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        item.visit_id,
      ]);
      await this.assertVisitWritable(tx, job.organization_id, item.visit_id);
      await this.assertCurrentConsent(
        tx,
        job.organization_id,
        item.visit_id,
        String(job.input_redacted.consentId),
      );
      const current = await tx.query(
        "SELECT 1 FROM drive_imports WHERE organization_id=$1 AND id=$2 AND status='copying' FOR UPDATE",
        [job.organization_id, item.id],
      );
      if (!current.rowCount)
        throw new Error("PROVIDER_PERMANENT: Drive import state changed");
      const existing = await tx.query(
        "SELECT destination_storage_object_id FROM drive_imports WHERE organization_id=$1 AND id=$2 AND destination_storage_object_id IS NOT NULL",
        [job.organization_id, item.id],
      );
      if (existing.rowCount) return;
      const storageId = randomUUID();
      const recordingId = randomUUID();
      const policy = await this.retentionPolicy(
        tx,
        job.organization_id,
        "audio",
      );
      await tx.query(
        `INSERT INTO storage_objects(id,organization_id,bucket_name,object_name,object_generation,purpose,status,mime_type,size_bytes,sha256,retention_until,retention_policy_id)
         VALUES($1,$2,$3,$4,$5,'recording','available',$6,$7,$8,now()+($9||' days')::interval,$10)`,
        [
          storageId,
          job.organization_id,
          stored.bucket,
          stored.objectName,
          Number(stored.generation),
          stored.mimeType,
          stored.sizeBytes,
          stored.sha256,
          policy.retention_days,
          policy.id,
        ],
      );
      await tx.query(
        `INSERT INTO recordings(id,organization_id,visit_id,consent_id,storage_object_id,source_type,status,retention_until,retention_policy_id,uploaded_by_membership_id,captured_at,duration_ms,media_metadata)
         VALUES($1,$2,$3,$4,$5,'drive','ready',now()+($6||' days')::interval,$7,$8,$9,$10,$11)`,
        [
          recordingId,
          job.organization_id,
          item.visit_id,
          String(job.input_redacted.consentId),
          storageId,
          policy.retention_days,
          policy.id,
          item.requested_by_membership_id,
          selected.modifiedTime,
          audioMetadata.durationMs,
          audioMetadata,
        ],
      );
      const transcriptionJobId = randomUUID();
      const transcriptionKey = `drive-import:${item.id}:transcribe`;
      const transcriptionInput = {
        languageCode: "ja-JP",
        source: "drive_import",
      };
      const chained = await tx.query<{ id: string }>(
        `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,max_attempts,requested_by_membership_id)
        VALUES($1,$2,'transcribe','recording',$3,$4,$5,$6,200,$7)
        ON CONFLICT(organization_id,job_type,idempotency_key) DO UPDATE SET updated_at=jobs.updated_at
        RETURNING id`,
        [
          transcriptionJobId,
          job.organization_id,
          recordingId,
          transcriptionKey,
          sha(JSON.stringify(transcriptionInput)),
          transcriptionInput,
          item.requested_by_membership_id,
        ],
      );
      const chainedJobId = chained.rows[0]?.id ?? transcriptionJobId;
      await tx.query(
        `INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key)
        VALUES($1,'job.dispatch','job',$2,$3,$4) ON CONFLICT(organization_id,deduplication_key) DO NOTHING`,
        [
          job.organization_id,
          chainedJobId,
          { job_id: chainedJobId, job_type: "transcribe" },
          `job:${chainedJobId}`,
        ],
      );
      await tx.query(
        "UPDATE drive_imports SET status='succeeded',destination_storage_object_id=$2,source_modified_at=COALESCE($3::timestamptz,source_modified_at),source_size_bytes=$4,updated_at=now() WHERE id=$1",
        [item.id, storageId, selected.modifiedTime, selected.sizeBytes],
      );
      });
    } catch (error) {
      await this.providers.storage
        .delete(stored.objectName, stored.generation)
        .catch(() => undefined);
      throw error;
    }
  }

  private async remove(ctx: RequestContext, job: ClaimedJob): Promise<void> {
    const prepared = await this.repository.withContext(ctx, async (tx) => {
      const requestResult = await tx.query<{ visit_id: string }>(
        "SELECT visit_id FROM deletion_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [job.organization_id, job.entity_id],
      );
      const request = requestResult.rows[0];
      if (!request)
        throw new Error("PROVIDER_PERMANENT: deletion request not found");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        request.visit_id,
      ]);
      await tx.query(
        "DELETE FROM visit_deletion_fences f WHERE f.organization_id=$1 AND f.visit_id=$2 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=f.job_id AND j.status='running' AND j.lease_expires_at>now())",
        [job.organization_id, request.visit_id],
      );
      const hold = await tx.query(
        "SELECT 1 FROM legal_holds WHERE organization_id=$1 AND visit_id=$2 AND released_at IS NULL",
        [job.organization_id, request.visit_id],
      );
      if (hold.rowCount) {
        await tx.query(
          "UPDATE deletion_requests SET status='held' WHERE id=$1",
          [job.entity_id],
        );
        return {
          visitId: request.visit_id,
          held: true,
          objects: [] as StoredObjectRow[],
          uploads: [] as ExpiredUploadRow[],
        };
      }
      const fenced = await tx.query(
        "INSERT INTO visit_deletion_fences(organization_id,visit_id,job_id,operation) VALUES($1,$2,$3,'delete') ON CONFLICT(organization_id,visit_id) DO UPDATE SET job_id=EXCLUDED.job_id,operation=EXCLUDED.operation,created_at=now() WHERE visit_deletion_fences.job_id=EXCLUDED.job_id RETURNING visit_id",
        [job.organization_id, request.visit_id, job.id],
      );
      if (!fenced.rowCount)
        throw new Error(
          "PROVIDER_TEMPORARY: another deletion operation owns this visit",
        );
      await tx.query(
        "UPDATE deletion_requests SET status='running' WHERE id=$1",
        [job.entity_id],
      );
      await tx.query(
        "UPDATE visits SET status='deleting' WHERE organization_id=$1 AND id=$2",
        [job.organization_id, request.visit_id],
      );
      const objects = await tx.query<StoredObjectRow>(
        `SELECT s.id,s.object_name,s.object_generation::text,s.mime_type,s.bucket_name
           FROM storage_objects s
          WHERE s.organization_id=$1
            AND s.id IN (SELECT storage_object_id FROM visit_documents WHERE visit_id=$2 UNION SELECT storage_object_id FROM recordings WHERE visit_id=$2)
            AND s.status IN ('available','deleting')
          ORDER BY s.id`,
        [job.organization_id, request.visit_id],
      );
      const uploads = await tx.query<ExpiredUploadRow>(
        `SELECT id,visit_id,object_name FROM upload_sessions
          WHERE organization_id=$1 AND visit_id=$2 AND completed_at IS NULL
          ORDER BY id FOR UPDATE`,
        [job.organization_id, request.visit_id],
      );
      for (const [index, object] of objects.rows.entries()) {
        await tx.query(
          "UPDATE storage_objects SET status='deleting',updated_at=now() WHERE id=$1 AND status<>'deleted'",
          [object.id],
        );
        await tx.query(
          `INSERT INTO deletion_items(organization_id,deletion_request_id,target_type,storage_object_id,sequence_no,status)
           VALUES($1,$2,'storage_object',$3,$4,'deleting')
           ON CONFLICT(deletion_request_id,sequence_no) DO UPDATE SET storage_object_id=excluded.storage_object_id,status='deleting'`,
          [job.organization_id, job.entity_id, object.id, index + 1],
        );
      }
      return { visitId: request.visit_id, held: false, objects: objects.rows, uploads: uploads.rows };
    });
    if (prepared.held) return;

    await this.cleanupVisitTranscriptionOperations(
      ctx,
      job.organization_id,
      prepared.visitId,
    );

    for (const upload of prepared.uploads)
      await this.providers.storage.deleteIncompleteUpload(upload.object_name);

    for (const [index, object] of prepared.objects.entries()) {
      await this.providers.storage.delete(
        object.object_name,
        object.object_generation,
      );
      await this.repository.withContext(ctx, async (tx) => {
        await tx.query(
          "UPDATE storage_objects SET status='deleted',deleted_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2",
          [job.organization_id, object.id],
        );
        await tx.query(
          "UPDATE deletion_items SET status='deleted',deleted_at=now() WHERE organization_id=$1 AND deletion_request_id=$2 AND sequence_no=$3",
          [job.organization_id, job.entity_id, index + 1],
        );
      });
    }

    await this.repository.withContext(ctx, async (tx) => {
      const hold = await tx.query(
        "SELECT 1 FROM legal_holds WHERE organization_id=$1 AND visit_id=$2 AND released_at IS NULL",
        [job.organization_id, prepared.visitId],
      );
      if (hold.rowCount) {
        await tx.query(
          "UPDATE deletion_requests SET status='held' WHERE id=$1",
          [job.entity_id],
        );
        throw new Error(
          "PROVIDER_PERMANENT: legal hold was applied during deletion",
        );
      }
      await tx.query(
        "DELETE FROM review_chunk_checkpoints WHERE organization_id=$1 AND transcript_id IN (SELECT t.id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=$1 AND r.visit_id=$2)",
        [job.organization_id,prepared.visitId],
      );
      await tx.query(
        "DELETE FROM review_evidence WHERE organization_id=$1 AND review_finding_id IN (SELECT f.id FROM review_findings f JOIN reviews rv ON rv.id=f.review_id JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE f.organization_id=$1 AND r.visit_id=$2)",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "DELETE FROM review_comments WHERE organization_id=$1 AND review_id IN (SELECT rv.id FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE rv.organization_id=$1 AND r.visit_id=$2)",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "DELETE FROM review_findings WHERE organization_id=$1 AND review_id IN (SELECT rv.id FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE rv.organization_id=$1 AND r.visit_id=$2)",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE reviews SET status='deleted',summary='[deleted]',structured_result='{}'::jsonb,updated_at=now() WHERE organization_id=$1 AND transcript_id IN (SELECT t.id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=$1 AND r.visit_id=$2)",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE transcript_segments SET text='[deleted]',edited_text=NULL,speaker_label=NULL,updated_at=now() WHERE organization_id=$1 AND transcript_id IN (SELECT t.id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=$1 AND r.visit_id=$2)",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE transcripts SET status='deleted',full_text='[deleted]',updated_at=now() WHERE organization_id=$1 AND recording_id IN (SELECT id FROM recordings WHERE organization_id=$1 AND visit_id=$2)",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "DELETE FROM visit_field_values WHERE organization_id=$1 AND document_extraction_id IN (SELECT e.id FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id WHERE e.organization_id=$1 AND d.visit_id=$2)",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE document_extractions SET status='superseded',raw_result_storage_object_id=NULL,updated_at=now() WHERE organization_id=$1 AND visit_document_id IN (SELECT id FROM visit_documents WHERE organization_id=$1 AND visit_id=$2)",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE visit_preparations SET status='superseded',structured_result='{}'::jsonb,updated_at=now() WHERE organization_id=$1 AND visit_id=$2",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE drive_imports SET drive_file_id_ciphertext=decode('','hex'),drive_file_name_redacted=NULL,updated_at=now() WHERE organization_id=$1 AND visit_id=$2",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "DELETE FROM upload_sessions WHERE organization_id=$1 AND visit_id=$2 AND completed_at IS NULL",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE visit_documents SET status='deleted',deleted_at=now() WHERE organization_id=$1 AND visit_id=$2",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE recordings SET status='deleted',deleted_at=now() WHERE organization_id=$1 AND visit_id=$2",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE visits SET status='deleted',deleted_at=now(),case_number='DELETED-'||id::text,scheduled_at=NULL,customer_label=NULL,notes_redacted=NULL WHERE organization_id=$1 AND id=$2",
        [job.organization_id, prepared.visitId],
      );
      await tx.query(
        "UPDATE deletion_requests SET status='succeeded',completed_at=now() WHERE id=$1",
        [job.entity_id],
      );
      await tx.query(
        "DELETE FROM visit_deletion_fences WHERE organization_id=$1 AND visit_id=$2 AND job_id=$3",
        [job.organization_id, prepared.visitId, job.id],
      );
    });
    await this.repository.system(
      "SELECT * FROM redact_visit_runtime_metadata($1,$2)",
      [job.organization_id, prepared.visitId],
    );
  }

  private async retention(ctx: RequestContext, job: ClaimedJob): Promise<void> {
    const incompleteUploadsDeleted=await cleanupExpiredUploadObjects(this.repository,this.providers.storage,ctx,job);
    let idempotencyDeleted=0;
    let terminalJobInputsRedacted=0;
    for(let batch=0;batch<20;batch+=1){
      const purged=await this.repository.system<{idempotency_deleted:number;job_inputs_redacted:number}>(
        "SELECT * FROM purge_expired_runtime_metadata(1000)",
      );
      const row=purged.rows[0];
      const idempotencyCount=Number(row?.idempotency_deleted??0);
      const jobCount=Number(row?.job_inputs_redacted??0);
      idempotencyDeleted+=idempotencyCount;
      terminalJobInputsRedacted+=jobCount;
      if(idempotencyCount<1000&&jobCount<1000)break;
    }
    const policyApplications = await this.repository.withContext(
      ctx,
      async (tx) =>
        Number(
          (
            await tx.query<{ count: number }>(
              "SELECT apply_retention_policies($1,false)::int count",
              [job.organization_id],
            )
          ).rows[0]?.count ?? 0,
        ),
    );
    const prepared = await this.repository.withContext(ctx, async (tx) => {
      const expired = await tx.query<
        StoredObjectRow & {
          visit_id: string;
          source_type: "document" | "recording";
        }
      >(
        `SELECT s.id,s.object_name,s.object_generation::text,s.mime_type,s.bucket_name,
                COALESCE(d.visit_id,r.visit_id) visit_id,
                CASE WHEN d.id IS NOT NULL THEN 'document' ELSE 'recording' END source_type
           FROM storage_objects s
           LEFT JOIN visit_documents d ON d.storage_object_id=s.id
           LEFT JOIN recordings r ON r.storage_object_id=s.id
          WHERE s.organization_id=$1 AND s.retention_until<now() AND s.status IN ('available','deleting') AND (d.id IS NOT NULL OR r.id IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM legal_holds h WHERE h.organization_id=s.organization_id AND h.visit_id=COALESCE(d.visit_id,r.visit_id) AND h.released_at IS NULL)
          ORDER BY s.retention_until,s.id
          FOR UPDATE OF s SKIP LOCKED LIMIT 500`,
        [job.organization_id],
      );
      for (const object of expired.rows)
        await tx.query(
          "UPDATE storage_objects SET status='deleting',updated_at=now() WHERE id=$1",
          [object.id],
        );
      const held = await tx.query<{ count: string }>(
        `SELECT count(*)::text count FROM storage_objects s
          LEFT JOIN visit_documents d ON d.storage_object_id=s.id LEFT JOIN recordings r ON r.storage_object_id=s.id
         WHERE s.organization_id=$1 AND s.retention_until<now() AND s.status IN ('available','deleting') AND (d.id IS NOT NULL OR r.id IS NOT NULL)
           AND EXISTS (SELECT 1 FROM legal_holds h WHERE h.organization_id=s.organization_id AND h.visit_id=COALESCE(d.visit_id,r.visit_id) AND h.released_at IS NULL)`,
        [job.organization_id],
      );
      return {
        objects: expired.rows,
        heldCount: Number(held.rows[0]?.count ?? 0),
      };
    });

    let deleted = 0;
    for (const object of prepared.objects) {
      const fenced = await this.repository.withContext(ctx, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          object.visit_id,
        ]);
        await tx.query(
          "DELETE FROM visit_deletion_fences f WHERE f.organization_id=$1 AND f.visit_id=$2 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=f.job_id AND j.status='running' AND j.lease_expires_at>now())",
          [job.organization_id, object.visit_id],
        );
        const hold = await tx.query(
          "SELECT 1 FROM legal_holds WHERE organization_id=$1 AND visit_id=$2 AND released_at IS NULL",
          [job.organization_id, object.visit_id],
        );
        if (hold.rowCount) {
          await tx.query(
            "UPDATE storage_objects SET status='available',updated_at=now() WHERE id=$1",
            [object.id],
          );
          return false;
        }
        const claimed = await tx.query(
          "INSERT INTO visit_deletion_fences(organization_id,visit_id,job_id,operation) VALUES($1,$2,$3,'retention') ON CONFLICT(organization_id,visit_id) DO UPDATE SET job_id=EXCLUDED.job_id,operation=EXCLUDED.operation,created_at=now() WHERE visit_deletion_fences.job_id=EXCLUDED.job_id RETURNING visit_id",
          [job.organization_id, object.visit_id, job.id],
        );
        return Boolean(claimed.rowCount);
      });
      if (!fenced) continue;
      await this.providers.storage.delete(
        object.object_name,
        object.object_generation,
      );
      await this.repository.withContext(ctx, async (tx) => {
        await tx.query(
          "UPDATE storage_objects SET status='deleted',deleted_at=now(),updated_at=now() WHERE id=$1",
          [object.id],
        );
        if (object.source_type === "document") {
          await tx.query(
            "UPDATE visit_documents SET status='deleted',deleted_at=now() WHERE storage_object_id=$1",
            [object.id],
          );
          await tx.query(
            "DELETE FROM visit_field_values WHERE organization_id=$1 AND document_extraction_id IN (SELECT id FROM document_extractions WHERE organization_id=$1 AND visit_document_id IN (SELECT id FROM visit_documents WHERE organization_id=$1 AND storage_object_id=$2))",
            [job.organization_id, object.id],
          );
          await tx.query(
            "UPDATE document_extractions SET status='superseded',raw_result_storage_object_id=NULL,updated_at=now() WHERE organization_id=$1 AND visit_document_id IN (SELECT id FROM visit_documents WHERE organization_id=$1 AND storage_object_id=$2)",
            [job.organization_id, object.id],
          );
          await tx.query(
            "UPDATE visit_preparations SET status='superseded',structured_result='{}'::jsonb,updated_at=now() WHERE organization_id=$1 AND visit_id=$2",
            [job.organization_id, object.visit_id],
          );
          await tx.query(
            "UPDATE visits SET customer_label=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2",
            [job.organization_id, object.visit_id],
          );
        } else {
          await tx.query(
            "UPDATE recordings SET status='deleted',deleted_at=now() WHERE storage_object_id=$1",
            [object.id],
          );
          await tx.query(
            "UPDATE drive_imports SET drive_file_id_ciphertext=decode('','hex'),drive_file_name_redacted=NULL,updated_at=now() WHERE organization_id=$1 AND destination_storage_object_id=$2",
            [job.organization_id, object.id],
          );
        }
        await tx.query(
          "DELETE FROM visit_deletion_fences WHERE organization_id=$1 AND visit_id=$2 AND job_id=$3",
          [job.organization_id, object.visit_id, job.id],
        );
      });
      deleted += 1;
    }
    const expiredVideos=await this.repository.withContext(ctx,async tx=>{
      const rows=await tx.query<StoredObjectRow>(`SELECT s.id,s.object_name,s.object_generation::text,s.mime_type,s.bucket_name FROM storage_objects s JOIN training_videos v ON v.storage_object_id=s.id WHERE s.organization_id=$1 AND s.retention_until<now() AND s.status IN ('available','deleting') AND v.status='ready' ORDER BY s.retention_until,s.id FOR UPDATE OF s SKIP LOCKED LIMIT 500`,[job.organization_id]);
      for(const item of rows.rows)await tx.query("UPDATE storage_objects SET status='deleting',updated_at=now() WHERE id=$1",[item.id]);
      return rows.rows;
    });
    let videosDeleted=0;
    for(const video of expiredVideos){
      await this.providers.storage.delete(video.object_name,video.object_generation);
      await this.repository.withContext(ctx,async tx=>{
        await tx.query("UPDATE storage_objects SET status='deleted',deleted_at=now(),updated_at=now() WHERE id=$1",[video.id]);
        await tx.query("UPDATE training_videos SET status='deleted',deleted_at=now(),media_metadata='{}'::jsonb,updated_at=now() WHERE storage_object_id=$1",[video.id]);
      });
      videosDeleted+=1;
    }
    const redacted = await this.repository.withContext(ctx, async (tx) => {
      const reviews = await tx.query<{ id: string; visit_id: string }>(
        `SELECT rv.id,r.visit_id FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE rv.organization_id=$1 AND rv.retention_until<now() AND rv.status<>'deleted' ORDER BY r.visit_id,rv.id FOR UPDATE OF rv SKIP LOCKED LIMIT 500`,
        [job.organization_id],
      );
      let reviewCount = 0;
      for (const review of reviews.rows) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          review.visit_id,
        ]);
        const held = await tx.query(
          "SELECT 1 FROM legal_holds WHERE organization_id=$1 AND visit_id=$2 AND released_at IS NULL",
          [job.organization_id, review.visit_id],
        );
        if (held.rowCount) continue;
        await tx.query(
          "DELETE FROM review_chunk_checkpoints WHERE organization_id=$1 AND job_id=(SELECT job_id FROM reviews WHERE id=$2)",
          [job.organization_id,review.id],
        );
        await tx.query(
          "DELETE FROM review_evidence WHERE organization_id=$1 AND review_finding_id IN (SELECT id FROM review_findings WHERE review_id=$2)",
          [job.organization_id, review.id],
        );
        await tx.query(
          "DELETE FROM review_comments WHERE organization_id=$1 AND review_id=$2",
          [job.organization_id, review.id],
        );
        await tx.query(
          "DELETE FROM review_findings WHERE organization_id=$1 AND review_id=$2",
          [job.organization_id, review.id],
        );
        await tx.query(
          "UPDATE reviews SET status='deleted',summary='[retention deleted]',structured_result='{}'::jsonb,updated_at=now() WHERE id=$1",
          [review.id],
        );
        reviewCount += 1;
      }
      const transcripts = await tx.query<{ id: string; visit_id: string }>(
        `SELECT t.id,r.visit_id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=$1 AND t.retention_until<now() AND t.status<>'deleted' ORDER BY r.visit_id,t.id FOR UPDATE OF t SKIP LOCKED LIMIT 500`,
        [job.organization_id],
      );
      let transcriptCount = 0;
      for (const transcript of transcripts.rows) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          transcript.visit_id,
        ]);
        const held = await tx.query(
          "SELECT 1 FROM legal_holds WHERE organization_id=$1 AND visit_id=$2 AND released_at IS NULL",
          [job.organization_id, transcript.visit_id],
        );
        if (held.rowCount) continue;
        await tx.query(
          "UPDATE transcript_segments SET text='[retention deleted]',edited_text=NULL,speaker_label=NULL,updated_at=now() WHERE organization_id=$1 AND transcript_id=$2",
          [job.organization_id, transcript.id],
        );
        await tx.query(
          "UPDATE transcripts SET status='deleted',full_text='[retention deleted]',updated_at=now() WHERE id=$1",
          [transcript.id],
        );
        transcriptCount += 1;
      }
      return {
        reviews: reviewCount,
        transcripts: transcriptCount,
      };
    });
    let auditPurged = 0;
    for (let batch = 0; batch < 20; batch++) {
      const result = await this.repository.system<{ count: number }>(
        "SELECT purge_expired_audit_events($1,500)::int count",
        [job.organization_id],
      );
      const count = Number(result.rows[0]?.count ?? 0);
      auditPurged += count;
      if (count < 500) break;
    }
    await this.repository.withContext(ctx, async (tx) => {
      await tx.query(
        "UPDATE jobs SET input_redacted=input_redacted||$2::jsonb WHERE id=$1",
        [
          job.id,
          JSON.stringify({
            expired_count: prepared.objects.length + prepared.heldCount,
            deleted_count: deleted,
            video_deleted_count:videosDeleted,
            held_count: prepared.heldCount,
            transcript_redacted_count: redacted.transcripts,
            review_redacted_count: redacted.reviews,
            audit_purged_count: auditPurged,
            policy_application_count: policyApplications,
            incomplete_upload_deleted_count: incompleteUploadsDeleted,
            idempotency_deleted_count: idempotencyDeleted,
            terminal_job_input_redacted_count: terminalJobInputsRedacted,
          }),
        ],
      );
    });
  }
}
