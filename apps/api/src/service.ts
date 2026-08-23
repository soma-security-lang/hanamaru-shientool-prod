import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { Capability, RequestContext } from "@hanamaru/contracts";
import { contentTypes,recordingConsentLegacyNotice,recordingConsentLegacyNoticeVersion,recordingConsentNotice,recordingConsentNoticeVersion,roles } from "@hanamaru/contracts";
import type {
  HanamaruRepository,
  RepositoryTransaction,
} from "@hanamaru/database";
import type {
  AiProvider,
  AudioMetadata,
  VideoMetadata,
  PlatformProviders,
  TokenCipher,
  UploadDeclaration,
  ReviewDimension,
} from "@hanamaru/platform";
import { acceptLocalUploadStream, createTokenCipher } from "@hanamaru/platform";
import { ApiProblem, denied, invalid, notFound } from "./errors.js";

type Json = Record<string, unknown>;
type WriteResult = {
  status: number;
  body: unknown;
  resourceId?: string | null;
  replayBody?: unknown;
  auditMetadata?: Record<string, unknown>;
};
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const reviewDimensions=["strength","improvement","talk","compliance","next_action","revisit"] as const satisfies readonly ReviewDimension[];
function requestedReviewDimensions(value:unknown):ReviewDimension[]{
  if(value===undefined)return[...reviewDimensions];
  if(!Array.isArray(value)||!value.length||new Set(value).size!==value.length||value.some(dimension=>!reviewDimensions.includes(dimension as ReviewDimension)))throw invalid("分析する観点を1項目以上選択してください",[{field:"dimensions",message:"対応している分析観点を重複なく選択してください"}]);
  return reviewDimensions.filter(dimension=>value.includes(dimension));
}
function reviewAnalysisDimensions(row:Record<string,unknown>):ReviewDimension[]{
  const structured=row.structured_result;
  if(structured&&typeof structured==="object"&&!Array.isArray(structured)){
    const dimensions=(structured as Json).analysisDimensions;
    if(Array.isArray(dimensions)&&dimensions.length&&dimensions.every(dimension=>reviewDimensions.includes(dimension as ReviewDimension)))return reviewDimensions.filter(dimension=>dimensions.includes(dimension));
  }
  return[...reviewDimensions];
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
const snakeToCamel = (value: string) =>
  value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
export function camel<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map(camel) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Json).map(([k, v]) => [
        snakeToCamel(k),
        camel(v),
      ]),
    ) as T;
  }
  return value as T;
}
const fieldValueProjection = `id,organization_id,document_extraction_id,field_key,value_type,
  text_value,number_value,date_value::text AS date_value,boolean_value,json_value,
  source_page,source_excerpt,confidence,verification_status,
  verified_by_membership_id,verified_at,created_at,updated_at`;
function localDate(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}
function localTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.match(/^(\d{2}:\d{2})(?::\d{2})?/)?.[1] ?? null;
}
function visitDto<T extends Json>(row: T): Json {
  const value = camel<Json>(row);
  value.visitDate = localDate(row.scheduled_local_date);
  value.visitTime = localTime(row.scheduled_local_time);
  value.timeZone = "Asia/Tokyo";
  delete value.scheduledLocalDate;
  delete value.scheduledLocalTime;
  delete value.scheduledTimezone;
  return value;
}
function text(value: unknown, max: number, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw invalid("入力内容を確認してください", [
      { field: name, message: `1〜${max}文字で入力してください` },
    ]);
  return value.trim();
}
function integer(value: unknown, min: number, max: number, name: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw invalid("入力内容を確認してください", [
      { field: name, message: `${min}〜${max}の整数で入力してください` },
    ]);
  return n;
}
function formProperties(schema:unknown):Record<string,Record<string,unknown>>{
  if(!schema||typeof schema!=="object"||Array.isArray(schema))return{};
  const properties=(schema as Json).properties;
  if(!properties||typeof properties!=="object"||Array.isArray(properties))return{};
  return Object.fromEntries(Object.entries(properties as Json).filter((entry):entry is [string,Record<string,unknown>]=>Boolean(entry[1])&&typeof entry[1]==="object"&&!Array.isArray(entry[1])));
}
function formRequired(schema:unknown):string[]{
  if(!schema||typeof schema!=="object"||Array.isArray(schema))return[];
  const required=(schema as Json).required;
  return Array.isArray(required)?required.map(String):[];
}
function formValueType(property:Record<string,unknown>):"text"|"number"|"date"|"boolean"|"json"{
  if(property.type==="string"&&property.format==="date")return"date";
  if(property.type==="number"||property.type==="integer")return"number";
  if(property.type==="boolean")return"boolean";
  if(property.type==="object"||property.type==="array")return"json";
  return"text";
}
function normalizedFormCorrection(property:Record<string,unknown>,raw:unknown,fieldKey:string):unknown{
  const valueType=formValueType(property);
  if(valueType==="text"){
    if(typeof raw!=="string")throw invalid("項目の値を確認してください",[{field:fieldKey,message:"文字列が必要です"}]);
    const maxLength=Number(property.maxLength??0);
    if(Number.isFinite(maxLength)&&maxLength>0&&raw.length>maxLength)throw invalid("項目の値を確認してください",[{field:fieldKey,message:`${maxLength}文字以内で入力してください`}]);
    if(raw&&typeof property.pattern==="string"&&!new RegExp(property.pattern).test(raw))throw invalid("項目の値を確認してください",[{field:fieldKey,message:"形式が正しくありません"}]);
    return raw;
  }
  if(valueType==="date"){
    const parsed=typeof raw==="string"?new Date(`${raw}T00:00:00Z`):new Date(Number.NaN);
    if(typeof raw!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(raw)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==raw)throw invalid("項目の値を確認してください",[{field:fieldKey,message:"YYYY-MM-DD形式の有効な日付が必要です"}]);
    return raw;
  }
  if(valueType==="number"){
    const value=typeof raw==="number"?raw:Number(raw);
    if(!Number.isFinite(value)||(property.type==="integer"&&!Number.isInteger(value)))throw invalid("項目の値を確認してください",[{field:fieldKey,message:property.type==="integer"?"整数が必要です":"数値が必要です"}]);
    return value;
  }
  if(valueType==="boolean"){
    if(typeof raw!=="boolean")throw invalid("項目の値を確認してください",[{field:fieldKey,message:"真偽値が必要です"}]);
    return raw;
  }
  if(!raw||typeof raw!=="object")throw invalid("項目の値を確認してください",[{field:fieldKey,message:"JSON値が必要です"}]);
  return raw;
}
function requireCap(ctx: RequestContext, cap: Capability) {
  if (!ctx.capabilities.includes(cap)) throw denied();
}
const jobBranchExpression = (alias: string) => `COALESCE(
  (SELECT v.branch_id FROM visits v WHERE v.organization_id=${alias}.organization_id AND v.id=CASE
    WHEN ${alias}.entity_type='visit' THEN ${alias}.entity_id
    WHEN ${alias}.entity_type='document' THEN (SELECT d.visit_id FROM visit_documents d WHERE d.organization_id=${alias}.organization_id AND d.id=${alias}.entity_id)
    WHEN ${alias}.entity_type='extraction' THEN (SELECT d.visit_id FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id WHERE e.organization_id=${alias}.organization_id AND e.id=${alias}.entity_id)
    WHEN ${alias}.entity_type='recording' THEN (SELECT r.visit_id FROM recordings r WHERE r.organization_id=${alias}.organization_id AND r.id=${alias}.entity_id)
    WHEN ${alias}.entity_type='drive_import' THEN (SELECT di.visit_id FROM drive_imports di WHERE di.organization_id=${alias}.organization_id AND di.id=${alias}.entity_id)
    WHEN ${alias}.entity_type='transcript' THEN (SELECT r.visit_id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=${alias}.organization_id AND t.id=${alias}.entity_id)
    WHEN ${alias}.entity_type='review' THEN (SELECT r.visit_id FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE rv.organization_id=${alias}.organization_id AND rv.id=${alias}.entity_id)
    WHEN ${alias}.entity_type='deletion_request' THEN (SELECT dr.visit_id FROM deletion_requests dr WHERE dr.organization_id=${alias}.organization_id AND dr.id=${alias}.entity_id)
    ELSE NULL END),
  (SELECT m.branch_id FROM memberships m WHERE m.organization_id=${alias}.organization_id AND m.id=${alias}.requested_by_membership_id)
)`;
function managedRoles(
  value: unknown,
  { allowSystemAdmin = false }: { allowSystemAdmin?: boolean } = {},
): string[] {
  const requested = Array.isArray(value) ? [...new Set(value.map(String))] : [];
  if (!requested.length) throw invalid("権限を1件以上選択してください");
  if (requested.some((role) => !(roles as readonly string[]).includes(role)))
    throw invalid("権限を確認してください");
  if (
    requested.includes("system_admin") &&
    (!allowSystemAdmin || requested.length !== 1)
  )
    throw denied("システム管理者は通常の利用者管理から変更できません");
  return requested;
}
async function hasPdfSignature(stream: Readable): Promise<boolean> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(body);
      size += body.byteLength;
      if (size >= 5) break;
    }
    return Buffer.concat(chunks, size)
      .subarray(0, 5)
      .equals(Buffer.from("%PDF-"));
  } finally {
    stream.destroy();
  }
}

export async function deleteUploadObjectIfProvenUnreferenced(
  lookupReference: () => Promise<{ rowCount: number | null }>,
  deleteObject: () => Promise<void>,
): Promise<void> {
  let reference: { rowCount: number | null };
  try {
    reference = await lookupReference();
  } catch {
    // A failed lookup cannot prove that the preceding transaction rolled back.
    // Retain the object so an ambiguous COMMIT never becomes irreversible data loss.
    return;
  }
  if (reference.rowCount !== 0) return;
  await deleteObject().catch(() => undefined);
}

export class BackendService {
  readonly cipher: TokenCipher;
  constructor(
    readonly repository: HanamaruRepository,
    readonly providers: PlatformProviders,
  ) {
    this.cipher = createTokenCipher();
  }

  private requireVisitCapability(ctx: RequestContext) {
    if (
      !(
        ctx.capabilities.includes("visit:self") ||
        ctx.capabilities.includes("visit:scope")
      )
    )
      throw denied();
  }
  private capabilityAccess(ctx: RequestContext, capability: Capability) {
    requireCap(ctx, capability);
    const scopes = (ctx.authorizationScopes ?? []).filter((scope) =>
      scope.capabilities.includes(capability),
    );
    const organization = scopes.some(
      (scope) =>
        scope.scopeType === "organization" &&
        scope.scopeId === ctx.organizationId,
    );
    const branchIds = [
      ...new Set(
        scopes
          .filter((scope) => scope.scopeType === "branch" && scope.scopeId)
          .map((scope) => String(scope.scopeId)),
      ),
    ];
    const self = scopes.some(
      (scope) =>
        scope.scopeType === "self" && scope.scopeId === ctx.membershipId,
    );
    if (!organization && !branchIds.length && !self) throw denied();
    return { organization, branchIds, self };
  }
  private requireOrganizationCapability(
    ctx: RequestContext,
    capability: Capability,
  ) {
    const access = this.capabilityAccess(ctx, capability);
    if (!access.organization) throw denied("組織全体の権限が必要です");
    return access;
  }
  private hasOrganizationCapability(ctx: RequestContext, capability: Capability) {
    return (
      ctx.capabilities.includes(capability) &&
      (ctx.authorizationScopes ?? []).some(
        (scope) =>
          scope.capabilities.includes(capability) &&
          scope.scopeType === "organization" &&
          scope.scopeId === ctx.organizationId,
      )
    );
  }
  private visitAccess(ctx: RequestContext) {
    this.requireVisitCapability(ctx);
    const scoped = ctx.authorizationScopes ?? [];
    const organization = scoped.some(
      (scope) => scope.capabilities.includes("visit:scope") && scope.scopeType === "organization" && scope.scopeId === ctx.organizationId,
    );
    const branchIds = [...new Set(scoped.filter((scope) => scope.capabilities.includes("visit:scope") && scope.scopeType === "branch" && scope.scopeId).map((scope) => String(scope.scopeId)))];
    const self = scoped.some((scope) => scope.capabilities.includes("visit:self") && scope.scopeType === "self" && scope.scopeId === ctx.membershipId);
    if (!organization && !branchIds.length && !self) throw denied();
    return { organization, branchIds, self };
  }
  private async assertVisitAccess(
    tx: RepositoryTransaction,
    ctx: RequestContext,
    visitId: string,
  ): Promise<void> {
    const scope = this.visitAccess(ctx);
    const visit = await tx.query(
      "SELECT 1 FROM visits WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL AND ($3::boolean OR branch_id=ANY($4::uuid[]) OR ($5::boolean AND assigned_membership_id=$6))",
      [
        ctx.organizationId,
        visitId,
        scope.organization,
        scope.branchIds,
        scope.self,
        ctx.membershipId,
      ],
    );
    if (!visit.rowCount) throw notFound();
  }
  private async assertVisitMutable(
    tx: RepositoryTransaction,
    ctx: RequestContext,
    visitId: string,
  ): Promise<void> {
    await this.assertVisitAccess(tx, ctx, visitId);
    const writable = await tx.query(
      `SELECT 1 FROM visits v
        WHERE v.organization_id=$1 AND v.id=$2 AND v.deleted_at IS NULL
          AND v.status NOT IN ('deleting','deleted')
          AND NOT EXISTS(
            SELECT 1 FROM visit_deletion_fences f
             WHERE f.organization_id=v.organization_id AND f.visit_id=v.id AND f.operation='delete'
          )`,
      [ctx.organizationId, visitId],
    );
    if (!writable.rowCount)
      throw new ApiProblem(
        "JOB_STATE_CONFLICT",
        409,
        "この訪問は削除処理中のため更新できません",
      );
  }
  private async assertEntityVisitAccess(
    tx: RepositoryTransaction,
    ctx: RequestContext,
    entityType: string,
    entityId: string,
  ): Promise<string> {
    const scope = this.visitAccess(ctx);
    const relation: Record<string, string> = {
      document:
        "SELECT v.id FROM visit_documents e JOIN visits v ON v.id=e.visit_id WHERE e.organization_id=$1 AND e.id=$2",
      recording:
        "SELECT v.id FROM recordings e JOIN visits v ON v.id=e.visit_id WHERE e.organization_id=$1 AND e.id=$2",
      transcript:
        "SELECT v.id FROM transcripts e JOIN recordings r ON r.id=e.recording_id JOIN visits v ON v.id=r.visit_id WHERE e.organization_id=$1 AND e.id=$2",
      extraction:
        "SELECT v.id FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id JOIN visits v ON v.id=d.visit_id WHERE e.organization_id=$1 AND e.id=$2",
      review:
        "SELECT v.id FROM reviews e JOIN transcripts t ON t.id=e.transcript_id JOIN recordings r ON r.id=t.recording_id JOIN visits v ON v.id=r.visit_id WHERE e.organization_id=$1 AND e.id=$2",
    };
    const sql = relation[entityType];
    if (!sql) throw invalid("処理対象を確認してください");
    const result = await tx.query<{ id: string }>(
      `${sql} AND v.deleted_at IS NULL AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))`,
      [
        ctx.organizationId,
        entityId,
        scope.organization,
        scope.branchIds,
        scope.self,
        ctx.membershipId,
      ],
    );
    if (!result.rows[0]) throw notFound();
    return result.rows[0].id;
  }
  private async assertEntityVisitMutable(
    tx: RepositoryTransaction,
    ctx: RequestContext,
    entityType: string,
    entityId: string,
  ): Promise<string> {
    const visitId = await this.assertEntityVisitAccess(tx, ctx, entityType, entityId);
    await this.assertVisitMutable(tx, ctx, visitId);
    return visitId;
  }
  private async retentionPolicy(
    tx: RepositoryTransaction,
    organizationId: string,
    dataType: "pdf" | "audio" | "video" | "transcript" | "review" | "audit",
  ) {
    const result = await tx.query<{ id: string; retention_days: number }>(
      "SELECT id,retention_days FROM retention_policies WHERE organization_id=$1 AND data_type=$2 AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1",
      [organizationId, dataType],
    );
    if (!result.rows[0])
      throw new Error(`ACTIVE_RETENTION_POLICY_REQUIRED:${dataType}`);
    return result.rows[0];
  }
  private async assertCurrentConsent(
    tx: RepositoryTransaction,
    organizationId: string,
    visitId: string,
    consentId: unknown,
  ): Promise<void> {
    const consent = await tx.query(
      `SELECT 1 FROM recording_consents c
        WHERE c.organization_id=$1 AND c.id=$2 AND c.visit_id=$3 AND c.status='granted'
          AND NOT EXISTS(SELECT 1 FROM recording_consents newer WHERE newer.organization_id=c.organization_id AND newer.visit_id=c.visit_id AND (newer.created_at,newer.id)>(c.created_at,c.id))`,
      [organizationId, String(consentId ?? ""), visitId],
    );
    if (!consent.rowCount)
      throw new ApiProblem(
        "CONSENT_REQUIRED",
        409,
        "最新の録音同意を記録してください",
      );
  }
  private async assertManagedMembership(
    tx: RepositoryTransaction,
    ctx: RequestContext,
    membershipId: string,
  ): Promise<{ branchId: string }> {
    const access = this.capabilityAccess(ctx, "user:manage");
    const target = await tx.query<{ branch_id: string; system_admin: boolean }>(
      `SELECT m.branch_id,EXISTS(
         SELECT 1 FROM role_assignments ra JOIN roles r ON r.id=ra.role_id
          WHERE ra.organization_id=m.organization_id AND ra.membership_id=m.id
            AND r.role_code='system_admin' AND (ra.valid_until IS NULL OR ra.valid_until>now())
       ) system_admin
         FROM memberships m WHERE m.organization_id=$1 AND m.id=$2`,
      [ctx.organizationId, membershipId],
    );
    if (!target.rows[0]) throw notFound();
    if (!access.organization && !access.branchIds.includes(target.rows[0].branch_id))
      throw notFound();
    if (target.rows[0].system_admin)
      throw denied("システム管理者は通常の利用者管理から変更できません");
    return { branchId: target.rows[0].branch_id };
  }
  private jobAccess(ctx: RequestContext) {
    return this.capabilityAccess(ctx, "job:manage");
  }

  private async auditFailure(
    ctx: RequestContext,
    action: string,
    resourceType: string,
    error: unknown,
  ) {
    try {
      await this.repository.withContext(ctx, async (tx) =>
        tx.audit(
          action,
          resourceType,
          null,
          error instanceof ApiProblem && error.statusCode === 403
            ? "denied"
            : "failed",
          {
            error_code:
              error instanceof ApiProblem ? error.code : "INTERNAL_ERROR",
          },
        ),
      );
    } catch (auditError) {
      // Preserve the original business error. The audit sink is monitored separately.
      console.error("failure audit could not be persisted", {
        action,
        resourceType,
        requestId: ctx.requestId,
        error: auditError instanceof Error ? auditError.message : "unknown",
      });
    }
  }

  async read<T>(
    ctx: RequestContext,
    action: string,
    resourceType: string,
    operation: (tx: RepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.repository.withContext(ctx, async (tx) => {
        const result = await operation(tx);
        await tx.audit(action, resourceType, null, "allowed");
        return result;
      });
    } catch (error) {
      await this.auditFailure(ctx, action, resourceType, error);
      throw error;
    }
  }

  async write(
    ctx: RequestContext,
    endpoint: string,
    key: string | undefined,
    body: unknown,
    action: string,
    resourceType: string,
    operation: (tx: RepositoryTransaction) => Promise<WriteResult>,
  ): Promise<WriteResult> {
    if (!key || key.length > 200)
      throw new ApiProblem(
        "IDEMPOTENCY_REQUIRED",
        422,
        "操作を安全に受け付けるためIdempotency-Keyが必要です",
      );
    const requestHash = sha(JSON.stringify(body ?? {}));
    try {
      const result = await this.repository.withContext(ctx, async (tx) => {
        const existing = await tx.query<{
          request_hash: string;
          response_status: number;
          response_body_redacted: unknown;
        }>(
          `SELECT request_hash,response_status,response_body_redacted FROM idempotency_records WHERE organization_id=$1 AND membership_id=$2 AND endpoint_key=$3 AND idempotency_key=$4 AND expires_at>now()`,
          [ctx.organizationId, ctx.membershipId, endpoint, key],
        );
        const cached = existing.rows[0];
        if (cached) {
          if (cached.request_hash !== requestHash)
            throw new ApiProblem(
              "IDEMPOTENCY_CONFLICT",
              409,
              "同じ操作キーで異なる内容が送信されました",
            );
          return {
            status: cached.response_status,
            body: camel(cached.response_body_redacted),
          };
        }
        const result = await operation(tx);
        await tx.audit(
          action,
          resourceType,
          result.resourceId ?? null,
          "allowed",
          result.auditMetadata ?? {},
        );
        await tx.query(
          `INSERT INTO idempotency_records(organization_id,membership_id,endpoint_key,idempotency_key,request_hash,response_status,response_body_redacted,resource_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '48 hours')`,
          [
            ctx.organizationId,
            ctx.membershipId,
            endpoint,
            key,
            requestHash,
            result.status,
            result.replayBody ?? result.body,
            result.resourceId ?? null,
          ],
        );
        return result;
      });
      return { ...result, body: await this.rehydrateReplay(ctx, result.body) };
    } catch (error) {
      await this.auditFailure(ctx, action, resourceType, error);
      throw error;
    }
  }

  private async rehydrateReplay(
    ctx: RequestContext,
    body: unknown,
  ): Promise<unknown> {
    const replay = body && typeof body === "object" ? (body as Json) : null;
    if (!['upload','videoUpload'].includes(String(replay?.replayKind)) || typeof replay?.uploadId !== "string")
      return body;
    const upload = await this.repository.withContext(ctx, async (tx) => {
      if(replay.replayKind==='videoUpload'){
        const r=await tx.query<any>("SELECT id,organization_id,NULL::uuid visit_id,object_name,mime_type,size_bytes,sha256,expires_at,completed_at FROM video_upload_sessions WHERE organization_id=$1 AND id=$2 AND requested_by_membership_id=$3",[ctx.organizationId,replay.uploadId,ctx.membershipId]);
        return r.rows[0];
      }
      const r = await tx.query<any>(
        "SELECT id,organization_id,visit_id,object_name,mime_type,size_bytes,sha256,expires_at,completed_at FROM upload_sessions WHERE organization_id=$1 AND id=$2",
        [ctx.organizationId, replay.uploadId],
      );
      return r.rows[0];
    });
    if (!upload) throw notFound();
    const replayContext = {
      visitId: String(replay.visitId ?? upload.visit_id),
      caseNumber:
        typeof replay.caseNumber === "string" ? replay.caseNumber : undefined,
    };
    if (upload.completed_at)
      return { uploadId: upload.id, completed: true, ...replayContext };
    if (new Date(upload.expires_at) <= new Date())
      throw new ApiProblem(
        "UPLOAD_EXPIRED",
        410,
        "アップロード受付の期限が切れました",
      );
    const declaration: UploadDeclaration = {
      organizationId: upload.organization_id,
      objectName: upload.object_name,
      mimeType: upload.mime_type,
      sizeBytes: Number(upload.size_bytes),
      sha256: upload.sha256,
      expiresAt: new Date(upload.expires_at),
    };
    return {
      uploadId: upload.id,
      ...replayContext,
      ...(await this.providers.storage.createUpload(declaration)),
    };
  }

  private async claimProviderWrite(
    ctx: RequestContext,
    endpoint: string,
    key: string | undefined,
    body: unknown,
  ): Promise<{ id: string; requestHash: string; cached: WriteResult | null }> {
    if (!key || key.length > 200)
      throw new ApiProblem(
        "IDEMPOTENCY_REQUIRED",
        422,
        "操作を安全に受け付けるためIdempotency-Keyが必要です",
      );
    const requestHash = sha(JSON.stringify(body ?? {}));
    return this.repository.withContext(ctx, async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO idempotency_records(organization_id,membership_id,endpoint_key,idempotency_key,request_hash,response_status,response_body_redacted,expires_at,processing_status,lease_expires_at) VALUES($1,$2,$3,$4,$5,NULL,NULL,now()+interval '48 hours','in_progress',now()+interval '5 minutes') ON CONFLICT(organization_id,membership_id,endpoint_key,idempotency_key) DO NOTHING RETURNING id`,
        [ctx.organizationId, ctx.membershipId, endpoint, key, requestHash],
      );
      const current = await tx.query<{
        id: string;
        request_hash: string;
        response_status: number | null;
        response_body_redacted: unknown;
        processing_status: string;
        lease_expires_at: Date | null;
      }>(
        "SELECT id,request_hash,response_status,response_body_redacted,processing_status,lease_expires_at FROM idempotency_records WHERE organization_id=$1 AND membership_id=$2 AND endpoint_key=$3 AND idempotency_key=$4 AND expires_at>now() FOR UPDATE",
        [ctx.organizationId, ctx.membershipId, endpoint, key],
      );
      const record = current.rows[0];
      if (!record) throw new Error("IDEMPOTENCY_CLAIM_MISSING");
      if (record.request_hash !== requestHash)
        throw new ApiProblem(
          "IDEMPOTENCY_CONFLICT",
          409,
          "同じ操作キーで異なる内容が送信されました",
        );
      if (record.processing_status === "completed")
        return {
          id: record.id,
          requestHash,
          cached: {
            status: Number(record.response_status),
            body: camel(record.response_body_redacted),
          },
        };
      if (
        !inserted.rowCount &&
        record.lease_expires_at &&
        record.lease_expires_at > new Date()
      )
        throw new ApiProblem(
          "IDEMPOTENCY_CONFLICT",
          409,
          "同じ操作を処理中です。完了後に再度確認してください",
          true,
        );
      if (!inserted.rowCount)
        await tx.query(
          "UPDATE idempotency_records SET lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
          [record.id],
        );
      return { id: record.id, requestHash, cached: null };
    });
  }

  private async releaseProviderClaim(
    ctx: RequestContext,
    id: string,
  ): Promise<void> {
    await this.repository.withContext(ctx, async (tx) => {
      await tx.query(
        "UPDATE idempotency_records SET lease_expires_at=now() WHERE organization_id=$1 AND id=$2 AND processing_status='in_progress'",
        [ctx.organizationId, id],
      );
    });
  }

  private async completeProviderWrite(
    ctx: RequestContext,
    claim: { id: string; requestHash: string },
    action: string,
    resourceType: string,
    operation: (tx: RepositoryTransaction) => Promise<WriteResult>,
  ): Promise<WriteResult> {
    try {
      return await this.repository.withContext(ctx, async (tx) => {
        const locked = await tx.query<{
          request_hash: string;
          processing_status: string;
        }>(
          "SELECT request_hash,processing_status FROM idempotency_records WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [ctx.organizationId, claim.id],
        );
        const record = locked.rows[0];
        if (
          !record ||
          record.request_hash !== claim.requestHash ||
          record.processing_status !== "in_progress"
        )
          throw new ApiProblem(
            "IDEMPOTENCY_CONFLICT",
            409,
            "操作状態が更新されています",
          );
        const result = await operation(tx);
        await tx.audit(
          action,
          resourceType,
          result.resourceId ?? null,
          "allowed",
        );
        await tx.query(
          "UPDATE idempotency_records SET response_status=$3,response_body_redacted=$4,resource_id=$5,processing_status='completed',lease_expires_at=NULL WHERE organization_id=$1 AND id=$2",
          [
            ctx.organizationId,
            claim.id,
            result.status,
            result.replayBody ?? result.body,
            result.resourceId ?? null,
          ],
        );
        return result;
      });
    } catch (error) {
      await this.releaseProviderClaim(ctx, claim.id).catch(() => undefined);
      await this.auditFailure(ctx, action, resourceType, error);
      throw error;
    }
  }

  async me(ctx: RequestContext) {
    return this.read(ctx, "auth.me", "membership", async (tx) => {
      const result = await tx.query(
        `SELECT m.id,m.status,m.branch_id,u.display_name,u.email_masked,o.name organization_name,b.name branch_name,array_remove(array_agg(r.role_code),NULL) roles FROM memberships m JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.organization_id JOIN branches b ON b.organization_id=m.organization_id AND b.id=m.branch_id LEFT JOIN role_assignments ra ON ra.membership_id=m.id AND (ra.valid_until IS NULL OR ra.valid_until>now()) LEFT JOIN roles r ON r.id=ra.role_id WHERE m.organization_id=$1 AND m.id=$2 GROUP BY m.id,u.id,o.id,b.id`,
        [ctx.organizationId, ctx.membershipId],
      );
      const row = result.rows[0];
      if (!row)
        throw new ApiProblem(
          "AUTH_INVALID",
          401,
          "利用者情報を確認できませんでした",
        );
      return {
        ...camel<Json>(row),
        capabilities: ctx.capabilities,
        featureFlags: await this.flags(tx, ctx.organizationId),
      };
    });
  }
  private async flags(tx: RepositoryTransaction, org: string) {
    const r = await tx.query<{ flag_key: string; enabled: boolean }>(
      "SELECT flag_key,enabled FROM feature_flags WHERE organization_id=$1 AND (expires_at IS NULL OR expires_at>now())",
      [org],
    );
    return Object.fromEntries(r.rows.map((x) => [x.flag_key, x.enabled]));
  }

  async dashboard(ctx: RequestContext) {
    return this.read(ctx, "dashboard.read", "dashboard", async (tx) => {
      const scope = this.visitAccess(ctx);
      const visits = await tx.query(
        `SELECT id,case_number,status,scheduled_at,customer_label FROM visits WHERE organization_id=$1 AND ($2::boolean OR branch_id=ANY($3::uuid[]) OR ($4::boolean AND assigned_membership_id=$5)) AND deleted_at IS NULL ORDER BY scheduled_at NULLS LAST LIMIT 8`,
        [
          ctx.organizationId,
          scope.organization,
          scope.branchIds,
          scope.self,
          ctx.membershipId,
        ],
      );
      const jobAccess = ctx.capabilities.includes("job:manage")
        ? this.jobAccess(ctx)
        : { organization: false, branchIds: [] as string[] };
      const jobs = await tx.query(
        `SELECT j.id,j.job_type,j.status,j.available_at,j.error_code FROM jobs j
          WHERE j.organization_id=$1 AND (
            ($2::boolean AND $4::boolean)
            OR ($2::boolean AND ${jobBranchExpression("j")}=ANY($5::uuid[]))
            OR j.requested_by_membership_id=$3
          ) ORDER BY j.created_at DESC LIMIT 8`,
        [
          ctx.organizationId,
          ctx.capabilities.includes("job:manage"),
          ctx.membershipId,
          jobAccess.organization,
          jobAccess.branchIds,
        ],
      );
      return { visits: visits.rows.map((row) => visitDto(row)), jobs: camel(jobs.rows) };
    });
  }
  async assist(ctx: RequestContext, b: Json, key: string | undefined) {
    requireCap(ctx, "content:read");
    const question = text(b.question, 1000, "question");
    const retrieval = await this.read(
      ctx,
      "assist.retrieve",
      "content",
      async (tx) => {
        const pilotEnabled = Boolean(
          (await this.flags(tx, ctx.organizationId)).pilot_content_ai,
        );
        const result = await tx.query<{
          id: string;
          version_id: string;
          type: string;
          title: string;
          body: unknown;
          availability_state: "pilot" | "published";
        }>(
          `SELECT c.id,cv.id version_id,c.content_type type,vm.title,cv.body_json body,c.availability_state
             FROM content_items c
             JOIN content_versions cv ON cv.id=CASE
               WHEN c.availability_state='published' THEN c.published_version_id
               WHEN $3::boolean AND c.availability_state='pilot' THEN c.current_version_id
             END
             JOIN content_version_metadata vm ON vm.content_version_id=cv.id
            WHERE c.organization_id=$1 AND c.deleted_at IS NULL AND (
              (c.status='published' AND c.availability_state='published' AND cv.review_status='approved' AND cv.published_at IS NOT NULL AND cv.migration_state NOT IN ('extracted_needs_review','blocked'))
              OR ($3::boolean AND c.status='draft' AND c.availability_state='pilot' AND cv.review_status='draft' AND cv.migration_state='extracted_needs_review' AND cv.published_at IS NULL)
            )
            ORDER BY CASE WHEN vm.search_text ILIKE '%'||$2||'%' THEN 0 ELSE 1 END,GREATEST(similarity(vm.title,$2),similarity(vm.search_text,$2)) DESC,c.display_order,c.id LIMIT 12`,
          [ctx.organizationId, question, pilotEnabled],
        );
        return { knowledge: result.rows, pilotEnabled };
      },
    );
    const { knowledge, pilotEnabled } = retrieval;
    const usesPilot = knowledge.some(
      (item) => item.availability_state === "pilot",
    );
    const claim = await this.claimProviderWrite(ctx, "assist.answer", key, b);
    if (claim.cached) {
      const cachedBody = claim.cached.body as Json;
      const cachedPolicy = cachedBody.contentPolicy as Json | undefined;
      if (!pilotEnabled && cachedPolicy?.usesUnapprovedContent === true)
        throw new ApiProblem(
          "FEATURE_DISABLED",
          404,
          "限定運用コンテンツのAI利用は停止されています",
        );
      const currentVersions = new Map(
        knowledge.map((item) => [item.id, item.version_id]),
      );
      const cachedCitations = Array.isArray(cachedBody.citations)
        ? cachedBody.citations
        : [];
      const stale = cachedCitations.some((citation) => {
        if (!citation || typeof citation !== "object") return true;
        const value = citation as Json;
        return currentVersions.get(String(value.id ?? "")) !==
          String(value.versionId ?? "");
      });
      if (stale)
        throw new ApiProblem(
          "VERSION_CONFLICT",
          409,
          "根拠コンテンツが更新されています。もう一度質問してください",
        );
      return claim.cached;
    }
    let generated: Awaited<ReturnType<AiProvider["answerKnowledge"]>>;
    try {
      generated = await this.providers.ai.answerKnowledge({
        question,
        knowledge,
      });
    } catch (error) {
      await this.releaseProviderClaim(ctx, claim.id);
      await this.auditFailure(ctx, "assist.answer", "content", error);
      throw error;
    }
    if (!generated.answer) {
      const error = new Error("PROVIDER_PERMANENT: AI支援の回答が空です");
      await this.releaseProviderClaim(ctx, claim.id);
      await this.auditFailure(ctx, "assist.answer", "content", error);
      throw error;
    }
    const citations = generated.citationIds
      .map((id) => knowledge.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        id: item.id,
        versionId: item.version_id,
        type: item.type,
        title: item.title,
        availabilityState: item.availability_state,
        requiresReview: item.availability_state === "pilot",
      }));
    if (knowledge.length && !citations.length) {
      const error = new Error("PROVIDER_PERMANENT: AI支援の根拠参照が不正です");
      await this.releaseProviderClaim(ctx, claim.id);
      await this.auditFailure(ctx, "assist.answer", "content", error);
      throw error;
    }
    const response = {
      answer: generated.answer,
      citations,
      suggestedQuestions: generated.suggestedQuestions,
      model: generated.model,
      requestId: ctx.requestId,
      grounded: citations.length > 0,
      contentPolicy: contentPolicy(pilotEnabled, usesPilot,citations.map(citation=>({id:citation.id,versionId:citation.versionId}))),
    };
    return this.completeProviderWrite(
      ctx,
      claim,
      "assist.answer",
      "content",
      async () => ({
        status: 200,
        body: response,
        resourceId: null,
        replayBody: response,
      }),
    );
  }

  async listVisits(ctx: RequestContext, q: Json) {
    return this.read(ctx, "visit.list", "visit", async (tx) => {
      const scope = this.visitAccess(ctx);
      const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
      const values: unknown[] = [
        ctx.organizationId,
        scope.organization,
        scope.branchIds,
        scope.self,
        ctx.membershipId,
      ];
      let where =
        "organization_id=$1 AND ($2::boolean OR branch_id=ANY($3::uuid[]) OR ($4::boolean AND assigned_membership_id=$5)) AND deleted_at IS NULL";
      if (q.status) {
        values.push(String(q.status));
        where += ` AND status=$${values.length}`;
      }
      if (q.query) {
        values.push(`%${String(q.query).replace(/[%_]/g, "\\$&")}%`);
        where += ` AND (case_number ILIKE $${values.length} ESCAPE '\\' OR customer_label ILIKE $${values.length} ESCAPE '\\')`;
      }
      values.push(limit + 1);
      const r = await tx.query(
        `SELECT * FROM visits WHERE ${where} ORDER BY scheduled_at DESC NULLS LAST,id DESC LIMIT $${values.length}`,
        values,
      );
      const items = r.rows.slice(0, limit);
      return {
        items: items.map((row) => visitDto(row)),
        nextCursor: r.rows.length > limit ? String(items.at(-1)?.id) : null,
        hasMore: r.rows.length > limit,
      };
    });
  }
  async getVisit(ctx: RequestContext, id: string) {
    return this.read(ctx, "visit.read", "visit", async (tx) => {
      const scope = this.visitAccess(ctx);
      const r = await tx.query(
        `SELECT * FROM visits WHERE organization_id=$1 AND id=$2 AND ($3::boolean OR branch_id=ANY($4::uuid[]) OR ($5::boolean AND assigned_membership_id=$6))`,
        [
          ctx.organizationId,
          id,
          scope.organization,
          scope.branchIds,
          scope.self,
          ctx.membershipId,
        ],
      );
      const row = r.rows[0];
      if (!row) throw notFound();
      if (row.status === "deleted")
        throw new ApiProblem("RESOURCE_GONE", 410, "対象は削除済みです");
      return visitDto(row);
    });
  }
  async getVisitWorkspace(ctx: RequestContext, id: string) {
    return this.read(ctx, "visit.workspace.read", "visit", async (tx) => {
      const scope = this.visitAccess(ctx);
      const visit = await tx.query<any>(
        `SELECT v.*,b.name branch_name FROM visits v JOIN branches b ON b.id=v.branch_id WHERE v.organization_id=$1 AND v.id=$2 AND v.deleted_at IS NULL AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))`,
        [
          ctx.organizationId,
          id,
          scope.organization,
          scope.branchIds,
          scope.self,
          ctx.membershipId,
        ],
      );
      if (!visit.rows[0]) throw notFound();
      const document = await tx.query<any>(
        "SELECT * FROM visit_documents WHERE organization_id=$1 AND visit_id=$2 AND status<>'deleted' ORDER BY created_at DESC LIMIT 1",
        [ctx.organizationId, id],
      );
      const extraction = document.rows[0]
        ? await tx.query<any>(
            "SELECT * FROM document_extractions WHERE organization_id=$1 AND visit_document_id=$2 ORDER BY version DESC LIMIT 1",
            [ctx.organizationId, document.rows[0].id],
          )
        : null;
      const fields = extraction?.rows[0]
        ? await tx.query(
            `SELECT ${fieldValueProjection} FROM visit_field_values WHERE organization_id=$1 AND document_extraction_id=$2 ORDER BY field_key`,
            [ctx.organizationId, extraction.rows[0].id],
          )
        : null;
      const recording = await tx.query<any>(
        "SELECT * FROM recordings WHERE organization_id=$1 AND visit_id=$2 AND status<>'deleted' ORDER BY created_at DESC LIMIT 1",
        [ctx.organizationId, id],
      );
      const transcript = recording.rows[0]
        ? await tx.query<any>(
            "SELECT * FROM transcripts WHERE organization_id=$1 AND recording_id=$2 AND status<>'deleted' ORDER BY version DESC LIMIT 1",
            [ctx.organizationId, recording.rows[0].id],
          )
        : null;
      const segments = transcript?.rows[0]
        ? await tx.query(
            "SELECT * FROM transcript_segments WHERE organization_id=$1 AND transcript_id=$2 ORDER BY sequence_no",
            [ctx.organizationId, transcript.rows[0].id],
          )
        : null;
      const qualityAssessment = transcript?.rows[0]
        ? await tx.query(
            `SELECT qa.*,COALESCE(array_agg(qe.transcript_segment_id::text) FILTER(WHERE qe.id IS NOT NULL),'{}') evidence_segment_ids
               FROM transcript_quality_assessments qa
               LEFT JOIN transcript_quality_evidence qe ON qe.assessment_id=qa.id AND qe.organization_id=qa.organization_id
              WHERE qa.organization_id=$1 AND qa.transcript_id=$2
              GROUP BY qa.id`,
            [ctx.organizationId, transcript.rows[0].id],
          )
        : null;
      const review = transcript?.rows[0]
        ? await tx.query<any>(
            "SELECT * FROM reviews WHERE organization_id=$1 AND transcript_id=$2 AND status<>'deleted' ORDER BY version DESC LIMIT 1",
            [ctx.organizationId, transcript.rows[0].id],
          )
        : null;
      const findings = review?.rows[0]
        ? await tx.query(
            `SELECT f.*,COALESCE(json_agg(json_build_object('segmentId',e.transcript_segment_id,'excerpt',e.excerpt)) FILTER(WHERE e.id IS NOT NULL),'[]') evidence FROM review_findings f LEFT JOIN review_evidence e ON e.review_finding_id=f.id WHERE f.organization_id=$1 AND f.review_id=$2 GROUP BY f.id ORDER BY f.sequence_no`,
            [ctx.organizationId, review.rows[0].id],
          )
        : null;
      const consent = await tx.query(
        "SELECT id,status,method,notice_version,occurred_at FROM recording_consents WHERE organization_id=$1 AND visit_id=$2 ORDER BY occurred_at DESC LIMIT 1",
        [ctx.organizationId, id],
      );
      const jobs = await tx.query(
        "SELECT id,job_type,status,entity_type,entity_id,attempt_count,max_attempts,error_code,created_at,finished_at,CASE WHEN job_type='review' THEN input_redacted->'dimensions' ELSE NULL END analysis_dimensions FROM jobs WHERE organization_id=$1 AND requested_by_membership_id=$2 AND (entity_id=$3 OR entity_id IN (SELECT id FROM visit_documents WHERE visit_id=$3 UNION SELECT id FROM recordings WHERE visit_id=$3 UNION SELECT id FROM transcripts WHERE recording_id IN (SELECT id FROM recordings WHERE visit_id=$3))) ORDER BY created_at DESC LIMIT 20",
        [ctx.organizationId, ctx.membershipId, id],
      );
      return {
        visit: visitDto(visit.rows[0]),
        document: camel(document.rows[0] ?? null),
        extraction: extraction ? camel(extraction.rows[0] ?? null) : null,
        fields: camel(fields?.rows ?? []),
        recording: camel(recording.rows[0] ?? null),
        transcript: transcript ? camel(transcript.rows[0] ?? null) : null,
        segments: camel(segments?.rows ?? []),
        qualityAssessment: qualityAssessment ? camel(qualityAssessment.rows[0] ?? null) : null,
        review: review?.rows[0] ? {...camel<Json>(review.rows[0]),analysisDimensions:reviewAnalysisDimensions(review.rows[0])} : null,
        findings: camel(findings?.rows ?? []),
        consent: camel(consent.rows[0] ?? null),
        jobs: camel(jobs.rows),
      };
    });
  }
  async getDocumentFile(ctx: RequestContext, id: string) {
    const object = await this.read(
      ctx,
      "document.file.read",
      "document",
      async (tx) => {
        const scope = this.visitAccess(ctx);
        const r = await tx.query<{
          object_name: string;
          object_generation: string;
          mime_type: string;
        }>(
          `SELECT o.object_name,o.object_generation::text,o.mime_type FROM visit_documents d JOIN storage_objects o ON o.id=d.storage_object_id JOIN visits v ON v.id=d.visit_id WHERE d.organization_id=$1 AND d.id=$2 AND d.status<>'deleted' AND o.status='available' AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))`,
          [
            ctx.organizationId,
            id,
            scope.organization,
            scope.branchIds,
            scope.self,
            ctx.membershipId,
          ],
        );
        if (!r.rows[0]) throw notFound();
        return r.rows[0];
      },
    );
    return this.providers.storage.createDownload(
      object.object_name,
      object.object_generation,
      object.mime_type,
      new Date(Date.now() + 5 * 60_000),
    );
  }
  async getRecordingFile(
    ctx: RequestContext,
    id: string,
    rangeHeader?: string,
  ) {
    const object = await this.read(
      ctx,
      "recording.file.read",
      "recording",
      async (tx) => {
        const scope = this.visitAccess(ctx);
        const r = await tx.query<{
          bucket_name: string;
          object_name: string;
          object_generation: string;
          mime_type: string;
          size_bytes: string;
        }>(
          `SELECT o.bucket_name,o.object_name,o.object_generation::text,o.mime_type,o.size_bytes::text FROM recordings rec JOIN storage_objects o ON o.id=rec.storage_object_id JOIN visits v ON v.id=rec.visit_id WHERE rec.organization_id=$1 AND rec.id=$2 AND rec.status<>'deleted' AND o.status='available' AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))`,
          [
            ctx.organizationId,
            id,
            scope.organization,
            scope.branchIds,
            scope.self,
            ctx.membershipId,
          ],
        );
        if (!r.rows[0]) throw notFound();
        return r.rows[0];
      },
    );
    if (object.bucket_name !== "local")
      return this.providers.storage.createDownload(
        object.object_name,
        object.object_generation,
        object.mime_type,
        new Date(Date.now() + 5 * 60_000),
      );
    const totalSize = Number(object.size_bytes);
    let start = 0,
      end = totalSize - 1,
      partial = false;
    if (rangeHeader) {
      const range = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
      if (!range) return { kind: "range_invalid" as const, totalSize };
      partial = true;
      if (!range[1] && range[2]) {
        const suffix = Number(range[2]);
        if (!Number.isInteger(suffix) || suffix <= 0)
          return { kind: "range_invalid" as const, totalSize };
        start = Math.max(0, totalSize - suffix);
      } else {
        start = range[1] ? Number(range[1]) : 0;
        end = range[2] ? Number(range[2]) : totalSize - 1;
      }
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        start >= totalSize
      )
        return { kind: "range_invalid" as const, totalSize };
      end = Math.min(end, totalSize - 1);
    }
    return {
      kind: "stream" as const,
      source: await this.providers.storage.openRead(
        object.object_name,
        object.object_generation,
        { start, end },
      ),
      mimeType: object.mime_type,
      totalSize,
      start,
      end,
      partial,
    };
  }
  async createVisit(ctx: RequestContext, key: string | undefined, b: Json) {
    const scope = this.visitAccess(ctx);
    return this.write(
      ctx,
      "visits.create",
      key,
      b,
      "visit.create",
      "visit",
      async (tx) => {
        const id = randomUUID();
        const caseNumber = text(b.caseNumber, 100, "caseNumber");
        const branchId = String(b.branchId ?? ctx.branchId);
        if (!scope.organization && !scope.branchIds.includes(branchId) && branchId !== ctx.branchId)
          throw denied();
        const assignee = scope.organization || scope.branchIds.includes(branchId)
          ? String(b.assignedMembershipId ?? ctx.membershipId)
          : ctx.membershipId;
        const eligible = await tx.query(
          `SELECT 1 FROM memberships m WHERE m.organization_id=$1 AND m.id=$2 AND m.branch_id=$3 AND m.status='active'
             AND NOT EXISTS(SELECT 1 FROM role_assignments ra JOIN roles r ON r.id=ra.role_id WHERE ra.organization_id=m.organization_id AND ra.membership_id=m.id AND r.role_code='system_admin' AND (ra.valid_until IS NULL OR ra.valid_until>now()))`,
          [ctx.organizationId, assignee, branchId],
        );
        if (!eligible.rowCount) throw invalid("担当者と所属店舗を確認してください");
        try {
          const r = await tx.query(
            `INSERT INTO visits(id,organization_id,branch_id,assigned_membership_id,case_number,status,scheduled_at,customer_label,notes_redacted) VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8) RETURNING *`,
            [
              id,
              ctx.organizationId,
              branchId,
              assignee,
              caseNumber,
              b.scheduledAt ?? null,
              b.customerLabel ?? null,
              b.notesRedacted ?? null,
            ],
          );
          return { status: 201, body: visitDto(r.rows[0]!), resourceId: id };
        } catch (error: any) {
          if (error?.code === "23505")
            throw new ApiProblem(
              "VERSION_CONFLICT",
              409,
              "同じ案件番号が既に存在します",
            );
          throw error;
        }
      },
    );
  }
  async startVisitImport(
    ctx: RequestContext,
    key: string | undefined,
    b: Json,
  ) {
    this.visitAccess(ctx);
    return this.write(
      ctx,
      "visit.import.start",
      key,
      b,
      "visit.import.start",
      "visit",
      async (tx) => {
        const mime = text(b.mimeType, 255, "mimeType");
        if (mime !== "application/pdf")
          throw new ApiProblem(
            "FILE_TYPE_INVALID",
            422,
            "PDFファイルを選択してください",
          );
        const size = integer(b.sizeBytes, 1, 30_000_000, "sizeBytes");
        const digest = String(b.sha256 ?? "");
        if (!/^[a-f0-9]{64}$/.test(digest))
          throw invalid("SHA-256を確認してください", [
            { field: "sha256", message: "64桁の小文字16進数が必要です" },
          ]);

        const visitId = randomUUID();
        const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        const caseNumber = `PDF-${date}-${visitId.slice(0, 8).toUpperCase()}`;
        await tx.query(
          `INSERT INTO visits(id,organization_id,branch_id,assigned_membership_id,case_number,status) VALUES($1,$2,$3,$4,$5,'draft')`,
          [
            visitId,
            ctx.organizationId,
            ctx.branchId,
            ctx.membershipId,
            caseNumber,
          ],
        );

        const uploadId = randomUUID();
        const objectName = `organizations/${ctx.organizationId}/visits/${visitId}/documents/${uploadId}/source`;
        const expiresAt = new Date(Date.now() + 15 * 60_000);
        await tx.query(
          `INSERT INTO upload_sessions(id,organization_id,visit_id,upload_type,object_name,mime_type,size_bytes,sha256,requested_by_membership_id,expires_at) VALUES($1,$2,$3,'document',$4,$5,$6,$7,$8,$9)`,
          [
            uploadId,
            ctx.organizationId,
            visitId,
            objectName,
            mime,
            size,
            digest,
            ctx.membershipId,
            expiresAt,
          ],
        );
        const replayBody = {
          replayKind: "upload",
          uploadId,
          visitId,
          caseNumber,
        };
        return {
          status: 201,
          body: replayBody,
          replayBody,
          resourceId: visitId,
        };
      },
    );
  }
  async updateVisit(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    this.requireVisitCapability(ctx);
    return this.write(
      ctx,
      "visits.update",
      key,
      b,
      "visit.update",
      "visit",
      async (tx) => {
        await this.assertVisitMutable(tx, ctx, id);
        const r = await tx.query(
          `UPDATE visits SET status=COALESCE($3,status),scheduled_at=COALESCE($4::timestamptz,scheduled_at),scheduled_local_date=CASE WHEN $4::timestamptz IS NULL THEN scheduled_local_date ELSE ($4::timestamptz AT TIME ZONE 'Asia/Tokyo')::date END,scheduled_local_time=CASE WHEN $4::timestamptz IS NULL THEN scheduled_local_time ELSE ($4::timestamptz AT TIME ZONE 'Asia/Tokyo')::time(0) END,customer_label=COALESCE($5,customer_label),notes_redacted=COALESCE($6,notes_redacted),lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2 AND lock_version=$7 RETURNING *`,
          [
            ctx.organizationId,
            id,
            b.status ?? null,
            b.scheduledAt ?? null,
            b.customerLabel ?? null,
            b.notesRedacted ?? null,
            Number(b.expectedLockVersion),
          ],
        );
        if (!r.rows[0])
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "他の利用者が更新しました。再読み込みしてください",
          );
        return { status: 200, body: visitDto(r.rows[0]!), resourceId: id };
      },
    );
  }

  async startUpload(
    ctx: RequestContext,
    visitId: string,
    type: "document" | "recording",
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      `${type}.upload.start`,
      key,
      b,
      `${type}.upload.start`,
      type,
      async (tx) => {
        await this.assertVisitMutable(tx, ctx, visitId);
        const mime = text(b.mimeType, 255, "mimeType");
        if (type === "document" && mime !== "application/pdf")
          throw new ApiProblem(
            "FILE_TYPE_INVALID",
            422,
            "PDFファイルを選択してください",
          );
        if (type === "recording" && !/^audio\//.test(mime))
          throw new ApiProblem(
            "FILE_TYPE_INVALID",
            422,
            "対応する音声ファイルを選択してください",
          );
        const size = integer(
          b.sizeBytes,
          1,
          type === "document" ? 30_000_000 : 1_000_000_000,
          "sizeBytes",
        );
        const digest = String(b.sha256 ?? "");
        if (!/^[a-f0-9]{64}$/.test(digest))
          throw invalid("SHA-256を確認してください", [
            { field: "sha256", message: "64桁の小文字16進数が必要です" },
          ]);
        if (type === "recording") {
          await this.assertCurrentConsent(
            tx,
            ctx.organizationId,
            visitId,
            b.consentId,
          );
        }
        const uploadId = randomUUID();
        const objectName = `organizations/${ctx.organizationId}/visits/${visitId}/${type}s/${uploadId}/source`;
        const expiresAt = new Date(Date.now() + 15 * 60_000);
        await tx.query(
          `INSERT INTO upload_sessions(id,organization_id,visit_id,upload_type,object_name,mime_type,size_bytes,sha256,consent_id,requested_by_membership_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            uploadId,
            ctx.organizationId,
            visitId,
            type,
            objectName,
            mime,
            size,
            digest,
            b.consentId ?? null,
            ctx.membershipId,
            expiresAt,
          ],
        );
        const replayBody = { replayKind: "upload", uploadId };
        return {
          status: 201,
          body: replayBody,
          replayBody,
          resourceId: uploadId,
        };
      },
    );
  }
  async acceptLocalUpload(
    ctx: RequestContext,
    objectName: string,
    body: Readable,
  ) {
    if (!["local", "local-connected"].includes(this.providers.mode))
      throw notFound();
    try {
      const declaration = await this.repository.withContext(ctx, async (tx) => {
        if(this.hasOrganizationCapability(ctx,"content:write")){
          const video=await tx.query<any>("SELECT organization_id,object_name,mime_type,size_bytes,sha256,expires_at FROM video_upload_sessions WHERE organization_id=$1 AND object_name=$2 AND requested_by_membership_id=$3 AND expires_at>now() AND completed_at IS NULL",[ctx.organizationId,objectName,ctx.membershipId]);
          if(video.rows[0])return{organizationId:video.rows[0].organization_id,objectName:video.rows[0].object_name,mimeType:video.rows[0].mime_type,sizeBytes:Number(video.rows[0].size_bytes),sha256:video.rows[0].sha256,expiresAt:new Date(video.rows[0].expires_at)} satisfies UploadDeclaration;
        }
        const scope = this.visitAccess(ctx);
        const result = await tx.query<any>(
          "SELECT u.organization_id,u.object_name,u.mime_type,u.size_bytes,u.sha256,u.expires_at FROM upload_sessions u JOIN visits v ON v.id=u.visit_id WHERE u.organization_id=$1 AND u.object_name=$2 AND u.expires_at>now() AND u.completed_at IS NULL AND v.deleted_at IS NULL AND v.status NOT IN ('deleting','deleted') AND NOT EXISTS(SELECT 1 FROM visit_deletion_fences f WHERE f.organization_id=v.organization_id AND f.visit_id=v.id AND f.operation='delete') AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))",
          [
            ctx.organizationId,
            objectName,
            scope.organization,
            scope.branchIds,
            scope.self,
            ctx.membershipId,
          ],
        );
        const row = result.rows[0];
        if (!row)
          throw new ApiProblem(
            "UPLOAD_EXPIRED",
            410,
            "アップロード受付の期限が切れました",
          );
        return {
          organizationId: row.organization_id,
          objectName: row.object_name,
          mimeType: row.mime_type,
          sizeBytes: Number(row.size_bytes),
          sha256: row.sha256,
          expiresAt: new Date(row.expires_at),
        } satisfies UploadDeclaration;
      });
      await acceptLocalUploadStream(objectName, declaration, body);
      await this.repository.withContext(ctx, async (tx) =>
        tx.audit("upload.local", "upload", null, "allowed"),
      );
      return { received: true };
    } catch (error) {
      await this.auditFailure(ctx, "upload.local", "upload", error);
      throw error;
    }
  }

  async startVideoUpload(ctx:RequestContext,contentId:string,key:string|undefined,b:Json){
    this.requireOrganizationCapability(ctx,"content:write");
    if(!ctx.roles.includes("educator"))throw denied("教育担当者だけが動画を登録できます");
    return this.write(ctx,"video.upload.start",key,b,"video.upload.start","content",async tx=>{
      const versionId=text(b.versionId,100,"versionId");
      const version=await tx.query("SELECT 1 FROM content_items c JOIN content_versions v ON v.content_item_id=c.id WHERE c.organization_id=$1 AND c.id=$2 AND c.content_type='video' AND c.current_version_id=v.id AND v.id=$3 AND v.created_by_membership_id=$4",[ctx.organizationId,contentId,versionId,ctx.membershipId]);
      if(!version.rowCount)throw notFound();
      const mime=text(b.mimeType,255,"mimeType");if(!['video/mp4','video/webm'].includes(mime))throw invalid("MP4またはWebM動画を選択してください");
      const size=integer(b.sizeBytes,1,2_000_000_000,"sizeBytes");const digest=String(b.sha256??"");if(!/^[a-f0-9]{64}$/.test(digest))throw invalid("SHA-256を確認してください");
      const uploadId=randomUUID(),objectName=`organizations/${ctx.organizationId}/training/videos/${contentId}/${versionId}/${uploadId}/source`,expiresAt=new Date(Date.now()+15*60_000);
      await tx.query("INSERT INTO video_upload_sessions(id,organization_id,content_item_id,content_version_id,object_name,mime_type,size_bytes,sha256,requested_by_membership_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[uploadId,ctx.organizationId,contentId,versionId,objectName,mime,size,digest,ctx.membershipId,expiresAt]);
      const replayBody={replayKind:"videoUpload",uploadId,contentId,versionId};return{status:201,body:replayBody,replayBody,resourceId:contentId};
    });
  }

  async completeVideoUpload(ctx:RequestContext,uploadId:string,key:string|undefined,b:Json){
    this.requireOrganizationCapability(ctx,"content:write");
    if(!ctx.roles.includes("educator"))throw denied("教育担当者だけが動画を登録できます");
    const upload=await this.repository.withContext(ctx,async tx=>{const r=await tx.query<any>("SELECT * FROM video_upload_sessions WHERE organization_id=$1 AND id=$2 AND requested_by_membership_id=$3 AND completed_at IS NULL AND expires_at>now()",[ctx.organizationId,uploadId,ctx.membershipId]);if(!r.rows[0])throw notFound();return r.rows[0];});
    const declaration:UploadDeclaration={organizationId:ctx.organizationId,objectName:upload.object_name,mimeType:upload.mime_type,sizeBytes:Number(upload.size_bytes),sha256:upload.sha256,expiresAt:new Date(upload.expires_at)};
    const stored=await this.providers.storage.verify(declaration);let metadata:VideoMetadata;
    try{metadata=await this.providers.storage.probeVideo(stored.objectName,stored.generation);}catch(error){await this.providers.storage.delete(stored.objectName,stored.generation).catch(()=>undefined);throw error;}
    try{return await this.write(ctx,"video.upload.complete",key,b,"video.upload.complete","training_video",async tx=>{
      const current=await tx.query<any>("SELECT * FROM video_upload_sessions WHERE organization_id=$1 AND id=$2 AND requested_by_membership_id=$3 AND completed_at IS NULL AND expires_at>now() FOR UPDATE",[ctx.organizationId,uploadId,ctx.membershipId]);if(!current.rows[0])throw notFound();
      const policy=await this.retentionPolicy(tx,ctx.organizationId,"video");const storageId=randomUUID(),videoId=randomUUID();
      await tx.query("INSERT INTO storage_objects(id,organization_id,bucket_name,object_name,object_generation,purpose,status,mime_type,size_bytes,sha256,retention_until,retention_policy_id) VALUES($1,$2,$3,$4,$5,'training_video','available',$6,$7,$8,now()+($9||' days')::interval,$10)",[storageId,ctx.organizationId,stored.bucket,stored.objectName,Number(stored.generation),stored.mimeType,stored.sizeBytes,stored.sha256,policy.retention_days,policy.id]);
      const result=await tx.query("INSERT INTO training_videos(id,organization_id,content_item_id,content_version_id,storage_object_id,duration_ms,width,height,media_metadata,status,retention_until,retention_policy_id,uploaded_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',now()+($10||' days')::interval,$11,$12) RETURNING *",[videoId,ctx.organizationId,current.rows[0].content_item_id,current.rows[0].content_version_id,storageId,metadata.durationMs,metadata.width,metadata.height,metadata,policy.retention_days,policy.id,ctx.membershipId]);
      await tx.query("UPDATE video_upload_sessions SET completed_at=now() WHERE id=$1",[uploadId]);return{status:201,body:camel(result.rows[0]),resourceId:videoId};
    });}catch(error){await deleteUploadObjectIfProvenUnreferenced(()=>this.repository.withContext(ctx,tx=>tx.query("SELECT 1 FROM storage_objects WHERE organization_id=$1 AND object_name=$2 AND object_generation=$3",[ctx.organizationId,stored.objectName,Number(stored.generation)])),()=>this.providers.storage.delete(stored.objectName,stored.generation));throw error;}
  }

  async getTrainingVideoFile(ctx:RequestContext,contentId:string,rangeHeader?:string){
    requireCap(ctx,"content:read");const canPreviewDraft=ctx.capabilities.includes("content:write");const object=await this.read(ctx,"training.video.read","training_video",async tx=>{const r=await tx.query<any>("SELECT o.bucket_name,o.object_name,o.object_generation::text,o.mime_type,o.size_bytes::text FROM training_videos v JOIN content_items c ON c.id=v.content_item_id JOIN storage_objects o ON o.id=v.storage_object_id WHERE v.organization_id=$1 AND v.content_item_id=$2 AND v.status='ready' AND o.status='available' AND (($3::boolean AND v.content_version_id=c.current_version_id) OR (c.availability_state='pilot' AND v.content_version_id=c.current_version_id) OR (c.status='published' AND v.content_version_id=c.published_version_id))",[ctx.organizationId,contentId,canPreviewDraft]);if(!r.rows[0])throw notFound();return r.rows[0];});
    if(object.bucket_name!=="local")return this.providers.storage.createDownload(object.object_name,object.object_generation,object.mime_type,new Date(Date.now()+5*60_000));
    const totalSize=Number(object.size_bytes);let start=0,end=totalSize-1,partial=false;if(rangeHeader){const range=rangeHeader.match(/^bytes=(\d*)-(\d*)$/);if(!range)return{kind:"range_invalid" as const,totalSize};partial=true;if(!range[1]&&range[2]){const suffix=Number(range[2]);if(!Number.isInteger(suffix)||suffix<=0)return{kind:"range_invalid" as const,totalSize};start=Math.max(0,totalSize-suffix);}else{start=Number(range[1]);end=range[2]?Number(range[2]):end;}if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>end||start>=totalSize)return{kind:"range_invalid" as const,totalSize};end=Math.min(end,totalSize-1);}
    return{kind:"stream" as const,source:await this.providers.storage.openRead(object.object_name,object.object_generation,{start,end}),mimeType:object.mime_type,totalSize,start,end,partial};
  }
  async completeUpload(
    ctx: RequestContext,
    uploadId: string,
    key: string | undefined,
    b: Json,
  ) {
    if (!key || key.length > 200)
      throw new ApiProblem(
        "IDEMPOTENCY_REQUIRED",
        422,
        "操作を安全に受け付けるためIdempotency-Keyが必要です",
      );
    const requestHash = sha(JSON.stringify(b ?? {}));
    const cached = await this.repository.withContext(ctx, async (tx) => {
      const result = await tx.query<{
        request_hash: string;
        response_status: number;
        response_body_redacted: unknown;
      }>(
        "SELECT request_hash,response_status,response_body_redacted FROM idempotency_records WHERE organization_id=$1 AND membership_id=$2 AND endpoint_key='upload.complete' AND idempotency_key=$3 AND expires_at>now()",
        [ctx.organizationId, ctx.membershipId, key],
      );
      return result.rows[0];
    });
    if (cached) {
      if (cached.request_hash !== requestHash)
        throw new ApiProblem(
          "IDEMPOTENCY_CONFLICT",
          409,
          "同じ操作キーで異なる内容が送信されました",
        );
      return {
        status: cached.response_status,
        body: camel(cached.response_body_redacted),
      };
    }
    const upload = await this.repository.withContext(ctx, async (tx) => {
      const scope = this.visitAccess(ctx);
      const result = await tx.query<any>(
        "SELECT u.* FROM upload_sessions u JOIN visits v ON v.id=u.visit_id WHERE u.organization_id=$1 AND u.id=$2 AND v.deleted_at IS NULL AND v.status NOT IN ('deleting','deleted') AND NOT EXISTS(SELECT 1 FROM visit_deletion_fences f WHERE f.organization_id=v.organization_id AND f.visit_id=v.id AND f.operation='delete') AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))",
        [
          ctx.organizationId,
          uploadId,
          scope.organization,
          scope.branchIds,
          scope.self,
          ctx.membershipId,
        ],
      );
      const row = result.rows[0];
      if (!row) throw notFound();
      if (row.completed_at)
        throw new ApiProblem(
          "JOB_STATE_CONFLICT",
          409,
          "このアップロードは完了済みです",
        );
      if (new Date(row.expires_at) < new Date())
        throw new ApiProblem(
          "UPLOAD_EXPIRED",
          410,
          "アップロード受付の期限が切れました",
        );
      return row;
    });
    const declaration = {
      organizationId: ctx.organizationId,
      objectName: upload.object_name,
      mimeType: upload.mime_type,
      sizeBytes: Number(upload.size_bytes),
      sha256: upload.sha256,
      expiresAt: new Date(upload.expires_at),
    };
    const stored = await this.providers.storage.verify(declaration);
    let audioMetadata: AudioMetadata | null = null;
    if (upload.upload_type === "document") {
      const signature = await hasPdfSignature(
        await this.providers.storage.openRead(
          stored.objectName,
          stored.generation,
          { start: 0, end: 4 },
        ),
      );
      if (!signature) {
        const error = new ApiProblem(
          "FILE_TYPE_INVALID",
          422,
          "PDFファイルの内容を確認してください",
        );
        await this.providers.storage
          .delete(stored.objectName, stored.generation)
          .catch(() => undefined);
        await this.auditFailure(ctx, "upload.complete", "document", error);
        throw error;
      }
    } else {
      try {
        audioMetadata = await this.providers.storage.probeAudio(
          stored.objectName,
          stored.generation,
        );
      } catch (error) {
        await this.providers.storage
          .delete(stored.objectName, stored.generation)
          .catch(() => undefined);
        await this.auditFailure(ctx, "upload.complete", "recording", error);
        throw error;
      }
    }
    try {
      return await this.write(
        ctx,
        "upload.complete",
        key,
        b,
        "upload.complete",
        "upload",
        async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [upload.visit_id]);
        const scope = this.visitAccess(ctx);
        const result = await tx.query<any>(
          "SELECT u.* FROM upload_sessions u JOIN visits v ON v.id=u.visit_id WHERE u.organization_id=$1 AND u.id=$2 AND v.deleted_at IS NULL AND v.status NOT IN ('deleting','deleted') AND NOT EXISTS(SELECT 1 FROM visit_deletion_fences f WHERE f.organization_id=v.organization_id AND f.visit_id=v.id AND f.operation='delete') AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6)) FOR UPDATE OF u",
          [
            ctx.organizationId,
            uploadId,
            scope.organization,
            scope.branchIds,
            scope.self,
            ctx.membershipId,
          ],
        );
        const current = result.rows[0];
        if (!current) throw notFound();
        if (current.completed_at)
          throw new ApiProblem(
            "JOB_STATE_CONFLICT",
            409,
            "このアップロードは完了済みです",
          );
        if (current.upload_type === "recording")
          await this.assertCurrentConsent(
            tx,
            ctx.organizationId,
            current.visit_id,
            current.consent_id,
          );
        const policy = await this.retentionPolicy(
          tx,
          ctx.organizationId,
          current.upload_type === "document" ? "pdf" : "audio",
        );
        const storageId = randomUUID();
        await tx.query(
          `INSERT INTO storage_objects(id,organization_id,bucket_name,object_name,object_generation,purpose,status,mime_type,size_bytes,sha256,retention_until,retention_policy_id) VALUES($1,$2,$3,$4,$5,$6,'available',$7,$8,$9,now()+($10||' days')::interval,$11)`,
          [
            storageId,
            ctx.organizationId,
            stored.bucket,
            stored.objectName,
            Number(stored.generation),
            current.upload_type === "document" ? "visit_pdf" : "recording",
            stored.mimeType,
            stored.sizeBytes,
            stored.sha256,
            policy.retention_days,
            policy.id,
          ],
        );
        const entityId = randomUUID();
        let bodyOut: unknown;
        if (current.upload_type === "document") {
          const document = await tx.query(
            `INSERT INTO visit_documents(id,organization_id,visit_id,storage_object_id,status,uploaded_by_membership_id) VALUES($1,$2,$3,$4,'ready',$5) RETURNING *`,
            [
              entityId,
              ctx.organizationId,
              current.visit_id,
              storageId,
              ctx.membershipId,
            ],
          );
          bodyOut = camel(document.rows[0]);
        } else {
          if (!audioMetadata)
            throw new Error("PROVIDER_PERMANENT: 音声検査結果がありません");
          const recording = await tx.query(
            `INSERT INTO recordings(id,organization_id,visit_id,consent_id,storage_object_id,source_type,captured_at,duration_ms,status,retention_until,retention_policy_id,uploaded_by_membership_id,media_metadata) VALUES($1,$2,$3,$4,$5,'upload',$6,$7,'ready',now()+($8||' days')::interval,$9,$10,$11) RETURNING *`,
            [
              entityId,
              ctx.organizationId,
              current.visit_id,
              current.consent_id,
              storageId,
              b.capturedAt ?? null,
              audioMetadata.durationMs,
              policy.retention_days,
              policy.id,
              ctx.membershipId,
              audioMetadata,
            ],
          );
          bodyOut = camel(recording.rows[0]);
        }
        await tx.query(
          "UPDATE upload_sessions SET completed_at=now() WHERE id=$1",
          [uploadId],
        );
        return { status: 201, body: bodyOut, resourceId: entityId };
        },
      );
    } catch (error) {
      await deleteUploadObjectIfProvenUnreferenced(
        () =>
          this.repository.withContext(ctx, async (tx) =>
            tx.query(
              "SELECT 1 FROM storage_objects WHERE organization_id=$1 AND object_name=$2 AND object_generation=$3",
              [ctx.organizationId, stored.objectName, Number(stored.generation)],
            ),
          ),
        () => this.providers.storage.delete(stored.objectName, stored.generation),
      );
      throw error;
    }
  }

  async createConsent(
    ctx: RequestContext,
    visitId: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "consent.create",
      key,
      b,
      "consent.record",
      "recording_consent",
      async (tx) => {
        await this.assertVisitMutable(tx, ctx, visitId);
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          visitId,
        ]);
        const id = randomUUID();
        const status = String(b.status);
        if (!["granted", "declined", "withdrawn"].includes(status))
          throw invalid("同意状態を確認してください");
        const noticeVersion=String(b.noticeVersion??"");
        const noticeText=noticeVersion===recordingConsentNoticeVersion
          ? recordingConsentNotice
          : noticeVersion===recordingConsentLegacyNoticeVersion
            ? recordingConsentLegacyNotice
            : null;
        if(!noticeText)throw invalid("録音同意文を更新してから確認してください",[{field:"noticeVersion",message:`version ${recordingConsentNoticeVersion} が必要です`}]);
        const r = await tx.query(
          `INSERT INTO recording_consents(id,organization_id,visit_id,status,method,notice_version,notice_hash,explained_by_membership_id,recorded_by_membership_id,occurred_at,withdrawn_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10) RETURNING *`,
          [
            id,
            ctx.organizationId,
            visitId,
            status,
            b.method ?? "verbal",
            noticeVersion,
            sha(noticeText),
            ctx.membershipId,
            b.occurredAt ?? new Date(),
            status === "withdrawn" ? new Date() : null,
          ],
        );
        if (status !== "granted") {
          await tx.query(
            "UPDATE upload_sessions SET expires_at=LEAST(expires_at,now()) WHERE organization_id=$1 AND visit_id=$2 AND upload_type='recording' AND completed_at IS NULL",
            [ctx.organizationId, visitId],
          );
          await tx.query(
            `UPDATE jobs j SET cancel_requested_at=now(),status=CASE WHEN j.status IN ('queued','retry_wait') THEN 'cancelled' ELSE j.status END,finished_at=CASE WHEN j.status IN ('queued','retry_wait') THEN now() ELSE j.finished_at END,lease_expires_at=CASE WHEN j.status IN ('queued','retry_wait') THEN NULL ELSE j.lease_expires_at END,updated_at=now()
              WHERE j.organization_id=$1 AND j.status IN ('queued','retry_wait','running') AND (
                (j.job_type='drive_import' AND j.entity_id IN (SELECT di.id FROM drive_imports di WHERE di.organization_id=$1 AND di.visit_id=$2)) OR
                (j.job_type='transcribe' AND j.entity_id IN (SELECT rec.id FROM recordings rec WHERE rec.organization_id=$1 AND rec.visit_id=$2))
              )`,
            [ctx.organizationId, visitId],
          );
          await tx.query(
            "UPDATE drive_imports SET status='cancelled',updated_at=now() WHERE organization_id=$1 AND visit_id=$2 AND status='queued'",
            [ctx.organizationId, visitId],
          );
        }
        return { status: 201, body: camel(r.rows[0]), resourceId: id };
      },
    );
  }

  async createDriveConnection(
    ctx: RequestContext,
    key: string | undefined,
    b: Json,
  ) {
    const redactedBody = { code_hash: sha(String(b.code ?? "")) };
    const claim = await this.claimProviderWrite(
      ctx,
      "drive.connection.create",
      key,
      redactedBody,
    );
    if (claim.cached) return claim.cached;
    let exchanged: Awaited<
      ReturnType<PlatformProviders["drive"]["exchangeAuthorizationCode"]>
    >;
    try {
      exchanged = await this.providers.drive.exchangeAuthorizationCode(
        text(b.code, 4096, "code"),
      );
    } catch (error) {
      await this.releaseProviderClaim(ctx, claim.id).catch(() => undefined);
      await this.auditFailure(
        ctx,
        "drive.connection.create",
        "external_connection",
        error,
      );
      throw error;
    }
    try {
      const previous = await this.read(
        ctx,
        "drive.connection.replace.prepare",
        "external_connection",
        async (tx) =>
          (
            await tx.query<{ refresh_token_ciphertext: Buffer }>(
              "SELECT refresh_token_ciphertext FROM external_connections WHERE organization_id=$1 AND membership_id=$2 AND provider='google_drive' AND revoked_at IS NULL ORDER BY created_at,id",
              [ctx.organizationId, ctx.membershipId],
            )
          ).rows,
      );
      for (const connection of previous) {
        const oldToken = this.cipher.decrypt(
          connection.refresh_token_ciphertext,
        );
        if (oldToken !== exchanged.refreshToken)
          await this.providers.drive.revoke(oldToken);
      }
    } catch (error) {
      await this.providers.drive
        .revoke(exchanged.refreshToken)
        .catch(() => undefined);
      await this.releaseProviderClaim(ctx, claim.id).catch(() => undefined);
      await this.auditFailure(
        ctx,
        "drive.connection.replace",
        "external_connection",
        error,
      );
      throw error;
    }
    try {
      return await this.completeProviderWrite(
        ctx,
        claim,
        "drive.connection.create",
        "external_connection",
        async (tx) => {
          const id = randomUUID();
          await tx.query(
            "UPDATE external_connections SET revoked_at=now() WHERE organization_id=$1 AND membership_id=$2 AND provider='google_drive' AND revoked_at IS NULL",
            [ctx.organizationId, ctx.membershipId],
          );
          const result = await tx.query(
            `INSERT INTO external_connections(id,organization_id,membership_id,provider,provider_account_id_hash,refresh_token_ciphertext,token_key_version,scopes,expires_at,last_verified_at) VALUES($1,$2,$3,'google_drive',$4,$5,$6,$7,$8,now()) RETURNING id,provider,scopes,expires_at,last_verified_at`,
            [
              id,
              ctx.organizationId,
              ctx.membershipId,
              sha(exchanged.providerAccountId),
              this.cipher.encrypt(exchanged.refreshToken),
              this.cipher.keyVersion,
              exchanged.scopes,
              exchanged.expiresAt,
            ],
          );
          return { status: 201, body: camel(result.rows[0]), resourceId: id };
        },
      );
    } catch (error) {
      try {
        await this.providers.drive.revoke(exchanged.refreshToken);
      } catch (revokeError) {
        void revokeError;
      }
      throw error;
    }
  }
  async drivePickerToken(ctx: RequestContext) {
    const connection = await this.read(
      ctx,
      "drive.picker.token",
      "external_connection",
      async (tx) => {
        const result = await tx.query<{
          id: string;
          refresh_token_ciphertext: Buffer;
          scopes: string[];
        }>(
          "SELECT id,refresh_token_ciphertext,scopes FROM external_connections WHERE organization_id=$1 AND membership_id=$2 AND provider='google_drive' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
          [ctx.organizationId, ctx.membershipId],
        );
        if (!result.rows[0]) throw notFound("Google Driveへ接続してください");
        return result.rows[0];
      },
    );
    if (
      !connection.scopes.includes("https://www.googleapis.com/auth/drive.file")
    )
      throw new ApiProblem(
        "PROVIDER_PERMANENT",
        422,
        "Google Driveへdrive.file権限で再接続してください",
      );
    const accessToken = await this.providers.drive.refreshAccessToken(
      this.cipher.decrypt(connection.refresh_token_ciphertext),
    );
    return {
      connectionId: connection.id,
      accessToken,
      expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(),
      scope: "https://www.googleapis.com/auth/drive.file",
    };
  }
  async inspectDriveFile(ctx: RequestContext, b: Json) {
    const fileId = text(b.fileId, 1024, "fileId");
    const connectionId = text(b.connectionId, 100, "connectionId");
    const connection = await this.read(
      ctx,
      "drive.file.inspect",
      "external_connection",
      async (tx) => {
        const result = await tx.query<{ refresh_token_ciphertext: Buffer }>(
          "SELECT refresh_token_ciphertext FROM external_connections WHERE organization_id=$1 AND id=$2 AND membership_id=$3 AND provider='google_drive' AND revoked_at IS NULL",
          [ctx.organizationId, connectionId, ctx.membershipId],
        );
        if (!result.rows[0]) throw notFound("Google Driveへ再接続してください");
        return result.rows[0];
      },
    );
    const accessToken = await this.providers.drive.refreshAccessToken(
      this.cipher.decrypt(connection.refresh_token_ciphertext),
    );
    const metadata = await this.providers.drive.inspectFile({
      accessToken,
      fileId,
    });
    return {
      connectionId,
      fileId,
      fileNameRedacted: metadata.name?.slice(0, 255) ?? null,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      sourceModifiedAt: metadata.modifiedTime,
      fileVersionHash: sha(metadata.sourceVersion),
    };
  }
  async revokeDriveConnection(
    ctx: RequestContext,
    key: string | undefined,
    b: Json,
  ) {
    const claim = await this.claimProviderWrite(
      ctx,
      "drive.connection.revoke",
      key,
      b,
    );
    if (claim.cached) return claim.cached;
    let connection: { id: string; refresh_token_ciphertext: Buffer };
    try {
      connection = await this.read(
        ctx,
        "drive.connection.revoke.prepare",
        "external_connection",
        async (tx) => {
          const result = await tx.query<{
            id: string;
            refresh_token_ciphertext: Buffer;
          }>(
            "SELECT id,refresh_token_ciphertext FROM external_connections WHERE organization_id=$1 AND membership_id=$2 AND provider='google_drive' AND revoked_at IS NULL",
            [ctx.organizationId, ctx.membershipId],
          );
          if (!result.rows[0]) throw notFound("Drive接続が見つかりません");
          return result.rows[0];
        },
      );
    } catch (error) {
      await this.releaseProviderClaim(ctx, claim.id).catch(() => undefined);
      throw error;
    }
    try {
      await this.providers.drive.revoke(
        this.cipher.decrypt(connection.refresh_token_ciphertext),
      );
    } catch (error) {
      await this.releaseProviderClaim(ctx, claim.id).catch(() => undefined);
      await this.auditFailure(
        ctx,
        "drive.connection.revoke",
        "external_connection",
        error,
      );
      throw error;
    }
    return this.completeProviderWrite(
      ctx,
      claim,
      "drive.connection.revoke",
      "external_connection",
      async (tx) => {
        await tx.query(
          "UPDATE external_connections SET revoked_at=now() WHERE organization_id=$1 AND id=$2",
          [ctx.organizationId, connection.id],
        );
        return { status: 204, body: null, resourceId: connection.id };
      },
    );
  }
  async createDriveImport(
    ctx: RequestContext,
    visitId: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "drive.import.create",
      key,
      {
        connectionId: b.connectionId,
        fileVersionHash: b.fileVersionHash,
        consentId: b.consentId,
      },
      "drive.import.request",
      "drive_import",
      async (tx) => {
        await this.assertVisitMutable(tx, ctx, visitId);
        const connection = await tx.query(
          "SELECT id FROM external_connections WHERE organization_id=$1 AND id=$2 AND membership_id=$3 AND revoked_at IS NULL",
          [ctx.organizationId, String(b.connectionId), ctx.membershipId],
        );
        if (!connection.rowCount)
          throw new ApiProblem(
            "PROVIDER_PERMANENT",
            422,
            "Google Driveへ再接続してください",
          );
        await this.assertCurrentConsent(
          tx,
          ctx.organizationId,
          visitId,
          b.consentId,
        );
        const importId = randomUUID(),
          jobId = randomUUID();
        const versionHash = text(b.fileVersionHash, 64, "fileVersionHash");
        const fileId = text(b.fileId, 1024, "fileId");
        await tx.query(
          `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id) VALUES($1,$2,'drive_import','drive_import',$3,$4,$5,$6,$7)`,
          [
            jobId,
            ctx.organizationId,
            importId,
            key,
            sha(`${versionHash}:${fileId}`),
            { consentId: b.consentId },
            ctx.membershipId,
          ],
        );
        await tx.query(
          `INSERT INTO drive_imports(id,organization_id,visit_id,requested_by_membership_id,external_connection_id,drive_file_id_ciphertext,drive_file_version_hash,drive_file_name_redacted,source_modified_at,source_size_bytes,status,job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11)`,
          [
            importId,
            ctx.organizationId,
            visitId,
            ctx.membershipId,
            String(b.connectionId),
            this.cipher.encrypt(fileId),
            versionHash,
            b.fileNameRedacted ?? null,
            b.sourceModifiedAt ?? null,
            b.sourceSizeBytes ?? null,
            jobId,
          ],
        );
        await tx.query(
          `INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key) VALUES($1,'job.dispatch','job',$2,$3,$4)`,
          [
            ctx.organizationId,
            jobId,
            { job_id: jobId, job_type: "drive_import" },
            `job:${jobId}`,
          ],
        );
        return {
          status: 202,
          body: {
            jobId,
            status: "queued",
            statusUrl: `/api/v1/jobs/${jobId}`,
            requestId: ctx.requestId,
          },
          resourceId: importId,
        };
      },
    );
  }

  async createJob(
    ctx: RequestContext,
    jobType: string,
    entityType: string,
    entityId: string,
    key: string | undefined,
    input: Json,
  ) {
    let jobInput=input;
    if(jobType==="review"){
      const dimensions=requestedReviewDimensions(input.dimensions);
      const objective=input.objective===undefined?undefined:text(input.objective,500,"objective");
      jobInput={...input,dimensions,...(objective?{objective}:{})};
    }
    return this.write(
      ctx,
      `${jobType}.create`,
      key,
      jobInput,
      `${jobType}.request`,
      entityType,
      async (tx) => {
        await this.assertEntityVisitMutable(tx, ctx, entityType, entityId);
        if (jobType === "transcribe") {
          const recording = await tx.query<{ visit_id: string; consent_id: string }>(
            "SELECT visit_id,consent_id FROM recordings WHERE organization_id=$1 AND id=$2 AND status<>'deleted'",
            [ctx.organizationId, entityId],
          );
          if (!recording.rows[0]) throw notFound();
          await this.assertCurrentConsent(
            tx,
            ctx.organizationId,
            recording.rows[0].visit_id,
            recording.rows[0].consent_id,
          );
        }
        if(jobType==="review"){
          const quality=await tx.query<{status:string;flags:string[];continuation_decision:string|null}>(
            "SELECT status,flags,continuation_decision FROM transcript_quality_assessments WHERE organization_id=$1 AND transcript_id=$2",
            [ctx.organizationId,entityId],
          );
          const assessment=quality.rows[0];
          if(!assessment)throw new ApiProblem("JOB_STATE_CONFLICT",409,"音声品質の確認が完了していません");
          const requiresAcknowledgement=assessment.status==="assessment_unavailable"||assessment.flags.length>0;
          if(requiresAcknowledgement&&assessment.continuation_decision!=="continue")throw new ApiProblem(
            "JOB_STATE_CONFLICT",409,
            assessment.continuation_decision==="replace"
              ?"音声を差し替えてから振り返りを生成してください"
              :"音声品質の警告を確認してから振り返りを生成してください",
          );
        }
        const id = randomUUID();
        const inputHash = sha(JSON.stringify(jobInput));
        await tx.query(
          `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,max_attempts,requested_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            ctx.organizationId,
            jobType,
            entityType,
            entityId,
            key,
            inputHash,
            jobInput,
            jobType === "transcribe" ? 200 : 5,
            ctx.membershipId,
          ],
        );
        await tx.query(
          `INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key) VALUES($1,'job.dispatch','job',$2,$3,$4)`,
          [
            ctx.organizationId,
            id,
            { job_id: id, job_type: jobType },
            `job:${id}`,
          ],
        );
        return {
          status: 202,
          body: {
            jobId: id,
            status: "queued",
            statusUrl: `/api/v1/jobs/${id}`,
            requestId: ctx.requestId,
          },
          resourceId: id,
        };
      },
    );
  }
  async createManualTranscript(ctx:RequestContext,visitId:string,key:string|undefined,b:Json){
    const source=text(b.text,100000,"text");
    const lines=source.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,index)=>{const match=line.match(/^(査定員|お客様)\s*[:：]\s*(.+)$/);if(!match)throw invalid(`${index+1}行目は「査定員:」または「お客様:」で始めてください`);return{role:match[1]==="査定員"?("staff" as const):("customer" as const),text:match[2]!.trim()};});
    if(!lines.length)throw invalid("会話を1行以上入力してください");
    return this.write(ctx,"manual_transcript.create",key,{text:source},"transcript.manual.create","transcript",async tx=>{
      await this.assertVisitMutable(tx,ctx,visitId);
      const transcriptPolicy=await this.retentionPolicy(tx,ctx.organizationId,"transcript");
      const recordingId=randomUUID(),jobId=randomUUID(),transcriptId=randomUUID(),inputHash=sha(source);
      await tx.query(`INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,status,attempt_count,max_attempts,requested_by_membership_id,started_at,finished_at) VALUES($1,$2,'manual_transcript','visit',$3,$4,$5,$6,'succeeded',1,1,$7,now(),now())`,[jobId,ctx.organizationId,visitId,key,inputHash,{source:"manual",lineCount:lines.length},ctx.membershipId]);
      await tx.query(`INSERT INTO recordings(id,organization_id,visit_id,consent_id,storage_object_id,source_type,status,retention_until,retention_policy_id,uploaded_by_membership_id) VALUES($1,$2,$3,NULL,NULL,'manual','transcribed',now()+($4||' days')::interval,$5,$6)`,[recordingId,ctx.organizationId,visitId,transcriptPolicy.retention_days,transcriptPolicy.id,ctx.membershipId]);
      await tx.query(`INSERT INTO transcripts(id,organization_id,recording_id,job_id,version,status,provider,model_name,language_code,full_text,confirmed_by_membership_id,confirmed_at,retention_until,retention_policy_id) VALUES($1,$2,$3,$4,1,'confirmed','manual','manual','ja-JP',$5,$6,now(),now()+($7||' days')::interval,$8)`,[transcriptId,ctx.organizationId,recordingId,jobId,source,ctx.membershipId,transcriptPolicy.retention_days,transcriptPolicy.id]);
      for(const [index,line] of lines.entries())await tx.query(`INSERT INTO transcript_segments(organization_id,transcript_id,sequence_no,start_ms,end_ms,speaker_label,speaker_role,text,confidence,edited_by_membership_id,edited_at) VALUES($1,$2,$3,0,0,'manual',$4,$5,NULL,$6,now())`,[ctx.organizationId,transcriptId,index+1,line.role,line.text,ctx.membershipId]);
      await tx.query(
        `INSERT INTO transcript_quality_assessments(organization_id,transcript_id,status,model_name,flags,confidence,metrics)
         VALUES($1,$2,'evaluated','manual','{}',1,$3)`,
        [ctx.organizationId,transcriptId,{segmentCount:lines.length,chunkCount:1,maxLabelsPerChunk:2,speechOccupancyRatio:0}],
      );
      return{status:201,body:{id:transcriptId,status:"confirmed",sourceType:"manual",lineCount:lines.length,lockVersion:1},resourceId:transcriptId,replayBody:{id:transcriptId,status:"confirmed",sourceType:"manual",lineCount:lines.length,lockVersion:1}};
    });
  }
  async createPreparation(
    ctx: RequestContext,
    visitId: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "preparation.create",
      key,
      b,
      "preparation.request",
      "visit",
      async (tx) => {
        await this.assertVisitMutable(tx, ctx, visitId);
        const extraction = await tx.query(
          "SELECT 1 FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id WHERE e.organization_id=$1 AND d.visit_id=$2 AND e.status='confirmed'",
          [ctx.organizationId, visitId],
        );
        if (!extraction.rowCount)
          throw new ApiProblem(
            "JOB_STATE_CONFLICT",
            409,
            "PDF抽出結果を確認・確定してから訪問前チェックを生成してください",
          );
        const jobId = randomUUID();
        const input = { requestedVersion: b.requestedVersion ?? null };
        await tx.query(
          `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id) VALUES($1,$2,'preparation','visit',$3,$4,$5,$6,$7)`,
          [
            jobId,
            ctx.organizationId,
            visitId,
            key,
            sha(JSON.stringify(input)),
            input,
            ctx.membershipId,
          ],
        );
        await tx.query(
          `INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key) VALUES($1,'job.dispatch','job',$2,$3,$4)`,
          [
            ctx.organizationId,
            jobId,
            { job_id: jobId, job_type: "preparation" },
            `job:${jobId}`,
          ],
        );
        return {
          status: 202,
          body: {
            jobId,
            status: "queued",
            statusUrl: `/api/v1/jobs/${jobId}`,
            requestId: ctx.requestId,
          },
          resourceId: jobId,
        };
      },
    );
  }
  async getPreparation(ctx: RequestContext, visitId: string) {
    return this.read(
      ctx,
      "preparation.read",
      "visit_preparation",
      async (tx) => {
        await this.assertVisitMutable(tx, ctx, visitId);
        const result = await tx.query<any>(
          "SELECT * FROM visit_preparations WHERE organization_id=$1 AND visit_id=$2 AND status IN ('generated','confirmed') ORDER BY version DESC LIMIT 1",
          [ctx.organizationId, visitId],
        );
        if (!result.rows[0])
          throw notFound("訪問前チェックはまだ生成されていません");
        return camel(result.rows[0]);
      },
    );
  }
  async confirmPreparation(
    ctx: RequestContext,
    visitId: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "preparation.confirm",
      key,
      b,
      "preparation.confirm",
      "visit_preparation",
      async (tx) => {
        await this.assertVisitMutable(tx, ctx, visitId);
        const result = await tx.query(
          "UPDATE visit_preparations SET status='confirmed',confirmed_by_membership_id=$3,confirmed_at=now(),lock_version=lock_version+1 WHERE organization_id=$1 AND visit_id=$2 AND status='generated' AND lock_version=$4 RETURNING *",
          [
            ctx.organizationId,
            visitId,
            ctx.membershipId,
            Number(b.expectedLockVersion),
          ],
        );
        if (!result.rows[0])
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "訪問前チェックを再読み込みしてください",
          );
        return {
          status: 200,
          body: camel(result.rows[0]),
          resourceId: String(result.rows[0].id),
        };
      },
    );
  }
  async getJob(ctx: RequestContext, id: string) {
    return this.read(ctx, "job.read", "job", async (tx) => {
      const access = ctx.capabilities.includes("job:manage")
        ? this.jobAccess(ctx)
        : { organization: false, branchIds: [] as string[], self: true };
      const r = await tx.query<any>(
        `SELECT j.id,j.organization_id,j.job_type,j.entity_type,j.entity_id,j.status,j.attempt_count,j.max_attempts,j.available_at,j.started_at,j.finished_at,j.error_code,j.created_at,j.updated_at
           FROM jobs j WHERE j.organization_id=$1 AND j.id=$2 AND ($3::boolean OR j.requested_by_membership_id=$4 OR ${jobBranchExpression("j")}=ANY($5::uuid[]))`,
        [
          ctx.organizationId,
          id,
          access.organization,
          ctx.membershipId,
          access.branchIds,
        ],
      );
      const job = r.rows[0];
      if (!job) throw notFound();
      const attempts = await tx.query(
        "SELECT attempt_no,started_at,finished_at,result_status,error_code FROM job_attempts WHERE organization_id=$1 AND job_id=$2 ORDER BY attempt_no",
        [ctx.organizationId, id],
      );
      let resultResource: null | { type: string; id: string; href: string } =
        null;
      if (job.status === "succeeded") {
        const output =
          job.job_type === "pdf_extract"
            ? await tx.query<{ id: string }>(
                "SELECT id FROM document_extractions WHERE organization_id=$1 AND job_id=$2 ORDER BY version DESC LIMIT 1",
                [ctx.organizationId, id],
              )
            : job.job_type === "preparation"
              ? await tx.query<{ id: string }>(
                  "SELECT id FROM visit_preparations WHERE organization_id=$1 AND job_id=$2",
                  [ctx.organizationId, id],
                )
              : job.job_type === "transcribe"
                ? await tx.query<{ id: string }>(
                    "SELECT id FROM transcripts WHERE organization_id=$1 AND job_id=$2 ORDER BY version DESC LIMIT 1",
                    [ctx.organizationId, id],
                  )
                : job.job_type === "review"
                  ? await tx.query<{ id: string }>(
                      "SELECT id FROM reviews WHERE organization_id=$1 AND job_id=$2 ORDER BY version DESC LIMIT 1",
                      [ctx.organizationId, id],
                    )
                  : null;
        const outputId = output?.rows[0]?.id;
        if (outputId) {
          if (job.job_type === "preparation")
            resultResource = {
              type: "preparation",
              id: outputId,
              href: `/api/v1/visits/${job.entity_id}/preparation`,
            };
          else {
            const type =
              job.job_type === "pdf_extract"
                ? "extraction"
                : job.job_type === "transcribe"
                  ? "transcript"
                  : "review";
            resultResource = {
              type,
              id: outputId,
              href: `/api/v1/${type}s/${outputId}`,
            };
          }
        }
      }
      return {
        ...camel<Json>(job),
        attempts: camel(attempts.rows),
        resultResource,
      };
    });
  }

  async getExtraction(ctx: RequestContext, id: string) {
    return this.read(ctx, "extraction.read", "extraction", async (tx) => {
      const scope = this.visitAccess(ctx);
      const r = await tx.query(
        `SELECT e.* FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id JOIN visits v ON v.id=d.visit_id WHERE e.organization_id=$1 AND e.id=$2 AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))`,
        [
          ctx.organizationId,
          id,
          scope.organization,
          scope.branchIds,
          scope.self,
          ctx.membershipId,
        ],
      );
      if (!r.rows[0]) throw notFound();
      const fields = await tx.query(
            `SELECT ${fieldValueProjection} FROM visit_field_values WHERE organization_id=$1 AND document_extraction_id=$2 ORDER BY field_key`,
        [ctx.organizationId, id],
      );
      return { ...camel<Json>(r.rows[0]), fields: camel(fields.rows) };
    });
  }
  async updateExtraction(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "extraction.update",
      key,
      b,
      "extraction.correct",
      "extraction",
      async (tx) => {
        await this.assertEntityVisitMutable(tx, ctx, "extraction", id);
        const current = await tx.query<any>(
          "SELECT e.*,fs.json_schema FROM document_extractions e JOIN form_schema_versions fs ON fs.id=e.form_schema_version_id WHERE e.organization_id=$1 AND e.id=$2 FOR UPDATE OF e",
          [ctx.organizationId, id],
        );
        const extraction = current.rows[0];
        if (!extraction) throw notFound();
        if (Number(b.expectedLockVersion) !== Number(extraction.lock_version))
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "抽出結果が更新されています",
          );
        const fields = Array.isArray(b.fields) ? (b.fields as Json[]) : [];
        const properties=formProperties(extraction.json_schema);
        for (const field of fields) {
          const fieldKey=text(field.fieldKey,150,"fieldKey");
          const property=properties[fieldKey];
          if(!property)throw invalid("帳票に定義されていない項目です",[{field:"fieldKey",message:fieldKey}]);
          const type = String(field.valueType ?? "text");
          if(type!==formValueType(property))throw invalid("項目の型を確認してください",[{field:fieldKey,message:`${formValueType(property)}型が必要です`}]);
          const values = [null, null, null, null, null] as unknown[];
          const index = { text: 0, number: 1, date: 2, boolean: 3, json: 4 }[
            type
          ];
          if (index === undefined) throw invalid("項目の型を確認してください");
          values[index] = normalizedFormCorrection(property,field.value,fieldKey);
          await tx.query(
            `INSERT INTO visit_field_values(organization_id,document_extraction_id,field_key,value_type,text_value,number_value,date_value,boolean_value,json_value,verification_status,verified_by_membership_id,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'corrected',$10,now()) ON CONFLICT(document_extraction_id,field_key) DO UPDATE SET value_type=EXCLUDED.value_type,text_value=EXCLUDED.text_value,number_value=EXCLUDED.number_value,date_value=EXCLUDED.date_value,boolean_value=EXCLUDED.boolean_value,json_value=EXCLUDED.json_value,verification_status='corrected',verified_by_membership_id=$10,verified_at=now()`,
            [
              ctx.organizationId,
              id,
              fieldKey,
              type,
              ...values,
              ctx.membershipId,
            ],
          );
        }
        const updated = await tx.query(
          "UPDATE document_extractions SET status='editing',lock_version=lock_version+1 WHERE id=$1 RETURNING *",
          [id],
        );
        return { status: 200, body: camel(updated.rows[0]), resourceId: id };
      },
    );
  }
  async confirmExtraction(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "extraction.confirm",
      key,
      b,
      "extraction.confirm",
      "extraction",
      async (tx) => {
        await this.assertEntityVisitMutable(tx, ctx, "extraction", id);
        const r = await tx.query<any>(
          "UPDATE document_extractions SET status='confirmed',confirmed_by_membership_id=$3,confirmed_at=now(),lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2 AND lock_version=$4 AND status IN ('generated','editing') RETURNING *",
          [
            ctx.organizationId,
            id,
            ctx.membershipId,
            Number(b.expectedLockVersion),
          ],
        );
        const extraction = r.rows[0];
        if (!extraction)
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "抽出結果を再読み込みしてください",
          );
        const schemaResult=await tx.query<{json_schema:Json}>("SELECT fs.json_schema FROM form_schema_versions fs WHERE fs.id=$1",[extraction.form_schema_version_id]);
        const required=formRequired(schemaResult.rows[0]?.json_schema);
        const available=await tx.query<{field_key:string}>("SELECT field_key FROM visit_field_values WHERE organization_id=$1 AND document_extraction_id=$2 AND verification_status<>'rejected' AND CASE value_type WHEN 'text' THEN btrim(COALESCE(text_value,''))<>'' WHEN 'number' THEN number_value IS NOT NULL WHEN 'date' THEN date_value IS NOT NULL WHEN 'boolean' THEN boolean_value IS NOT NULL WHEN 'json' THEN json_value IS NOT NULL ELSE false END",[ctx.organizationId,id]);
        const availableKeys=new Set(available.rows.map(row=>row.field_key));
        const missing=required.filter(field=>!availableKeys.has(field));
        if(missing.length)throw invalid("必須項目を原本で確認してください",missing.map(field=>({field,message:"値が必要です"})));
        await tx.query(
          "UPDATE visit_field_values SET verification_status='confirmed',verified_by_membership_id=$3,verified_at=now() WHERE organization_id=$1 AND document_extraction_id=$2 AND verification_status='unverified'",
          [ctx.organizationId, id, ctx.membershipId],
        );
        const values = await tx.query<{
          field_key: string;
          value: string | null;
        }>(
          `SELECT field_key,COALESCE(text_value,date_value::text,number_value::text,boolean_value::text,json_value::text) value FROM visit_field_values WHERE organization_id=$1 AND document_extraction_id=$2`,
          [ctx.organizationId, id],
        );
        const extracted = Object.fromEntries(
          values.rows.map((row) => [row.field_key, row.value]),
        );
        const visitDate=extracted.visitDate;
        const visitTime=extracted.visitTime;
        const scheduledAt = visitDate && visitTime
          ? `${visitDate}T${visitTime}:00+09:00`
          : null;
        const customerCandidate =
          extracted.customerLabel ?? extracted.customerName;
        const customerLabel =
          typeof customerCandidate === "string" && customerCandidate.trim()
            ? customerCandidate.trim().slice(0, 200)
            : null;
        const notes=typeof extracted.notes==="string"&&extracted.notes.trim()?extracted.notes.trim().slice(0,4000):null;
        await tx.query(
          `UPDATE visits v SET scheduled_local_date=$3::date,scheduled_local_time=$4::time(0),scheduled_timezone='Asia/Tokyo',scheduled_at=$5::timestamptz,customer_label=COALESCE($6,v.customer_label),notes_redacted=COALESCE($7,v.notes_redacted),lock_version=v.lock_version+1 FROM visit_documents d WHERE d.id=$2 AND d.visit_id=v.id AND v.organization_id=$1`,
          [
            ctx.organizationId,
            extraction.visit_document_id,
            visitDate,
            visitTime || null,
            scheduledAt,
            customerLabel,
            notes,
          ],
        );
        return { status: 200, body: camel(extraction), resourceId: id };
      },
    );
  }

  async getTranscript(ctx: RequestContext, id: string) {
    return this.read(ctx, "transcript.read", "transcript", async (tx) => {
      const scope = this.visitAccess(ctx);
      const r = await tx.query(
        `SELECT t.* FROM transcripts t JOIN recordings r ON r.id=t.recording_id JOIN visits v ON v.id=r.visit_id WHERE t.organization_id=$1 AND t.id=$2 AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))`,
        [
          ctx.organizationId,
          id,
          scope.organization,
          scope.branchIds,
          scope.self,
          ctx.membershipId,
        ],
      );
      if (!r.rows[0]) throw notFound();
      if (r.rows[0].status === "deleted")
        throw new ApiProblem("RESOURCE_GONE", 410, "文字起こしは削除済みです");
      const segments = await tx.query(
        "SELECT * FROM transcript_segments WHERE organization_id=$1 AND transcript_id=$2 ORDER BY sequence_no",
        [ctx.organizationId, id],
      );
      const quality=await tx.query(
        `SELECT qa.*,COALESCE(array_agg(qe.transcript_segment_id::text) FILTER(WHERE qe.id IS NOT NULL),'{}') evidence_segment_ids
           FROM transcript_quality_assessments qa
           LEFT JOIN transcript_quality_evidence qe ON qe.assessment_id=qa.id AND qe.organization_id=qa.organization_id
          WHERE qa.organization_id=$1 AND qa.transcript_id=$2 GROUP BY qa.id`,
        [ctx.organizationId,id],
      );
      return { ...camel<Json>(r.rows[0]), segments: camel(segments.rows),qualityAssessment:camel(quality.rows[0]??null) };
    });
  }

  async acknowledgeTranscriptQuality(ctx:RequestContext,id:string,key:string|undefined,b:Json){
    const decision=String(b.decision??"");
    if(decision!=="continue"&&decision!=="replace")throw invalid("音声品質の確認結果を選択してください");
    return this.write(ctx,"transcript.quality.ack",key,b,"transcript.quality.ack","transcript",async tx=>{
      await this.assertEntityVisitMutable(tx,ctx,"transcript",id);
      const result=await tx.query(
        `UPDATE transcript_quality_assessments SET continuation_decision=$3,acknowledged_by_membership_id=$4,
           acknowledged_at=now(),lock_version=lock_version+1,updated_at=now()
         WHERE organization_id=$1 AND transcript_id=$2 AND lock_version=$5
           AND (status='assessment_unavailable' OR cardinality(flags)>0)
         RETURNING *`,
        [ctx.organizationId,id,decision,ctx.membershipId,Number(b.lockVersion)],
      );
      if(!result.rows[0])throw new ApiProblem("VERSION_CONFLICT",409,"音声品質の判定結果を再読み込みしてください");
      return{status:200,body:camel(result.rows[0]),resourceId:id,auditMetadata:{decision}};
    });
  }
  async updateTranscript(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "transcript.update",
      key,
      b,
      "transcript.edit",
      "transcript",
      async (tx) => {
        await this.assertEntityVisitMutable(tx, ctx, "transcript", id);
        const locked = await tx.query<any>(
          "SELECT * FROM transcripts WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [ctx.organizationId, id],
        );
        const current = locked.rows[0];
        if (!current) throw notFound();
        if (Number(current.lock_version) !== Number(b.expectedLockVersion))
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "文字起こしが更新されています",
          );
        const edits = Array.isArray(b.segments) ? (b.segments as Json[]) : [];
        for (const edit of edits) {
          const segmentId = String(edit.id ?? "");
          const editedText =
            edit.text === undefined ? null : text(edit.text, 5000, "text");
          const speakerRole =
            edit.speakerRole === undefined ? null : String(edit.speakerRole);
          if (
            speakerRole !== null &&
            !["staff", "customer", "unknown"].includes(speakerRole)
          )
            throw invalid("話者を確認してください");
          const updated = await tx.query(
            "UPDATE transcript_segments SET edited_text=COALESCE($3,edited_text),speaker_role=COALESCE($4,speaker_role),edited_by_membership_id=$5,edited_at=now() WHERE organization_id=$1 AND id=$2 AND transcript_id=$6",
            [
              ctx.organizationId,
              segmentId,
              editedText,
              speakerRole,
              ctx.membershipId,
              id,
            ],
          );
          if (!updated.rowCount) throw invalid("発話区間を確認してください");
        }
        await tx.query(
          "UPDATE transcripts SET status='editing',full_text=(SELECT string_agg(COALESCE(edited_text,text),E'\\n' ORDER BY sequence_no) FROM transcript_segments WHERE transcript_id=$1),lock_version=lock_version+1 WHERE id=$1",
          [id],
        );
        const out = await tx.query("SELECT * FROM transcripts WHERE id=$1", [
          id,
        ]);
        return { status: 200, body: camel(out.rows[0]), resourceId: id };
      },
    );
  }
  async confirmTranscript(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "transcript.confirm",
      key,
      b,
      "transcript.confirm",
      "transcript",
      async (tx) => {
        await this.assertEntityVisitMutable(tx, ctx, "transcript", id);
        const unresolved = await tx.query<{ count: number }>(
          "SELECT count(*)::int count FROM transcript_segments WHERE organization_id=$1 AND transcript_id=$2 AND speaker_role='unknown'",
          [ctx.organizationId, id],
        );
        if ((unresolved.rows[0]?.count ?? 0) > 0)
          throw invalid(
            "すべての発話をスタッフまたはお客様に確認してから確定してください",
            [{ field: "segments", message: "話者未確認の発話があります" }],
          );
        const r = await tx.query(
          "UPDATE transcripts SET status='confirmed',confirmed_by_membership_id=$3,confirmed_at=now(),lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2 AND lock_version=$4 AND status IN ('generated','editing') RETURNING *",
          [
            ctx.organizationId,
            id,
            ctx.membershipId,
            Number(b.expectedLockVersion),
          ],
        );
        if (!r.rows[0])
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "文字起こしを再読み込みしてください",
          );
        return { status: 200, body: camel(r.rows[0]), resourceId: id };
      },
    );
  }

  async getReview(ctx: RequestContext, id: string) {
    return this.read(ctx, "review.read", "review", async (tx) => {
      const scope = this.visitAccess(ctx);
      const r = await tx.query(
        `SELECT rv.* FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings rec ON rec.id=t.recording_id JOIN visits v ON v.id=rec.visit_id WHERE rv.organization_id=$1 AND rv.id=$2 AND ($3::boolean OR v.branch_id=ANY($4::uuid[]) OR ($5::boolean AND v.assigned_membership_id=$6))`,
        [
          ctx.organizationId,
          id,
          scope.organization,
          scope.branchIds,
          scope.self,
          ctx.membershipId,
        ],
      );
      if (!r.rows[0]) throw notFound();
      if (r.rows[0].status === "deleted")
        throw new ApiProblem(
          "RESOURCE_GONE",
          410,
          "振り返りは保存期間満了により削除されました",
        );
      const findings = await tx.query(
        `SELECT f.*,COALESCE(json_agg(json_build_object('segmentId',e.transcript_segment_id,'excerpt',e.excerpt,'startMs',e.start_ms,'endMs',e.end_ms)) FILTER(WHERE e.id IS NOT NULL),'[]') evidence FROM review_findings f LEFT JOIN review_evidence e ON e.review_finding_id=f.id WHERE f.organization_id=$1 AND f.review_id=$2 GROUP BY f.id ORDER BY f.sequence_no`,
        [ctx.organizationId, id],
      );
      return { ...camel<Json>(r.rows[0]),analysisDimensions:reviewAnalysisDimensions(r.rows[0]), findings: camel(findings.rows) };
    });
  }
  async acknowledgeReview(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    return this.write(
      ctx,
      "review.ack",
      key,
      b,
      "review.ack",
      "review",
      async (tx) => {
        await this.assertEntityVisitMutable(tx, ctx, "review", id);
        const r = await tx.query(
          "UPDATE reviews SET status='acknowledged',acknowledged_by_membership_id=$3,acknowledged_at=now(),lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2 AND lock_version=$4 AND status='generated' RETURNING *",
          [
            ctx.organizationId,
            id,
            ctx.membershipId,
            Number(b.expectedLockVersion),
          ],
        );
        if (!r.rows[0])
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "振り返り結果を再読み込みしてください",
          );
        return { status: 200, body: camel(r.rows[0]), resourceId: id };
      },
    );
  }
  async history(ctx: RequestContext) {
    return this.read(ctx, "history.read", "review", async (tx) => {
      const scope = this.visitAccess(ctx);
      const r = await tx.query(
        `SELECT rv.id review_id,rv.status review_status,rv.summary,rv.created_at,v.id visit_id,v.case_number,v.scheduled_at FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings rec ON rec.id=t.recording_id JOIN visits v ON v.id=rec.visit_id WHERE rv.organization_id=$1 AND v.deleted_at IS NULL AND rv.status<>'deleted' AND ($2::boolean OR v.branch_id=ANY($3::uuid[]) OR ($4::boolean AND v.assigned_membership_id=$5)) ORDER BY rv.created_at DESC LIMIT 100`,
        [
          ctx.organizationId,
          scope.organization,
          scope.branchIds,
          scope.self,
          ctx.membershipId,
        ],
      );
      return { items: camel(r.rows), nextCursor: null, hasMore: false };
    });
  }

  async listContents(ctx: RequestContext, q: Json) {
    requireCap(ctx, "content:read");
    return this.read(ctx, "content.search", "content", async (tx) => {
      const canWrite = this.hasOrganizationCapability(ctx, "content:write");
      const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
      const values: unknown[] = [ctx.organizationId];
      let where = "c.organization_id=$1 AND c.deleted_at IS NULL";
      if (q.type) {
        const types = String(q.type)
          .split(",")
          .filter((t) => (contentTypes as readonly string[]).includes(t));
        values.push(types);
        where += ` AND c.content_type=ANY($${values.length}::text[])`;
      }
      if (q.query) {
        values.push(String(q.query));
        where += ` AND (vm.search_text ILIKE '%'||$${values.length}||'%' OR vm.title % $${values.length})`;
      }
      if (!canWrite)
        where += " AND c.availability_state IN ('pilot','published')";
      const totalResult = await tx.query(
        `SELECT count(*)::int total_count FROM content_items c JOIN content_versions cv ON cv.id=${canWrite ? "c.current_version_id" : "CASE c.availability_state WHEN 'pilot' THEN c.current_version_id WHEN 'published' THEN c.published_version_id END"} JOIN content_version_metadata vm ON vm.content_version_id=cv.id WHERE ${where}`,
        values,
      );
      if (q.cursor) {
        const cursor = String(q.cursor);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor))
          throw invalid("ページ位置を確認してください", [
            { field: "cursor", message: "有効なページ位置ではありません" },
          ]);
        values.push(cursor);
        where += ` AND (c.display_order,c.id)>(SELECT anchor.display_order,anchor.id FROM content_items anchor WHERE anchor.organization_id=$1 AND anchor.id=$${values.length}::uuid AND anchor.deleted_at IS NULL)`;
      }
      values.push(limit + 1);
      const pointer = canWrite
        ? "c.current_version_id"
        : "CASE c.availability_state WHEN 'pilot' THEN c.current_version_id WHEN 'published' THEN c.published_version_id END";
      const r = await tx.query(
        `SELECT c.id,c.content_type type,c.stable_key,vm.title,vm.category,c.status,c.availability_state,c.display_order,cv.version,cv.body_json,cv.review_status,cv.migration_state,(cv.review_status<>'approved' OR cv.migration_state IN ('extracted_needs_review','blocked')) requires_review,(c.availability_state='published' AND c.published_version_id=cv.id AND cv.review_status='approved' AND cv.published_at IS NOT NULL AND cv.migration_state NOT IN ('extracted_needs_review','blocked')) ai_eligible,count(*) OVER()::int total_count FROM content_items c JOIN content_versions cv ON cv.id=${pointer} JOIN content_version_metadata vm ON vm.content_version_id=cv.id WHERE ${where} ORDER BY c.display_order,c.id LIMIT $${values.length}`,
        values,
      );
      const total = Number(totalResult.rows[0]?.total_count ?? 0);
      const items = r.rows.slice(0, limit).map((source: any) => {
        const row = { ...source };
        delete row.total_count;
        return row;
      });
      return {
        items: camel(items),
        total,
        nextCursor:
          r.rows.length > limit ? String(r.rows[limit - 1]?.id) : null,
        hasMore: r.rows.length > limit,
      };
    });
  }
  async getContent(ctx: RequestContext, id: string) {
    requireCap(ctx, "content:read");
    return this.read(ctx, "content.read", "content", async (tx) => {
      const canWrite = this.hasOrganizationCapability(ctx, "content:write");
      const pointer = canWrite
        ? "c.current_version_id"
        : "CASE c.availability_state WHEN 'pilot' THEN c.current_version_id WHEN 'published' THEN c.published_version_id END";
      const r = await tx.query(
        `SELECT c.id,c.content_type type,c.stable_key,vm.title,vm.category,c.status,c.availability_state,c.display_order,cv.id version_id,cv.version,cv.body_json,cv.source_type,cv.source_reference,cv.source_hash,cv.review_status,cv.migration_state,(cv.review_status<>'approved' OR cv.migration_state IN ('extracted_needs_review','blocked')) requires_review,(c.availability_state='published' AND c.published_version_id=cv.id AND cv.review_status='approved' AND cv.published_at IS NOT NULL AND cv.migration_state NOT IN ('extracted_needs_review','blocked')) ai_eligible FROM content_items c JOIN content_versions cv ON cv.id=${pointer} JOIN content_version_metadata vm ON vm.content_version_id=cv.id WHERE c.organization_id=$1 AND (c.id::text=$2 OR c.stable_key=$2) AND c.deleted_at IS NULL AND ($3::boolean OR c.availability_state IN ('pilot','published'))`,
        [ctx.organizationId, id, canWrite],
      );
      if (!r.rows[0]) throw notFound();
      return camel(r.rows[0]);
    });
  }
  async createContent(ctx: RequestContext, key: string | undefined, b: Json) {
    this.requireOrganizationCapability(ctx, "content:write");
    return this.write(
      ctx,
      "content.create",
      key,
      b,
      "content.create",
      "content",
      async (tx) => {
        const type = String(b.type);
        if (!(contentTypes as readonly string[]).includes(type))
          throw invalid("コンテンツ種別を確認してください");
        const id = randomUUID(),
          versionId = randomUUID();
        const stable = text(b.stableKey, 150, "stableKey"),
          title = text(b.title, 300, "title"),
          category = String(b.category ?? "").slice(0, 200);
        const body =
          typeof b.body === "object" && b.body
            ? b.body
            : { body: String(b.body ?? "") };
        const sourceHash = sha(JSON.stringify(body));
        const searchText = `${title} ${category} ${JSON.stringify(body)}`;
        try {
          await tx.query(
            "INSERT INTO content_items(id,organization_id,content_type,stable_key,title,category,status,search_text) VALUES($1,$2,$3,$4,$5,$6,'draft',$7)",
            [id, ctx.organizationId, type, stable, title, category, searchText],
          );
          await tx.query(
            "INSERT INTO content_versions(id,organization_id,content_item_id,version,body_json,source_type,source_hash,review_status,created_by_membership_id) VALUES($1,$2,$3,1,$4,'manual',$5,'draft',$6)",
            [
              versionId,
              ctx.organizationId,
              id,
              body,
              sourceHash,
              ctx.membershipId,
            ],
          );
          await tx.query(
            "INSERT INTO content_version_metadata(content_version_id,organization_id,content_item_id,title,category,search_text) VALUES($1,$2,$3,$4,$5,$6)",
            [versionId, ctx.organizationId, id, title, category, searchText],
          );
          await tx.query(
            "UPDATE content_items SET current_version_id=$1 WHERE id=$2",
            [versionId, id],
          );
        } catch (error: any) {
          if (error?.code === "23505")
            throw new ApiProblem(
              "VERSION_CONFLICT",
              409,
              "同じ識別子のコンテンツがあります",
            );
          throw error;
        }
        return {
          status: 201,
          body: { id, versionId, version: 1, status: "draft" },
          resourceId: id,
        };
      },
    );
  }
  async updateContent(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    this.requireOrganizationCapability(ctx, "content:write");
    return this.write(
      ctx,
      "content.update",
      key,
      b,
      "content.version.create",
      "content",
      async (tx) => {
        const current = await tx.query<any>(
          "SELECT c.*,cv.version,vm.title working_title,vm.category working_category FROM content_items c JOIN content_versions cv ON cv.id=c.current_version_id JOIN content_version_metadata vm ON vm.content_version_id=cv.id WHERE c.organization_id=$1 AND c.id=$2 FOR UPDATE OF c",
          [ctx.organizationId, id],
        );
        const item = current.rows[0];
        if (!item) throw notFound();
        if (Number(b.expectedVersion) !== Number(item.version))
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "別の版が作成されています",
          );
        const version = Number(item.version) + 1,
          versionId = randomUUID();
        const body =
          typeof b.body === "object" && b.body
            ? b.body
            : { body: String(b.body ?? "") };
        const title =
          b.title === undefined
            ? String(item.working_title)
            : text(b.title, 300, "title");
        const category =
          b.category === undefined
            ? String(item.working_category)
            : String(b.category).slice(0, 200);
        const searchText = `${title} ${category} ${JSON.stringify(body)}`;
        await tx.query(
          "INSERT INTO content_versions(id,organization_id,content_item_id,version,body_json,source_type,source_hash,review_status,change_summary,created_by_membership_id) VALUES($1,$2,$3,$4,$5,'manual',$6,'draft',$7,$8)",
          [
            versionId,
            ctx.organizationId,
            id,
            version,
            body,
            sha(JSON.stringify(body)),
            b.changeSummary ?? null,
            ctx.membershipId,
          ],
        );
        await tx.query(
          "INSERT INTO content_version_metadata(content_version_id,organization_id,content_item_id,title,category,search_text) VALUES($1,$2,$3,$4,$5,$6)",
          [versionId, ctx.organizationId, id, title, category, searchText],
        );
        await tx.query(
          "UPDATE content_items SET current_version_id=$1,status=CASE WHEN published_version_id IS NULL THEN 'draft' ELSE status END WHERE id=$2",
          [versionId, id],
        );
        return {
          status: 201,
          body: { id, versionId, version, status: "draft" },
          resourceId: id,
        };
      },
    );
  }
  async publishContent(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    const canWrite = this.hasOrganizationCapability(ctx, "content:write");
    const canApprove = this.hasOrganizationCapability(ctx, "content:approve");
    if (!canWrite && !canApprove) throw denied();
    return this.write(
      ctx,
      "content.publish",
      key,
      b,
      "content.publish",
      "content",
      async (tx) => {
        const flags = await this.flags(tx, ctx.organizationId);
        const version = integer(b.version, 1, 1_000_000, "version");
        const current = await tx.query<{
          id: string;
          review_status: string;
          migration_state: string;
          title: string;
          category: string;
          search_text: string;
        }>(
          `SELECT cv.id,cv.review_status,cv.migration_state,vm.title,vm.category,vm.search_text FROM content_versions cv JOIN content_items c ON c.id=cv.content_item_id JOIN content_version_metadata vm ON vm.content_version_id=cv.id WHERE c.organization_id=$1 AND c.id=$2 AND cv.version=$3 AND cv.published_at IS NULL FOR UPDATE OF cv`,
          [ctx.organizationId, id, version],
        );
        const target = current.rows[0];
        if (!target)
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "公開対象の版を確認してください",
          );
        const approvalRequired =
          Boolean(flags.content_approval) ||
          target.migration_state === "extracted_needs_review";
        if (approvalRequired && target.review_status !== "approved") {
          if (target.review_status === "in_review")
            throw new ApiProblem(
              "VERSION_CONFLICT",
              409,
              "この版は承認待ちです",
            );
          if (!canWrite)
            throw denied("承認対象の提出は編集担当者が行ってください");
          await tx.query(
            "UPDATE content_versions SET review_status='in_review' WHERE id=$1",
            [target.id],
          );
          return {
            status: 202,
            body: { id, version, status: "in_review" },
            resourceId: id,
          };
        }
        const r = await tx.query(
          `UPDATE content_versions SET review_status='approved',approved_by_membership_id=COALESCE(approved_by_membership_id,$2),approved_at=COALESCE(approved_at,now()),published_at=now() WHERE id=$1 RETURNING id`,
          [target.id, ctx.membershipId],
        );
        await tx.query(
          "UPDATE content_items SET current_version_id=$1,published_version_id=$1,title=$3,category=$4,search_text=$5,status='published',availability_state='published' WHERE id=$2",
          [
            r.rows[0]?.id,
            id,
            target.title,
            target.category,
            target.search_text,
          ],
        );
        return {
          status: 200,
          body: { id, version, status: "published" },
          resourceId: id,
        };
      },
    );
  }
  async learningProgress(
    ctx: RequestContext,
    contentId: string,
    key: string | undefined,
    b: Json,
  ) {
    if ("score" in b || "rank" in b) throw invalid("点数や順位は保存しません");
    return this.write(
      ctx,
      "learning.progress",
      key,
      b,
      "learning.update",
      "learning_progress",
      async (tx) => {
        const status = String(b.status);
        if (!["not_started", "in_progress", "completed"].includes(status))
          throw invalid("進捗状態を確認してください");
        const r = await tx.query(
          `INSERT INTO learning_progress(organization_id,membership_id,content_item_id,status,started_at,completed_at,self_note) VALUES($1,$2,$3,$4,CASE WHEN $4<>'not_started' THEN now() END,CASE WHEN $4='completed' THEN now() END,$5) ON CONFLICT(organization_id,membership_id,content_item_id) DO UPDATE SET status=$4,started_at=COALESCE(learning_progress.started_at,CASE WHEN $4<>'not_started' THEN now() END),completed_at=CASE WHEN $4='completed' THEN now() END,self_note=$5 RETURNING *`,
          [
            ctx.organizationId,
            ctx.membershipId,
            contentId,
            status,
            b.selfNote ?? null,
          ],
        );
        return {
          status: 200,
          body: camel(r.rows[0]),
          resourceId: String(r.rows[0]?.id),
        };
      },
    );
  }
  async roleplayTurn(ctx: RequestContext, b: Json, key: string | undefined) {
    requireCap(ctx, "content:read");
    if ("score" in b || "rank" in b) throw invalid("点数や順位は扱いません");
    const supplied = Array.isArray(b.messages) ? (b.messages as Json[]) : [];
    if (!supplied.length || supplied.length > 20)
      throw invalid("会話履歴を確認してください");
    const latest = [...supplied]
      .reverse()
      .find((message) => message.role === "staff");
    const staffText = text(latest?.text, 2000, "message");
    const scenarioKey = text(b.scenarioId, 200, "scenarioId");
    const requestedSessionId =
      typeof b.sessionId === "string" ? b.sessionId : null;
    const prepared = await this.read(
      ctx,
      "training.roleplay.prepare",
      "content",
      async (tx) => {
        const pilotEnabled = Boolean(
          (await this.flags(tx, ctx.organizationId)).pilot_content_ai,
        );
        const content = await tx.query<{
          id: string;
          title: string;
          body_json: any;
          availability_state: "pilot" | "published";
          version_id:string;
        }>(
          `SELECT c.id,vm.title,cv.body_json,c.availability_state,cv.id version_id
             FROM content_items c
             JOIN content_versions cv ON cv.id=CASE
               WHEN c.availability_state='published' THEN c.published_version_id
               WHEN $3::boolean AND c.availability_state='pilot' THEN c.current_version_id
             END
             JOIN content_version_metadata vm ON vm.content_version_id=cv.id
            WHERE c.organization_id=$1 AND c.deleted_at IS NULL
              AND (c.id::text=$2 OR c.stable_key=$2)
              AND c.content_type='roleplay'
              AND (
                (c.status='published' AND c.availability_state='published' AND cv.review_status='approved' AND cv.published_at IS NOT NULL AND cv.migration_state NOT IN ('extracted_needs_review','blocked'))
                OR ($3::boolean AND c.status='draft' AND c.availability_state='pilot' AND cv.review_status='draft' AND cv.migration_state='extracted_needs_review' AND cv.published_at IS NULL)
              )`,
          [ctx.organizationId, scenarioKey, pilotEnabled],
        );
        const scenario = content.rows[0];
        if (!scenario) throw notFound();
        let history: Array<{ role: "staff" | "customer"; text: string }> = [];
        if (requestedSessionId) {
          const session = await tx.query(
            "SELECT 1 FROM roleplay_sessions WHERE organization_id=$1 AND id=$2 AND membership_id=$3 AND scenario_content_item_id=$4 AND status='active'",
            [
              ctx.organizationId,
              requestedSessionId,
              ctx.membershipId,
              scenario.id,
            ],
          );
          if (!session.rowCount)
            throw new ApiProblem(
              "JOB_STATE_CONFLICT",
              409,
              "ロールプレイを再開できません。新しく開始してください",
            );
          const turns = await tx.query<{
            staff_text: string;
            customer_reply: string;
          }>(
            "SELECT staff_text,customer_reply FROM roleplay_turns WHERE organization_id=$1 AND session_id=$2 ORDER BY sequence_no",
            [ctx.organizationId, requestedSessionId],
          );
          history = turns.rows.flatMap((turn) => [
            { role: "staff" as const, text: turn.staff_text },
            { role: "customer" as const, text: turn.customer_reply },
          ]);
        }
        return {
          id: String(scenario.id),
          title: String(scenario.title),
          profile: String(
            scenario.body_json?.legacyPayload?.customerProfile ??
              scenario.body_json?.body ??
              "",
          ).slice(0, 4000),
          history,
          pilotEnabled,
          usesPilot: scenario.availability_state === "pilot",
          versionId:scenario.version_id,
        };
      },
    );
    const claim = await this.claimProviderWrite(
      ctx,
      "training.roleplay.turn",
      key,
      b,
    );
    if (claim.cached) return claim.cached;
    const messages = [
      ...prepared.history,
      { role: "staff" as const, text: staffText },
    ];
    let generated: Awaited<ReturnType<AiProvider["roleplay"]>>;
    try {
      generated = await this.providers.ai.roleplay({
        scenarioTitle: prepared.title,
        customerProfile: prepared.profile,
        messages,
      });
    } catch (error) {
      await this.releaseProviderClaim(ctx, claim.id);
      await this.auditFailure(
        ctx,
        "training.roleplay.turn",
        "roleplay_session",
        error,
      );
      throw error;
    }
    if (
      generated.feedback.some((item) =>
        /\b(score|rank|rating|人事評価|順位)\b/i.test(
          `${item.category} ${item.message}`,
        ),
      )
    ) {
      const error = new Error(
        "PROVIDER_PERMANENT: prohibited roleplay evaluation output",
      );
      await this.releaseProviderClaim(ctx, claim.id);
      await this.auditFailure(
        ctx,
        "training.roleplay.turn",
        "roleplay_session",
        error,
      );
      throw error;
    }
    return this.completeProviderWrite(
      ctx,
      claim,
      "training.roleplay.turn",
      "roleplay_session",
      async (tx) => {
        const sessionId = requestedSessionId ?? randomUUID();
        if (requestedSessionId) {
          const locked = await tx.query(
            "SELECT 1 FROM roleplay_sessions WHERE organization_id=$1 AND id=$2 AND membership_id=$3 AND status='active' FOR UPDATE",
            [ctx.organizationId, sessionId, ctx.membershipId],
          );
          if (!locked.rowCount)
            throw new ApiProblem(
              "JOB_STATE_CONFLICT",
              409,
              "ロールプレイの状態が更新されました",
            );
        } else
          await tx.query(
            "INSERT INTO roleplay_sessions(id,organization_id,membership_id,scenario_content_item_id,status) VALUES($1,$2,$3,$4,'active')",
            [sessionId, ctx.organizationId, ctx.membershipId, prepared.id],
          );
        const sequence = await tx.query<{ sequence_no: number }>(
          "SELECT COALESCE(max(sequence_no),0)+1 sequence_no FROM roleplay_turns WHERE session_id=$1",
          [sessionId],
        );
        const sequenceNo = sequence.rows[0]?.sequence_no ?? 1;
        const turnId = randomUUID();
        await tx.query(
          "INSERT INTO roleplay_turns(id,organization_id,session_id,sequence_no,staff_text,customer_reply,feedback,model_name,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
          [
            turnId,
            ctx.organizationId,
            sessionId,
            sequenceNo,
            staffText,
            generated.customerReply,
            JSON.stringify(generated.feedback),
            generated.model,
            sha(JSON.stringify(messages)),
          ],
        );
        return {
          status: 201,
          body: {
            sessionId,
            turnId,
            sequenceNo,
            customerReply: generated.customerReply,
            feedback: generated.feedback,
            model: generated.model,
            stored: true,
            contentPolicy: contentPolicy(
              prepared.pilotEnabled,
              prepared.usesPilot,
              [{id:prepared.id,versionId:prepared.versionId}],
            ),
          },
          resourceId: turnId,
        };
      },
    );
  }
  async listRoleplaySessions(ctx: RequestContext) {
    requireCap(ctx, "content:read");
    return this.read(
      ctx,
      "training.roleplay.history",
      "roleplay_session",
      async (tx) => {
        const result = await tx.query(
          `SELECT s.id,s.status,s.started_at,s.completed_at,s.self_note,c.id scenario_id,c.title,count(t.id)::int turn_count FROM roleplay_sessions s JOIN content_items c ON c.id=s.scenario_content_item_id LEFT JOIN roleplay_turns t ON t.session_id=s.id WHERE s.organization_id=$1 AND s.membership_id=$2 GROUP BY s.id,c.id ORDER BY s.started_at DESC LIMIT 100`,
          [ctx.organizationId, ctx.membershipId],
        );
        return { items: camel(result.rows), nextCursor: null, hasMore: false };
      },
    );
  }
  async getRoleplaySession(ctx: RequestContext, id: string) {
    requireCap(ctx, "content:read");
    return this.read(
      ctx,
      "training.roleplay.session.read",
      "roleplay_session",
      async (tx) => {
        const session = await tx.query(
          "SELECT s.*,c.title scenario_title FROM roleplay_sessions s JOIN content_items c ON c.id=s.scenario_content_item_id WHERE s.organization_id=$1 AND s.id=$2 AND s.membership_id=$3",
          [ctx.organizationId, id, ctx.membershipId],
        );
        if (!session.rows[0]) throw notFound();
        const turns = await tx.query(
          "SELECT id,sequence_no,staff_text,customer_reply,feedback,model_name,created_at FROM roleplay_turns WHERE organization_id=$1 AND session_id=$2 ORDER BY sequence_no",
          [ctx.organizationId, id],
        );
        return { ...camel<Json>(session.rows[0]), turns: camel(turns.rows) };
      },
    );
  }
  async completeRoleplaySession(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    requireCap(ctx, "content:read");
    if ("score" in b || "rank" in b) throw invalid("点数や順位は保存しません");
    return this.write(
      ctx,
      "training.roleplay.complete",
      key,
      b,
      "training.roleplay.complete",
      "roleplay_session",
      async (tx) => {
        const result = await tx.query(
          "UPDATE roleplay_sessions SET status='completed',completed_at=now(),self_note=$4 WHERE organization_id=$1 AND id=$2 AND membership_id=$3 AND status='active' RETURNING *",
          [ctx.organizationId, id, ctx.membershipId, b.selfNote ?? null],
        );
        if (!result.rows[0])
          throw new ApiProblem(
            "JOB_STATE_CONFLICT",
            409,
            "ロールプレイは完了済みか再開できません",
          );
        return { status: 200, body: camel(result.rows[0]), resourceId: id };
      },
    );
  }

  async listUsers(ctx: RequestContext) {
    const access = this.capabilityAccess(ctx, "user:manage");
    return this.read(ctx, "user.list", "membership", async (tx) => {
      const r = await tx.query(
        `SELECT m.id,m.branch_id,m.status,m.lock_version,u.display_name,u.email_masked,array_remove(array_agg(r.role_code),NULL) roles FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN role_assignments ra ON ra.membership_id=m.id AND (ra.valid_until IS NULL OR ra.valid_until>now()) LEFT JOIN roles r ON r.id=ra.role_id WHERE m.organization_id=$1 AND ($2::boolean OR m.branch_id=ANY($3::uuid[])) GROUP BY m.id,u.id ORDER BY u.display_name`,
        [ctx.organizationId, access.organization, access.branchIds],
      );
      return { items: camel(r.rows), nextCursor: null, hasMore: false };
    });
  }
  async inviteUser(ctx: RequestContext, key: string | undefined, b: Json) {
    const access = this.capabilityAccess(ctx, "user:manage");
    return this.write(
      ctx,
      "user.invite",
      key,
      b,
      "user.invite",
      "membership",
      async (tx) => {
        const email = text(b.email, 320, "email").toLowerCase();
        if (
          !email.endsWith("@example.invalid") &&
          process.env.NODE_ENV !== "production"
        )
          throw invalid(
            "ローカルではexample.invalidの匿名メールだけを使用してください",
          );
        const display = text(b.displayName, 200, "displayName");
        const branchId = String(b.branchId ?? ctx.branchId);
        if (!access.organization && !access.branchIds.includes(branchId))
          throw denied();
        const userId = randomUUID(),
          membershipId = randomUUID();
        await tx.query(
          "INSERT INTO users(id,provider_subject_hash,email_hash,email_masked,display_name,status) VALUES($1,$2,$3,$4,$5,'invited')",
          [
            userId,
            sha(`invite:${email}`),
            sha(email),
            email.replace(/^(.).+(@.+)$/, "$1***$2"),
            display,
          ],
        );
        await tx.query(
          "INSERT INTO memberships(id,organization_id,user_id,branch_id,status) VALUES($1,$2,$3,$4,'invited')",
          [membershipId, ctx.organizationId, userId, branchId],
        );
        const requested = managedRoles(b.roles ?? ["assessor"]);
        for (const role of requested) {
          const organizationScoped = ["educator", "content_approver"].includes(
            role,
          );
          if (organizationScoped && !access.organization)
            throw denied(
              "教育担当・コンテンツ承認者は組織管理者だけが付与できます",
            );
          const inserted = await tx.query(
            `INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id,assigned_by_membership_id) SELECT $1,$2,id,$3,$4,$5 FROM roles WHERE role_code=$6 RETURNING id`,
            [
              ctx.organizationId,
              membershipId,
              role === "assessor"
                ? "self"
                : organizationScoped
                  ? "organization"
                  : "branch",
              role === "assessor"
                ? membershipId
                : organizationScoped
                  ? ctx.organizationId
                  : branchId,
              ctx.membershipId,
              role,
            ],
          );
          if (!inserted.rowCount) throw invalid("権限を確認してください");
        }
        return {
          status: 201,
          body: {
            id: membershipId,
            branchId,
            displayName: display,
            emailMasked: email.replace(/^(.).+(@.+)$/, "$1***$2"),
            status: "invited",
            roles: requested,
            lockVersion: 1,
          },
          resourceId: membershipId,
        };
      },
    );
  }
  async updateUser(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    this.capabilityAccess(ctx, "user:manage");
    if (id === ctx.membershipId)
      throw denied("自分自身の利用状態や所属は変更できません");
    return this.write(
      ctx,
      "user.update",
      key,
      b,
      "user.update",
      "membership",
      async (tx) => {
        await this.assertManagedMembership(tx, ctx, id);
        const status = b.status ? String(b.status) : null;
        if (
          status &&
          !["invited", "active", "suspended", "closed"].includes(status)
        )
          throw invalid("利用状態を確認してください");
        const nextBranchId = b.branchId ? String(b.branchId) : null;
        if (nextBranchId) {
          const access = this.capabilityAccess(ctx, "user:manage");
          if (!access.organization && !access.branchIds.includes(nextBranchId))
            throw denied();
        }
        const r = await tx.query(
          "UPDATE memberships SET status=COALESCE($3,status),branch_id=COALESCE($4::uuid,branch_id),lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2 AND lock_version=$5 RETURNING *",
          [
            ctx.organizationId,
            id,
            status,
            b.branchId ?? null,
            Number(b.expectedLockVersion),
          ],
        );
        if (!r.rows[0])
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "利用者情報を再読み込みしてください",
          );
        if (status === "suspended" || status === "closed")
          await tx.query(
            "UPDATE sessions SET revoked_at=now() WHERE organization_id=$1 AND membership_id=$2 AND revoked_at IS NULL",
            [ctx.organizationId, id],
          );
        return { status: 200, body: camel(r.rows[0]), resourceId: id };
      },
    );
  }
  async replaceRoles(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    this.capabilityAccess(ctx, "user:manage");
    if (id === ctx.membershipId) throw denied("自分自身の権限は変更できません");
    return this.write(
      ctx,
      "user.roles",
      key,
      b,
      "role.assign",
      "membership",
      async (tx) => {
        const target = await this.assertManagedMembership(tx, ctx, id);
        const roles = managedRoles(b.roles);
        const branchId = String(b.branchId ?? target.branchId);
        const access = this.capabilityAccess(ctx, "user:manage");
        if (!access.organization && !access.branchIds.includes(branchId))
          throw denied();
        await tx.query(
          "DELETE FROM role_assignments WHERE organization_id=$1 AND membership_id=$2",
          [ctx.organizationId, id],
        );
        for (const role of roles) {
          const organizationScoped = ["educator", "content_approver"].includes(
            role,
          );
          if (organizationScoped && !access.organization)
            throw denied(
              "教育担当・コンテンツ承認者は組織管理者だけが付与できます",
            );
          const scope =
            role === "assessor"
              ? "self"
              : organizationScoped
                ? "organization"
                : "branch";
          const scopeId =
            role === "assessor"
              ? id
              : organizationScoped
                ? ctx.organizationId
                : branchId;
          const r = await tx.query(
            `INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id,assigned_by_membership_id) SELECT $1,$2,id,$3,$4,$5 FROM roles WHERE role_code=$6 RETURNING id`,
            [ctx.organizationId, id, scope, scopeId, ctx.membershipId, role],
          );
          if (!r.rowCount) throw invalid("権限を確認してください");
        }
        await tx.query(
          "UPDATE sessions SET revoked_at=now() WHERE organization_id=$1 AND membership_id=$2 AND revoked_at IS NULL",
          [ctx.organizationId, id],
        );
        return {
          status: 200,
          body: { id, roles, sessionRevoked: true },
          resourceId: id,
        };
      },
    );
  }

  async listJobs(ctx: RequestContext, q: Json) {
    const access = this.jobAccess(ctx);
    return this.read(ctx, "job.list", "job", async (tx) => {
      const values: unknown[] = [
        ctx.organizationId,
        access.organization,
        access.branchIds,
      ];
      let where = `j.organization_id=$1 AND ($2::boolean OR ${jobBranchExpression("j")}=ANY($3::uuid[]))`;
      if (q.status) {
        values.push(String(q.status));
        where += ` AND status=$${values.length}`;
      }
      if (q.type) {
        values.push(String(q.type));
        where += ` AND job_type=$${values.length}`;
      }
      const r = await tx.query(
        `SELECT j.id,j.organization_id,j.job_type,j.entity_type,j.entity_id,j.status,j.attempt_count,j.max_attempts,j.available_at,j.started_at,j.finished_at,j.error_code,j.created_at,j.updated_at FROM jobs j WHERE ${where} ORDER BY j.created_at DESC LIMIT 100`,
        values,
      );
      return { items: camel(r.rows), nextCursor: null, hasMore: false };
    });
  }
  async retryJob(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    const access = this.jobAccess(ctx);
    return this.write(
      ctx,
      "job.retry",
      key,
      b,
      "job.retry",
      "job",
      async (tx) => {
        text(b.reason, 500, "reason");
        const current=await tx.query<{
          job_type:string;
          status:string;
          attempt_count:number;
          provider_operation_id:string|null;
          provider_operation_state:Record<string,unknown>;
          uncertain_restart_allowed:boolean;
        }>(
          `SELECT job_type,status,attempt_count,provider_operation_id,provider_operation_state,
                  provider_operation_started_at<=now()-interval '9 hours' uncertain_restart_allowed
             FROM jobs j WHERE j.organization_id=$1 AND j.id=$2
              AND ($3::boolean OR ${jobBranchExpression("j")}=ANY($4::uuid[]))
             FOR UPDATE`,
          [ctx.organizationId, id, access.organization, access.branchIds],
        );
        const job=current.rows[0];
        if (!job) throw notFound("ジョブが見つかりません");
        if (!["failed","retry_wait"].includes(job.status))
          throw new ApiProblem(
            "JOB_STATE_CONFLICT",
            409,
            "この状態では再試行できません",
          );
        const uncertainStart=job.job_type==="transcribe"&&!job.provider_operation_id&&job.provider_operation_state?.phase==="starting";
        if(uncertainStart&&(job.status!=="failed"||!job.uncertain_restart_allowed))
          throw new ApiProblem("JOB_STATE_CONFLICT",409,"文字起こし開始結果の確認中です。9時間経過後に管理者が再試行できます");
        const resetUncertain=uncertainStart&&job.status==="failed"&&job.uncertain_restart_allowed;
        const r = await tx.query(
          `UPDATE jobs SET status='queued',available_at=now(),finished_at=NULL,error_code=NULL,error_detail_redacted=NULL,
                  provider_operation_id=CASE WHEN $3::boolean THEN NULL ELSE provider_operation_id END,
                  provider_operation_state=CASE WHEN $3::boolean THEN '{}'::jsonb ELSE provider_operation_state END,
                  provider_operation_started_at=CASE WHEN $3::boolean THEN NULL ELSE provider_operation_started_at END
            WHERE organization_id=$1 AND id=$2 RETURNING id,status,attempt_count`,
          [ctx.organizationId,id,resetUncertain],
        );
        const retried=r.rows[0];
        if(!retried)throw new ApiProblem("JOB_STATE_CONFLICT",409,"この状態では再試行できません");
        await tx.query(
          `INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key) VALUES($1,'job.dispatch','job',$2,$3,$4) ON CONFLICT DO NOTHING`,
          [
            ctx.organizationId,
            id,
            { job_id: id },
            `retry:${id}:${retried.attempt_count}`,
          ],
        );
        return {
          status: 202,
          body: {
            jobId: id,
            status: "queued",
            statusUrl: `/api/v1/jobs/${id}`,
            requestId: ctx.requestId,
          },
          resourceId: id,
        };
      },
    );
  }
  async cancelJob(
    ctx: RequestContext,
    id: string,
    key: string | undefined,
    b: Json,
  ) {
    const access = this.jobAccess(ctx);
    return this.write(
      ctx,
      "job.cancel",
      key,
      b,
      "job.cancel",
      "job",
      async (tx) => {
        text(b.reason, 500, "reason");
        const current = await tx.query<{ job_type: string; status: string;provider_operation_id:string|null;provider_operation_state:Record<string,unknown> }>(
          `SELECT j.job_type,j.status,j.provider_operation_id,j.provider_operation_state FROM jobs j WHERE j.organization_id=$1 AND j.id=$2 AND ($3::boolean OR ${jobBranchExpression("j")}=ANY($4::uuid[])) FOR UPDATE`,
          [ctx.organizationId, id, access.organization, access.branchIds],
        );
        const job = current.rows[0];
        if (!job) throw notFound("ジョブが見つかりません");
        if (!["queued", "retry_wait", "running"].includes(job.status))
          throw new ApiProblem(
            "JOB_STATE_CONFLICT",
            409,
            "この状態では取消できません",
          );
        if (
          job.status === "running" &&
          ["delete", "retention_scan"].includes(job.job_type)
        )
          throw new ApiProblem(
            "JOB_STATE_CONFLICT",
            409,
            "削除処理の開始後は取消できません",
          );
        if(job.job_type==="transcribe"){
          const cleanupToken=typeof job.provider_operation_state?.cleanupToken==="string"?job.provider_operation_state.cleanupToken:null;
          if(cleanupToken){
            const cleanup=this.providers.speech.cleanupTranscription?.bind(this.providers.speech);
            const cancel=this.providers.speech.cancelTranscription?.bind(this.providers.speech);
            if(!cleanup&&!cancel)throw new ApiProblem("PROVIDER_TEMPORARY",503,"文字起こし一時データを消去できないため取消を完了できません",true);
            try{
              if(job.provider_operation_id&&cancel)await cancel(job.provider_operation_id,cleanupToken);
              else await cleanup!(cleanupToken);
            }
            catch{throw new ApiProblem("PROVIDER_TEMPORARY",503,"文字起こし一時データを消去できないため取消を完了できません",true);}
          }
        }
        const result = await tx.query(
          "UPDATE jobs SET cancel_requested_at=now(),status=CASE WHEN status='running' THEN status ELSE 'cancelled' END,finished_at=CASE WHEN status='running' THEN finished_at ELSE now() END,lease_expires_at=CASE WHEN status='running' THEN lease_expires_at ELSE NULL END,input_redacted=CASE WHEN status='running' THEN input_redacted ELSE '{}'::jsonb END,provider_operation_id=CASE WHEN job_type='transcribe' THEN NULL ELSE provider_operation_id END,provider_operation_state=CASE WHEN job_type='transcribe' THEN '{}'::jsonb ELSE provider_operation_state END,provider_operation_started_at=CASE WHEN job_type='transcribe' THEN NULL ELSE provider_operation_started_at END,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",
          [ctx.organizationId, id],
        );
        return {
          status: 200,
          body: { ...camel<Json>(result.rows[0]), cancellationRequested: true },
          resourceId: id,
        };
      },
    );
  }

  async retentionPolicies(ctx: RequestContext) {
    this.requireOrganizationCapability(ctx, "retention:manage");
    return this.read(ctx, "retention.read", "retention_policy", async (tx) => {
      const policies = await tx.query(
        "SELECT * FROM retention_policies WHERE organization_id=$1 ORDER BY data_type,version DESC",
        [ctx.organizationId],
      );
      const deletions = await tx.query(
        "SELECT status,count(*)::int count FROM deletion_requests WHERE organization_id=$1 GROUP BY status",
        [ctx.organizationId],
      );
      return {
        policies: camel(policies.rows),
        deletionSummary: camel(deletions.rows),
      };
    });
  }

  async retentionBindings(ctx:RequestContext,visitId:string){
    this.capabilityAccess(ctx,"retention:manage");
    return this.read(ctx,"retention.binding.read","visit",async tx=>{
      await this.assertVisitAccess(tx,ctx,visitId);
      const rows=await tx.query(
        `WITH hold AS (
           SELECT EXISTS(SELECT 1 FROM legal_holds WHERE organization_id=$1 AND visit_id=$2 AND released_at IS NULL) active
         )
         SELECT 'document' resource_type,d.id resource_id,d.status,p.id policy_id,p.version policy_version,
                p.retention_days,s.retention_until::text retention_until,hold.active legal_hold_active
           FROM visit_documents d JOIN storage_objects s ON s.id=d.storage_object_id AND s.organization_id=d.organization_id
           JOIN retention_policies p ON p.id=s.retention_policy_id AND p.organization_id=s.organization_id CROSS JOIN hold
          WHERE d.organization_id=$1 AND d.visit_id=$2
         UNION ALL
         SELECT 'recording',r.id,r.status,p.id,p.version,p.retention_days,r.retention_until::text,hold.active
           FROM recordings r JOIN retention_policies p ON p.id=r.retention_policy_id AND p.organization_id=r.organization_id CROSS JOIN hold
          WHERE r.organization_id=$1 AND r.visit_id=$2
         UNION ALL
         SELECT 'transcript',t.id,t.status,p.id,p.version,p.retention_days,t.retention_until::text,hold.active
           FROM transcripts t JOIN recordings r ON r.id=t.recording_id AND r.organization_id=t.organization_id
           JOIN retention_policies p ON p.id=t.retention_policy_id AND p.organization_id=t.organization_id CROSS JOIN hold
          WHERE t.organization_id=$1 AND r.visit_id=$2
         UNION ALL
         SELECT 'review',rv.id,rv.status,p.id,p.version,p.retention_days,rv.retention_until::text,hold.active
           FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id AND t.organization_id=rv.organization_id
           JOIN recordings r ON r.id=t.recording_id AND r.organization_id=t.organization_id
           JOIN retention_policies p ON p.id=rv.retention_policy_id AND p.organization_id=rv.organization_id CROSS JOIN hold
          WHERE rv.organization_id=$1 AND r.visit_id=$2
         ORDER BY resource_type,resource_id`,
        [ctx.organizationId,visitId],
      );
      return{items:camel(rows.rows)};
    });
  }

  async operationsHealth(ctx:RequestContext){
    const access=this.jobAccess(ctx);
    return this.read(ctx,"operations.health.read","operational_alert",async tx=>{
      const alerts=await tx.query<any>(
        `SELECT a.id,a.failure_class,a.job_type,a.job_id,a.attempt,a.max_attempts,a.oldest_age_seconds,
                a.severity,a.detected_at
           FROM operational_alerts a JOIN jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
          WHERE a.organization_id=$1 AND a.status='active'
            AND ($2::boolean OR ${jobBranchExpression("j")}=ANY($3::uuid[]))
          ORDER BY CASE a.severity WHEN 'critical' THEN 0 ELSE 1 END,a.detected_at,a.id LIMIT 200`,
        [ctx.organizationId,access.organization,access.branchIds],
      );
      const warning=alerts.rows.filter(row=>row.severity==="warning").length;
      const critical=alerts.rows.filter(row=>row.severity==="critical").length;
      const scanned=await tx.query<{scanned_at:string}>(
        "SELECT scanned_at::text FROM operations_scan_runs WHERE organization_id=$1 ORDER BY scanned_at DESC LIMIT 1",
        [ctx.organizationId],
      );
      return{
        status:critical?"critical":warning?"warning":"ok",
        counts:{warning,critical},
        alerts:camel(alerts.rows),
        scannedAt:scanned.rows[0]?.scanned_at??null,
      };
    });
  }
  async createRetentionPolicy(
    ctx: RequestContext,
    key: string | undefined,
    b: Json,
  ) {
    this.requireOrganizationCapability(ctx, "retention:manage");
    return this.write(
      ctx,
      "retention.create",
      key,
      b,
      "retention.change",
      "retention_policy",
      async (tx) => {
        const type = String(b.dataType);
        if (!["pdf", "audio", "video", "transcript", "review", "audit"].includes(type))
          throw invalid("データ種別を確認してください");
        const days = integer(b.retentionDays, 1, 3650, "retentionDays");
        const legalHoldSupported = Boolean(b.legalHoldSupported);
        if (type === "audit" && legalHoldSupported)
          throw invalid("監査ログは案件単位の保持停止対象にできません");
        const effectiveFrom = new Date(String(b.effectiveFrom ?? new Date()));
        if (!Number.isFinite(effectiveFrom.getTime()))
          throw invalid("適用開始日時を確認してください");
        const version = await tx.query<{ version: number }>(
          "SELECT COALESCE(max(version),0)+1 version FROM retention_policies WHERE organization_id=$1 AND data_type=$2",
          [ctx.organizationId, type],
        );
        const id = randomUUID();
        const r = await tx.query(
          `INSERT INTO retention_policies(id,organization_id,data_type,version,retention_days,legal_hold_supported,status,effective_from,approved_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8) RETURNING *`,
          [
            id,
            ctx.organizationId,
            type,
            version.rows[0]?.version,
            days,
            legalHoldSupported,
            effectiveFrom,
            ctx.membershipId,
          ],
        );
        if (effectiveFrom <= new Date())
          await tx.query(
            "UPDATE retention_policies SET status='retired' WHERE organization_id=$1 AND data_type=$2 AND id<>$3 AND status='active' AND effective_from<=now()",
            [ctx.organizationId, type, id],
          );
        const applied =
          effectiveFrom <= new Date()
            ? Number(
                (
                  await tx.query<{ count: number }>(
                    "SELECT apply_retention_policies($1,true)::int count",
                    [ctx.organizationId],
                  )
                ).rows[0]?.count ?? 0,
              )
            : 0;
        return {
          status: 201,
          body: {
            ...camel<Json>(r.rows[0]),
            appliedRecordCount: applied,
            shorteningGraceDays: effectiveFrom <= new Date() ? 7 : 0,
          },
          resourceId: id,
        };
      },
    );
  }
  async deletionRequests(ctx: RequestContext) {
    this.capabilityAccess(ctx, "retention:manage");
    return this.read(ctx, "deletion.list", "deletion_request", async (tx) => {
      const scope = this.visitAccess(ctx);
      const r = await tx.query(
        "SELECT dr.* FROM deletion_requests dr JOIN visits v ON v.id=dr.visit_id WHERE dr.organization_id=$1 AND ($2::boolean OR v.branch_id=ANY($3::uuid[]) OR ($4::boolean AND v.assigned_membership_id=$5)) ORDER BY dr.requested_at DESC LIMIT 100",
        [ctx.organizationId,scope.organization,scope.branchIds,scope.self,ctx.membershipId],
      );
      return { items: camel(r.rows), nextCursor: null, hasMore: false };
    });
  }
  async requestDeletion(
    ctx: RequestContext,
    visitId: string,
    key: string | undefined,
    b: Json,
  ) {
    this.capabilityAccess(ctx, "retention:manage");
    return this.write(
      ctx,
      "deletion.create",
      key,
      b,
      "deletion.request",
      "visit",
      async (tx) => {
        await this.assertVisitAccess(tx, ctx, visitId);
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [visitId]);
        const hold = await tx.query(
          "SELECT 1 FROM legal_holds WHERE organization_id=$1 AND visit_id=$2 AND released_at IS NULL",
          [ctx.organizationId, visitId],
        );
        const active = await tx.query(
          "SELECT 1 FROM deletion_requests WHERE organization_id=$1 AND visit_id=$2 AND status IN ('requested','held','approved','running') FOR UPDATE",
          [ctx.organizationId,visitId],
        );
        if(active.rowCount)throw new ApiProblem("JOB_STATE_CONFLICT",409,"この訪問の削除要求は既に進行中です");
        const id = randomUUID();
        const status = hold.rowCount ? "held" : "requested";
        const r = await tx.query(
          `INSERT INTO deletion_requests(id,organization_id,visit_id,request_type,requested_by_membership_id,reason_code,status,requested_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *`,
          [
            id,
            ctx.organizationId,
            visitId,
            b.requestType ?? "early",
            ctx.membershipId,
            text(b.reasonCode, 50, "reasonCode"),
            status,
          ],
        );
        let jobId: null | string = null;
        if (!hold.rowCount) {
          jobId = randomUUID();
          await tx.query(
            `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id) VALUES($1,$2,'delete','deletion_request',$3,$4,$5,'{}',$6)`,
            [
              jobId,
              ctx.organizationId,
              id,
              `deletion:${id}`,
              sha(id),
              ctx.membershipId,
            ],
          );
          const fence = await tx.query(
            `INSERT INTO visit_deletion_fences(organization_id,visit_id,job_id,operation)
             VALUES($1,$2,$3,'delete')
             ON CONFLICT(organization_id,visit_id) DO NOTHING
             RETURNING visit_id`,
            [ctx.organizationId, visitId, jobId],
          );
          if (!fence.rowCount)
            throw new ApiProblem(
              "JOB_STATE_CONFLICT",
              409,
              "この訪問では別の削除または保持処理が進行中です",
            );
          await tx.query(
            "UPDATE upload_sessions SET expires_at=LEAST(expires_at,now()) WHERE organization_id=$1 AND visit_id=$2 AND completed_at IS NULL",
            [ctx.organizationId, visitId],
          );
          await tx.query(
            `WITH visit_resources AS (
               SELECT $2::uuid id
               UNION SELECT id FROM visit_documents WHERE organization_id=$1 AND visit_id=$2
               UNION SELECT e.id FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id WHERE e.organization_id=$1 AND d.visit_id=$2
               UNION SELECT id FROM visit_preparations WHERE organization_id=$1 AND visit_id=$2
               UNION SELECT id FROM recordings WHERE organization_id=$1 AND visit_id=$2
               UNION SELECT id FROM drive_imports WHERE organization_id=$1 AND visit_id=$2
               UNION SELECT t.id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=$1 AND r.visit_id=$2
               UNION SELECT rv.id FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE rv.organization_id=$1 AND r.visit_id=$2
             )
             UPDATE jobs SET
               cancel_requested_at=now(),
               status=CASE WHEN status IN ('queued','retry_wait') THEN 'cancelled' ELSE status END,
               finished_at=CASE WHEN status IN ('queued','retry_wait') THEN now() ELSE finished_at END,
               input_redacted=CASE WHEN status IN ('queued','retry_wait') THEN '{}'::jsonb ELSE input_redacted END,
               lease_owner=CASE WHEN status IN ('queued','retry_wait') THEN NULL ELSE lease_owner END,
               lease_expires_at=CASE WHEN status IN ('queued','retry_wait') THEN NULL ELSE lease_expires_at END,
               updated_at=now()
             WHERE organization_id=$1 AND id<>$3 AND job_type<>'delete'
               AND status IN ('queued','retry_wait','running')
               AND entity_id IN (SELECT id FROM visit_resources)`,
            [ctx.organizationId, visitId, jobId],
          );
          await tx.query(
            `INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key) VALUES($1,'job.dispatch','job',$2,$3,$4)`,
            [
              ctx.organizationId,
              jobId,
              { job_id: jobId, job_type: "delete" },
              `job:${jobId}`,
            ],
          );
          await tx.query(
            "UPDATE deletion_requests SET status='approved',approved_by_membership_id=$2,approved_at=now(),job_id=$3 WHERE id=$1",
            [id, ctx.membershipId, jobId],
          );
        }
        return {
          status: 202,
          body: {
            ...camel<Json>(r.rows[0]),
            status: hold.rowCount ? "held" : "approved",
            jobId,
            statusUrl: jobId ? `/api/v1/jobs/${jobId}` : null,
          },
          resourceId: id,
        };
      },
    );
  }
  async createLegalHold(
    ctx: RequestContext,
    visitId: string,
    key: string | undefined,
    b: Json,
  ) {
    this.capabilityAccess(ctx, "retention:manage");
    return this.write(
      ctx,
      "legal_hold.create",
      key,
      b,
      "legal_hold.place",
      "visit",
      async (tx) => {
        await this.assertVisitAccess(tx, ctx, visitId);
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          visitId,
        ]);
        const deleting = await tx.query(
          "SELECT 1 FROM visit_deletion_fences f WHERE f.organization_id=$1 AND f.visit_id=$2 AND f.operation='delete'",
          [ctx.organizationId, visitId],
        );
        if (deleting.rowCount)
          throw new ApiProblem(
            "JOB_STATE_CONFLICT",
            409,
            "削除処理中のため保持停止を設定できません。処理状況を確認してください",
          );
        await tx.query(
          "DELETE FROM visit_deletion_fences f WHERE f.organization_id=$1 AND f.visit_id=$2 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=f.job_id AND j.status='running' AND j.lease_expires_at>now())",
          [ctx.organizationId, visitId],
        );
        const id = randomUUID();
        try {
          const r = await tx.query(
            `INSERT INTO legal_holds(id,organization_id,visit_id,reason_code,reason_detail_redacted,placed_by_membership_id,placed_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING *`,
            [
              id,
              ctx.organizationId,
              visitId,
              text(b.reasonCode, 50, "reasonCode"),
              b.reasonDetailRedacted ?? null,
              ctx.membershipId,
            ],
          );
          await tx.query(
            "UPDATE deletion_requests SET status='held' WHERE organization_id=$1 AND visit_id=$2 AND status IN ('requested','approved')",
            [ctx.organizationId, visitId],
          );
          return { status: 201, body: camel(r.rows[0]), resourceId: id };
        } catch (error: any) {
          if (error?.code === "23505")
            throw new ApiProblem(
              "VERSION_CONFLICT",
              409,
              "この案件には既に保持停止があります",
            );
          throw error;
        }
      },
    );
  }
  async releaseLegalHold(
    ctx: RequestContext,
    visitId: string,
    key: string | undefined,
    b: Json,
  ) {
    this.capabilityAccess(ctx, "retention:manage");
    return this.write(
      ctx,
      "legal_hold.release",
      key,
      b,
      "legal_hold.release",
      "visit",
      async (tx) => {
        await this.assertVisitAccess(tx, ctx, visitId);
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [visitId]);
        text(b.reason, 500, "reason");
        const r = await tx.query(
          "UPDATE legal_holds SET released_by_membership_id=$3,released_at=now() WHERE organization_id=$1 AND visit_id=$2 AND released_at IS NULL RETURNING id",
          [ctx.organizationId, visitId, ctx.membershipId],
        );
        if (!r.rows[0]) throw notFound();
        const held = await tx.query<{ id: string }>(
          "SELECT id FROM deletion_requests WHERE organization_id=$1 AND visit_id=$2 AND status='held' FOR UPDATE",
          [ctx.organizationId, visitId],
        );
        const resumedJobIds: string[] = [];
        for (const request of held.rows) {
          const jobId = randomUUID();
          await tx.query(
            `INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id) VALUES($1,$2,'delete','deletion_request',$3,$4,$5,'{}',$6)`,
            [
              jobId,
              ctx.organizationId,
              request.id,
              `deletion:${request.id}`,
              sha(request.id),
              ctx.membershipId,
            ],
          );
          const fence=await tx.query(
            "INSERT INTO visit_deletion_fences(organization_id,visit_id,job_id,operation) VALUES($1,$2,$3,'delete') ON CONFLICT(organization_id,visit_id) DO NOTHING RETURNING visit_id",
            [ctx.organizationId,visitId,jobId],
          );
          if(!fence.rowCount)throw new ApiProblem("JOB_STATE_CONFLICT",409,"この訪問では別の削除または保持処理が進行中です");
          await tx.query("UPDATE upload_sessions SET expires_at=LEAST(expires_at,now()) WHERE organization_id=$1 AND visit_id=$2 AND completed_at IS NULL",[ctx.organizationId,visitId]);
          await tx.query(
            `WITH visit_resources AS (
               SELECT $2::uuid id
               UNION SELECT id FROM visit_documents WHERE organization_id=$1 AND visit_id=$2
               UNION SELECT e.id FROM document_extractions e JOIN visit_documents d ON d.id=e.visit_document_id WHERE e.organization_id=$1 AND d.visit_id=$2
               UNION SELECT id FROM visit_preparations WHERE organization_id=$1 AND visit_id=$2
               UNION SELECT id FROM recordings WHERE organization_id=$1 AND visit_id=$2
               UNION SELECT id FROM drive_imports WHERE organization_id=$1 AND visit_id=$2
               UNION SELECT t.id FROM transcripts t JOIN recordings r ON r.id=t.recording_id WHERE t.organization_id=$1 AND r.visit_id=$2
               UNION SELECT rv.id FROM reviews rv JOIN transcripts t ON t.id=rv.transcript_id JOIN recordings r ON r.id=t.recording_id WHERE rv.organization_id=$1 AND r.visit_id=$2
             ) UPDATE jobs SET cancel_requested_at=now(),status=CASE WHEN status IN ('queued','retry_wait') THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status IN ('queued','retry_wait') THEN now() ELSE finished_at END,input_redacted=CASE WHEN status IN ('queued','retry_wait') THEN '{}'::jsonb ELSE input_redacted END,lease_owner=CASE WHEN status IN ('queued','retry_wait') THEN NULL ELSE lease_owner END,lease_expires_at=CASE WHEN status IN ('queued','retry_wait') THEN NULL ELSE lease_expires_at END,updated_at=now()
             WHERE organization_id=$1 AND id<>$3 AND job_type<>'delete' AND status IN ('queued','retry_wait','running') AND entity_id IN (SELECT id FROM visit_resources)`,
            [ctx.organizationId,visitId,jobId],
          );
          await tx.query(
            "UPDATE deletion_requests SET status='approved',approved_by_membership_id=$2,approved_at=now(),job_id=$3 WHERE id=$1",
            [request.id, ctx.membershipId, jobId],
          );
          await tx.query(
            `INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key) VALUES($1,'job.dispatch','job',$2,$3,$4)`,
            [
              ctx.organizationId,
              jobId,
              { job_id: jobId, job_type: "delete" },
              `job:${jobId}`,
            ],
          );
          resumedJobIds.push(jobId);
        }
        return {
          status: 200,
          body: { released: true, resumedJobIds },
          resourceId: String(r.rows[0].id),
        };
      },
    );
  }

  async auditEvents(ctx: RequestContext, q: Json) {
    this.requireOrganizationCapability(ctx, "audit:read");
    return this.read(ctx, "audit.search", "audit_event", async (tx) => {
      const values: unknown[] = [ctx.organizationId];
      let where = "organization_id=$1";
      if (q.action) {
        values.push(String(q.action));
        where += ` AND action=$${values.length}`;
      }
      if (q.result) {
        values.push(String(q.result));
        where += ` AND result=$${values.length}`;
      }
      const r = await tx.query(
        `SELECT id,occurred_at,actor_type,action,resource_type,resource_id,result,request_id,trace_id,metadata_redacted,event_hash FROM audit_events WHERE ${where} ORDER BY occurred_at DESC,id DESC LIMIT 100`,
        values,
      );
      return { items: camel(r.rows), nextCursor: null, hasMore: false };
    });
  }
  async featureFlags(ctx:RequestContext){this.requireOrganizationCapability(ctx,"job:manage");return this.read(ctx,"feature_flags.read","feature_flag",async tx=>{const result=await tx.query("SELECT flag_key,enabled,rollback_note,updated_at FROM feature_flags WHERE organization_id=$1 AND flag_key IN ('pilot_content_ai','content_approval','team_analytics') ORDER BY flag_key",[ctx.organizationId]);return{items:camel(result.rows),hasMore:false,nextCursor:null};});}
  async updateFeatureFlag(ctx:RequestContext,flagKey:string,key:string|undefined,b:Json){this.requireOrganizationCapability(ctx,"job:manage");if(!["pilot_content_ai","content_approval","team_analytics"].includes(flagKey))throw notFound();if(typeof b.enabled!=="boolean")throw invalid("有効・無効を選択してください");const enabled=b.enabled;const reason=text(b.reason,500,"reason");return this.write(ctx,"feature_flag.update",key,{flagKey,enabled,reason},"feature_flag.update","feature_flag",async tx=>{const result=await tx.query("UPDATE feature_flags SET enabled=$3,owner_membership_id=$4,rollback_note=$5,updated_at=now() WHERE organization_id=$1 AND flag_key=$2 RETURNING flag_key,enabled,rollback_note,updated_at",[ctx.organizationId,flagKey,enabled,ctx.membershipId,reason]);if(!result.rows[0])throw notFound();return{status:200,body:camel(result.rows[0]),resourceId:null};});}
  async approvals(ctx: RequestContext) {
    this.requireOrganizationCapability(ctx, "content:approve");
    return this.read(ctx, "content.approval.list", "content", async (tx) => {
      const flags = await this.flags(tx, ctx.organizationId);
      if (!flags.content_approval)
        throw new ApiProblem(
          "FEATURE_DISABLED",
          404,
          "コンテンツ承認は現在利用できません",
        );
      const r = await tx.query(
        `SELECT c.id,vm.title,c.content_type type,cv.id version_id,cv.version,cv.body_json,cv.change_summary,(cv.created_by_membership_id=$2) self_authored,previous.id previous_version_id,previous.version previous_version,previous.body_json previous_body_json FROM content_items c JOIN content_versions cv ON cv.content_item_id=c.id JOIN content_version_metadata vm ON vm.content_version_id=cv.id LEFT JOIN LATERAL(SELECT pv.id,pv.version,pv.body_json FROM content_versions pv WHERE pv.organization_id=cv.organization_id AND pv.content_item_id=cv.content_item_id AND pv.version<cv.version ORDER BY pv.version DESC LIMIT 1) previous ON true WHERE c.organization_id=$1 AND cv.review_status='in_review' ORDER BY cv.created_at`,
        [ctx.organizationId, ctx.membershipId],
      );
      return { items: camel(r.rows), nextCursor: null, hasMore: false };
    });
  }
  async approvalBatches(ctx: RequestContext) {
    this.requireOrganizationCapability(ctx, "content:approve");
    return this.read(ctx, "content.approval.batch.list", "content_approval_batch", async (tx) => {
      const flags = await this.flags(tx, ctx.organizationId);
      if (!flags.content_approval)
        throw new ApiProblem("FEATURE_DISABLED", 404, "コンテンツ承認は現在利用できません");
      const batches = await tx.query(
        `SELECT b.id,b.content_type type,b.category,b.status,b.item_count,b.required_approvals,b.snapshot_hash,b.submitted_at,b.decided_at,
          (b.submitted_by_membership_id=$2) self_submitted,
          COALESCE((SELECT count(*)::int FROM content_approval_decisions d WHERE d.batch_id=b.id AND d.decision='approved'),0) approval_count,
          COALESCE((SELECT json_agg(json_build_object('id',i.content_item_id,'versionId',i.content_version_id,'version',i.version,'sourceHash',i.source_hash,'title',vm.title) ORDER BY vm.title,i.content_item_id) FROM content_approval_batch_items i JOIN content_version_metadata vm ON vm.content_version_id=i.content_version_id WHERE i.batch_id=b.id),'[]') items,
          COALESCE((SELECT json_agg(json_build_object('decision',d.decision,'reason',d.reason,'decidedAt',d.decided_at,'decidedBy',u.display_name) ORDER BY d.decided_at,d.id) FROM content_approval_decisions d JOIN memberships m ON m.id=d.decided_by_membership_id JOIN users u ON u.id=m.user_id WHERE d.batch_id=b.id),'[]') decisions
         FROM content_approval_batches b WHERE b.organization_id=$1 ORDER BY (b.status='in_review') DESC,b.submitted_at DESC,b.id DESC LIMIT 100`,
        [ctx.organizationId,ctx.membershipId],
      );
      const candidates = await tx.query(
        `SELECT c.content_type type,vm.category,count(*)::int item_count,
          CASE WHEN c.content_type IN ('price','legal') THEN 2 ELSE 1 END required_approvals
         FROM content_items c JOIN content_versions cv ON cv.id=c.current_version_id JOIN content_version_metadata vm ON vm.content_version_id=cv.id
         WHERE c.organization_id=$1 AND c.deleted_at IS NULL AND c.availability_state='pilot'
           AND c.status='draft' AND cv.review_status='draft' AND cv.migration_state='extracted_needs_review'
           AND NOT EXISTS(SELECT 1 FROM content_approval_batches b WHERE b.organization_id=c.organization_id AND b.content_type=c.content_type AND b.category=vm.category AND b.status='in_review')
         GROUP BY c.content_type,vm.category ORDER BY c.content_type,vm.category`,
        [ctx.organizationId],
      );
      return {items:camel(batches.rows),candidates:camel(candidates.rows),hasMore:false,nextCursor:null};
    });
  }
  async createApprovalBatch(ctx:RequestContext,key:string|undefined,b:Json){
    this.requireOrganizationCapability(ctx,"content:approve");
    return this.write(ctx,"content.approval.batch.create",key,b,"content.approval.batch","content_approval_batch",async tx=>{
      const flags=await this.flags(tx,ctx.organizationId);
      if(!flags.content_approval)throw new ApiProblem("FEATURE_DISABLED",404,"コンテンツ承認は現在利用できません");
      const type=String(b.type??"");
      if(!contentTypes.includes(type as typeof contentTypes[number]))throw invalid("コンテンツ種別を確認してください");
      const category=text(b.category,200,"category");
      const versions=await tx.query<{content_item_id:string;content_version_id:string;version:number;source_hash:string;created_by_membership_id:string|null}>(
        `SELECT c.id content_item_id,cv.id content_version_id,cv.version,cv.source_hash,cv.created_by_membership_id
         FROM content_items c JOIN content_versions cv ON cv.id=c.current_version_id JOIN content_version_metadata vm ON vm.content_version_id=cv.id
         WHERE c.organization_id=$1 AND c.content_type=$2 AND vm.category=$3 AND c.deleted_at IS NULL
           AND c.availability_state='pilot' AND c.status='draft' AND cv.review_status='draft' AND cv.migration_state='extracted_needs_review'
         ORDER BY cv.id FOR UPDATE OF c,cv`,[ctx.organizationId,type,category]);
      if(!versions.rowCount)throw new ApiProblem("RESOURCE_NOT_FOUND",404,"承認対象の未承認コンテンツがありません");
      const snapshotHash=sha(JSON.stringify(versions.rows.map(row=>[row.content_version_id,row.version,row.source_hash])));
      const batchId=randomUUID();const requiredApprovals=["price","legal"].includes(type)?2:1;
      try{
        await tx.query(`INSERT INTO content_approval_batches(id,organization_id,content_type,category,status,item_count,required_approvals,snapshot_hash,submitted_by_membership_id) VALUES($1,$2,$3,$4,'in_review',$5,$6,$7,$8)`,[batchId,ctx.organizationId,type,category,versions.rowCount,requiredApprovals,snapshotHash,ctx.membershipId]);
      }catch(error){if((error as {code?:string}).code==="23505")throw new ApiProblem("VERSION_CONFLICT",409,"このカテゴリはすでに承認中です");throw error;}
      for(const row of versions.rows)await tx.query(`INSERT INTO content_approval_batch_items(organization_id,batch_id,content_item_id,content_version_id,version,source_hash) VALUES($1,$2,$3,$4,$5,$6)`,[ctx.organizationId,batchId,row.content_item_id,row.content_version_id,row.version,row.source_hash]);
      return{status:201,body:{id:batchId,type,category,itemCount:versions.rowCount,requiredApprovals,snapshotHash,status:"in_review"},resourceId:batchId};
    });
  }
  async decideApprovalBatch(ctx:RequestContext,id:string,key:string|undefined,b:Json){
    this.requireOrganizationCapability(ctx,"content:approve");
    return this.write(ctx,"content.approval.batch.decide",key,b,"content.approval.batch","content_approval_batch",async tx=>{
      const decision=String(b.decision??"");if(!["approved","rejected"].includes(decision))throw invalid("承認または差し戻しを選択してください");
      const reason=text(b.reason,2000,"reason");
      const batch=await tx.query<{id:string;status:string;submitted_by_membership_id:string;required_approvals:number}>(`SELECT id,status,submitted_by_membership_id,required_approvals FROM content_approval_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[ctx.organizationId,id]);
      const current=batch.rows[0];if(!current)throw notFound();if(current.status!=="in_review")throw new ApiProblem("VERSION_CONFLICT",409,"この承認batchはすでに完了しています");
      if(current.submitted_by_membership_id===ctx.membershipId)throw denied("自身が提出したbatchは判断できません");
      const snapshot=await tx.query<{content_item_id:string;content_version_id:string;version:number;source_hash:string;created_by_membership_id:string|null}>(`SELECT i.content_item_id,i.content_version_id,i.version,i.source_hash,cv.created_by_membership_id FROM content_approval_batch_items i JOIN content_versions cv ON cv.id=i.content_version_id JOIN content_items c ON c.id=i.content_item_id WHERE i.organization_id=$1 AND i.batch_id=$2 AND c.current_version_id=i.content_version_id AND cv.version=i.version AND cv.source_hash=i.source_hash AND cv.review_status='draft' FOR UPDATE OF cv,c`,[ctx.organizationId,id]);
      const expected=await tx.query<{item_count:number}>(`SELECT item_count FROM content_approval_batches WHERE id=$1`,[id]);
      if(snapshot.rowCount!==expected.rows[0]?.item_count){await tx.query(`UPDATE content_approval_batches SET status='invalidated',invalidated_at=now(),updated_at=now() WHERE id=$1`,[id]);throw new ApiProblem("VERSION_CONFLICT",409,"対象版が変更されたためbatchを作り直してください");}
      if(snapshot.rows.some(row=>row.created_by_membership_id===ctx.membershipId))throw denied("自身が作成した版を含むbatchは承認できません");
      try{await tx.query(`INSERT INTO content_approval_decisions(organization_id,batch_id,decision,decided_by_membership_id,reason) VALUES($1,$2,$3,$4,$5)`,[ctx.organizationId,id,decision,ctx.membershipId,reason]);}catch(error){if((error as {code?:string}).code==="23505")throw new ApiProblem("VERSION_CONFLICT",409,"このbatchはすでに判断済みです");throw error;}
      if(decision==="rejected"){
        await tx.query(`UPDATE content_versions SET review_status='rejected',change_summary=$2 WHERE id IN(SELECT content_version_id FROM content_approval_batch_items WHERE batch_id=$1)`,[id,reason]);
        await tx.query(`UPDATE content_approval_batches SET status='rejected',decided_at=now(),updated_at=now() WHERE id=$1`,[id]);
        return{status:200,body:{id,status:"rejected",approvalCount:0,requiredApprovals:current.required_approvals},resourceId:id};
      }
      const approvals=await tx.query<{count:number}>(`SELECT count(*)::int count FROM content_approval_decisions WHERE batch_id=$1 AND decision='approved'`,[id]);
      if((approvals.rows[0]?.count??0)<current.required_approvals)return{status:200,body:{id,status:"in_review",approvalCount:approvals.rows[0]?.count??0,requiredApprovals:current.required_approvals},resourceId:id};
      await tx.query(`UPDATE content_versions SET review_status='approved',approved_by_membership_id=$2,approved_at=now(),published_at=now(),migration_state=CASE WHEN migration_state='extracted_needs_review' THEN 'reviewed' ELSE migration_state END WHERE id IN(SELECT content_version_id FROM content_approval_batch_items WHERE batch_id=$1)`,[id,ctx.membershipId]);
      await tx.query(`UPDATE content_items c SET status='published',availability_state='published',published_version_id=i.content_version_id,current_version_id=i.content_version_id,updated_at=now() FROM content_approval_batch_items i WHERE i.batch_id=$1 AND i.content_item_id=c.id`,[id]);
      await tx.query(`UPDATE content_approval_batches SET status='approved',decided_at=now(),updated_at=now() WHERE id=$1`,[id]);
      return{status:200,body:{id,status:"approved",approvalCount:approvals.rows[0]?.count??0,requiredApprovals:current.required_approvals},resourceId:id};
    });
  }
  async decideApproval(ctx: RequestContext, key: string | undefined, b: Json) {
    this.requireOrganizationCapability(ctx, "content:approve");
    return this.write(
      ctx,
      "content.approval.decide",
      key,
      b,
      "content.approval",
      "content",
      async (tx) => {
        const flags = await this.flags(tx, ctx.organizationId);
        if (!flags.content_approval)
          throw new ApiProblem(
            "FEATURE_DISABLED",
            404,
            "コンテンツ承認は現在利用できません",
          );
        const decision = String(b.decision);
        if (!["approved", "rejected"].includes(decision))
          throw invalid("承認または差し戻しを選択してください");
        if (decision === "rejected") text(b.comment, 2000, "comment");
        const target = await tx.query<{
          content_item_id: string;
          version: number;
          created_by_membership_id: string | null;
        }>(
          "SELECT content_item_id,version,created_by_membership_id FROM content_versions WHERE organization_id=$1 AND id=$2 AND review_status='in_review' FOR UPDATE",
          [ctx.organizationId, String(b.versionId)],
        );
        if (!target.rows[0])
          throw new ApiProblem(
            "VERSION_CONFLICT",
            409,
            "承認対象の版を再読み込みしてください",
          );
        if (
          decision === "approved" &&
          target.rows[0].created_by_membership_id === ctx.membershipId
        )
          throw denied(
            "自身が作成した版は承認できません。別の承認担当者へ依頼してください",
          );
        await tx.query(
          "UPDATE content_versions SET review_status=$3::varchar,approved_by_membership_id=CASE WHEN $3::text='approved' THEN $4::uuid END,approved_at=CASE WHEN $3::text='approved' THEN now() END,migration_state=CASE WHEN $3::text='approved' AND migration_state='extracted_needs_review' THEN 'reviewed' ELSE migration_state END,change_summary=CASE WHEN $3::text='rejected' THEN $5::text ELSE change_summary END WHERE organization_id=$1 AND id=$2",
          [
            ctx.organizationId,
            String(b.versionId),
            decision,
            ctx.membershipId,
            b.comment ?? null,
          ],
        );
        return {
          status: 200,
          body: {
            versionId: b.versionId,
            decision,
            contentItemId: target.rows[0].content_item_id,
            version: target.rows[0].version,
          },
          resourceId: target.rows[0].content_item_id,
        };
      },
    );
  }
  async analytics(ctx: RequestContext, q: Json) {
    const access = this.capabilityAccess(ctx, "analytics:read");
    return this.read(ctx, "analytics.read", "analytics", async (tx) => {
      const flags = await this.flags(tx, ctx.organizationId);
      if (!flags.team_analytics)
        throw new ApiProblem(
          "FEATURE_DISABLED",
          404,
          "チーム分析は現在利用できません",
        );
      const min = Math.max(5, Number(q.minCohort ?? 5));
      const r = await tx.query(
        `SELECT b.id branch_id,b.name,count(DISTINCT v.id)::int visit_count,count(DISTINCT rv.id)::int review_count FROM branches b LEFT JOIN visits v ON v.branch_id=b.id AND v.organization_id=b.organization_id LEFT JOIN recordings rec ON rec.visit_id=v.id LEFT JOIN transcripts t ON t.recording_id=rec.id LEFT JOIN reviews rv ON rv.transcript_id=t.id WHERE b.organization_id=$1 AND ($3::boolean OR b.id=ANY($4::uuid[])) GROUP BY b.id HAVING count(DISTINCT v.id)>=$2 ORDER BY b.name`,
        [ctx.organizationId, min, access.organization, access.branchIds],
      );
      if (!r.rowCount)
        throw new ApiProblem(
          "SMALL_COHORT",
          422,
          "集計対象が最小人数に達していません",
        );
      return {
        minimumCohort: min,
        groups: camel(r.rows),
        suppressed: true,
        individualData: false,
      };
    });
  }
}
