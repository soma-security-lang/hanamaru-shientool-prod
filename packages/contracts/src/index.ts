export const jobStates = [
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type JobState = (typeof jobStates)[number];

export const contentTypes = [
  "talk",
  "flow",
  "glossary",
  "price",
  "manual",
  "legal",
  "video",
  "roleplay",
] as const;
export type ContentType = (typeof contentTypes)[number];

export const roles = [
  "assessor",
  "manager",
  "educator",
  "content_approver",
  "system_admin",
] as const;
export type Role = (typeof roles)[number];

export const capabilities = [
  "visit:self",
  "visit:scope",
  "content:read",
  "content:write",
  "content:approve",
  "user:manage",
  "job:manage",
  "retention:manage",
  "audit:read",
  "analytics:read",
] as const;
export type Capability = (typeof capabilities)[number];

export const recordingConsentNoticeVersion = "1.0" as const;
export const recordingConsentNotice = [
  "接客の振り返りと査定員の育成支援を目的として録音します。",
  "録音はAI振り返りに利用し、文字起こしはGoogle Speech-to-Textの米国multi-regionで処理します。",
  "音声と業務データは東京リージョンのGCSおよびDBに保持します。",
  "閲覧できるのは担当査定員と許可された管理者です。",
  "音声は原則90日、文字起こしと振り返りは原則180日保持します。",
  "録音は拒否でき、同意後も撤回と削除依頼ができます。拒否時は録音を使わない振り返りを利用できます。",
  "人事評価および個人ランキングには使用しません。",
].join("\n");
// N-1 compatibility for tabs opened before the 1.0 notice was deployed. The
// hash must describe exactly what that UI displayed; never substitute the 1.0
// text for this audit record.
export const recordingConsentLegacyNoticeVersion = "pilot-v1" as const;
export const recordingConsentLegacyNotice = "録音同意を確認済み\n口頭で確認" as const;

export type Identifier = string;
export type Timestamp = string;

export interface AuthorizationScope {
  role: Role;
  scopeType: "self" | "branch" | "organization";
  scopeId: Identifier | null;
  capabilities: Capability[];
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  organizationId: Identifier;
  membershipId: Identifier;
  branchId: Identifier;
  roles: Role[];
  capabilities: Capability[];
  authorizationScopes: AuthorizationScope[];
}

export interface LegacySourceRef {
  legacyId: string;
  source: "poc-repository" | "poc-public-html" | "external-unavailable";
  sourceHash: string;
  migratedAt: string;
  status: "migrated" | "review_required" | "unavailable";
  reviewReason?: string;
}

export interface ContentItem {
  id: Identifier;
  type: ContentType;
  title: string;
  category: string;
  body: string;
  tags: string[];
  difficulty?: "beginner" | "intermediate" | "advanced";
  publicationStatus: "draft" | "published" | "retired";
  version: number;
  legacy?: LegacySourceRef;
}

export interface Visit {
  id: Identifier;
  organizationId: Identifier;
  branchId: Identifier;
  assignedMembershipId: Identifier;
  caseNumber: string;
  status:
    | "draft"
    | "ready"
    | "visited"
    | "reviewed"
    | "closed"
    | "cancelled"
    | "deleting"
    | "deleted";
  scheduledAt: Timestamp | null;
  customerLabel: string | null;
  notesRedacted: string | null;
  lockVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Job {
  id: Identifier;
  organizationId: Identifier;
  jobType:
    | "pdf_extract"
    | "drive_import"
    | "transcribe"
    | "review"
    | "delete"
    | "retention_scan";
  entityType: string;
  entityId: Identifier;
  status: JobState;
  attemptCount: number;
  maxAttempts: number;
  availableAt: Timestamp;
  nextRetryAt: Timestamp | null;
  errorCode: string | null;
  errorDetailRedacted: string | null;
  requestedByMembershipId: Identifier;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TranscriptSegment {
  id: Identifier;
  sequenceNo: number;
  startMs: number;
  endMs: number;
  speakerRole: "staff" | "customer" | "unknown";
  text: string;
  editedText: string | null;
}

export const transcriptQualityFlags = [
  "many_speakers",
  "possible_media",
  "long_non_dialogue",
  "assessment_unavailable",
] as const;
export type TranscriptQualityFlag = (typeof transcriptQualityFlags)[number];

export interface TranscriptQualityAssessment {
  id: Identifier;
  transcriptId: Identifier;
  status: "evaluated" | "assessment_unavailable";
  modelName?: string | null;
  failureClass?: "MODEL_OUTPUT_INVALID" | "EVIDENCE_INVALID" | null;
  flags: TranscriptQualityFlag[];
  confidence: number | null;
  evidenceSegmentIds: Identifier[];
  continuationDecision: "continue" | "replace" | null;
  acknowledgedByMembershipId?: Identifier | null;
  acknowledgedAt: Timestamp | null;
  lockVersion: number;
  metrics: {
    segmentCount: number;
    chunkCount: number;
    maxLabelsPerChunk: number;
    speechOccupancyRatio: number;
  };
}

export interface Transcript {
  id: Identifier;
  organizationId: Identifier;
  recordingId: Identifier;
  status:
    | "generated"
    | "editing"
    | "confirmed"
    | "superseded"
    | "deleting"
    | "deleted";
  version: number;
  languageCode: string;
  fullText: string;
  segments: TranscriptSegment[];
  qualityAssessment?: TranscriptQualityAssessment | null;
  lockVersion: number;
}

export interface RetentionBindingDto {
  resourceType: "document" | "recording" | "transcript" | "review";
  resourceId: Identifier;
  status: string;
  policyId: Identifier;
  policyVersion: number;
  retentionDays: number;
  retentionUntil: Timestamp;
  legalHoldActive: boolean;
}

export const operationalFailureClasses = [
  "STT_HEARTBEAT_STALE",
  "STT_LRO_TIMEOUT",
  "RETRY_WAIT_OVERDUE",
  "MODEL_OUTPUT_INVALID",
  "EVIDENCE_INVALID",
  "RETRY_LIMIT_EXCEEDED",
] as const;
export type OperationalFailureClass = (typeof operationalFailureClasses)[number];

export interface OperationalAlertDto {
  id: Identifier;
  failureClass: OperationalFailureClass;
  jobType: string;
  jobId: Identifier;
  attempt: number;
  maxAttempts: number;
  oldestAgeSeconds: number;
  severity: "warning" | "critical";
  detectedAt: Timestamp;
}

export interface OperationsHealthDto {
  status: "ok" | "warning" | "critical";
  counts: { warning: number; critical: number };
  alerts: OperationalAlertDto[];
  scannedAt: Timestamp | null;
}

export interface ReviewFinding {
  id: Identifier;
  category:
    | "strength"
    | "improvement"
    | "talk"
    | "compliance"
    | "next_action"
    | "revisit";
  title: string;
  description: string;
  recommendedAction: string | null;
  evidenceSegmentIds: Identifier[];
}

export interface Review {
  id: Identifier;
  organizationId: Identifier;
  transcriptId: Identifier;
  version: number;
  status:
    | "generated"
    | "acknowledged"
    | "superseded"
    | "withdrawn"
    | "deleting"
    | "deleted";
  summary: string;
  findings: ReviewFinding[];
  lockVersion: number;
}

export interface UserSummary {
  id: Identifier;
  displayName: string;
  emailMasked: string;
  branchId: Identifier;
  status: "invited" | "active" | "suspended" | "closed";
  roles: Role[];
  lockVersion: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AsyncAccepted {
  jobId: Identifier;
  status: "queued";
  statusUrl: string;
  requestId: string;
}

export const errorCodes = [
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "SESSION_EXPIRED",
  "ORGANIZATION_REQUIRED",
  "CSRF_INVALID",
  "SCOPE_DENIED",
  "RESOURCE_NOT_FOUND",
  "RESOURCE_GONE",
  "VALIDATION_FAILED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "CONSENT_REQUIRED",
  "CONSENT_WITHDRAWN",
  "FILE_TYPE_INVALID",
  "FILE_SIZE_INVALID",
  "CHECKSUM_MISMATCH",
  "UPLOAD_EXPIRED",
  "JOB_STATE_CONFLICT",
  "FEATURE_DISABLED",
  "SMALL_COHORT",
  "PROVIDER_TEMPORARY",
  "PROVIDER_PERMANENT",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors: Array<{ field: string; message: string }>;
    retryable: boolean;
  };
  requestId: string;
}

export interface AuditEvent {
  id: Identifier;
  organizationId: Identifier;
  occurredAt: Timestamp;
  actorType: "user" | "service" | "system";
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: Identifier | null;
  result: "allowed" | "denied" | "failed";
  requestId: string;
  traceId: string;
  metadataRedacted: Record<string, unknown>;
  eventHash: string;
}
