import { createHash } from "node:crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import type {
  AuthorizationScope,
  Capability,
  RequestContext,
  Role,
} from "@hanamaru/contracts";
import {
  capabilities as knownCapabilities,
  roles as knownRoles,
} from "@hanamaru/contracts";
import { developmentIds, type HanamaruRepository } from "@hanamaru/database";
import type { FastifyRequest } from "fastify";
import type { ApiConfig } from "./config.js";
import { ApiProblem } from "./errors.js";

const roleCapabilities: Record<Role, Capability[]> = {
  assessor: ["visit:self", "content:read"],
  manager: [
    "visit:scope",
    "content:read",
    "content:write",
    "user:manage",
    "job:manage",
    "retention:manage",
    "analytics:read",
  ],
  educator: ["content:read", "content:write"],
  content_approver: ["content:read", "content:approve"],
  system_admin: ["user:manage", "job:manage", "audit:read"],
};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const jwksCache = new Map<string, JWTVerifyGetKey>();
function isRole(value: string): value is Role {
  return (knownRoles as readonly string[]).includes(value);
}
function isCapability(value: string): value is Capability {
  return (knownCapabilities as readonly string[]).includes(value);
}
function requestIds(request: FastifyRequest) {
  const requestId = request.id;
  const traceId =
    String(request.headers["x-cloud-trace-context"] ?? requestId).split(
      "/",
    )[0] ?? requestId;
  return { requestId, traceId };
}

export interface AuthenticatedContext extends RequestContext {
  authMode: "development" | "identity_platform";
}
export type IdentityTokenVerifier = (token: string) => Promise<JWTPayload>;
interface MembershipRow {
  organization_id: string;
  membership_id: string;
  branch_id: string;
  roles: string[];
  capabilities: string[];
  authorization_scopes: unknown;
}
async function membershipContext(
  repository: HanamaruRepository,
  request: FastifyRequest,
  where: string,
  value: string,
): Promise<MembershipRow> {
  const requestedOrganization =
    typeof request.headers["x-organization-id"] === "string"
      ? request.headers["x-organization-id"]
      : null;
  const result = await repository.system<MembershipRow>(
    `SELECT m.organization_id,m.id membership_id,m.branch_id,array_remove(array_agg(DISTINCT r.role_code),NULL) roles,COALESCE(array_agg(DISTINCT capability) FILTER(WHERE capability IS NOT NULL),'{}') capabilities,COALESCE(jsonb_agg(DISTINCT jsonb_build_object('role',r.role_code,'scopeType',ra.scope_type,'scopeId',ra.scope_id,'capabilities',r.capabilities)) FILTER(WHERE r.role_code IS NOT NULL),'[]'::jsonb) authorization_scopes FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN role_assignments ra ON ra.membership_id=m.id AND ra.valid_from<=now() AND (ra.valid_until IS NULL OR ra.valid_until>now()) LEFT JOIN roles r ON r.id=ra.role_id LEFT JOIN LATERAL unnest(r.capabilities) capability ON true WHERE ${where} AND m.status='active' AND u.status='active' AND ($2::uuid IS NULL OR m.organization_id=$2::uuid) GROUP BY m.organization_id,m.id ORDER BY m.created_at`,
    [value, requestedOrganization],
  );
  if (!result.rows.length)
    throw new ApiProblem("AUTH_INVALID", 401, "認証情報を確認できませんでした");
  if (result.rows.length > 1 && !requestedOrganization)
    throw new ApiProblem(
      "ORGANIZATION_REQUIRED",
      409,
      "利用する組織を選択してください",
    );
  return result.rows[0]!;
}
function normalizeContext(
  base: { requestId: string; traceId: string },
  row: MembershipRow,
  mode: AuthenticatedContext["authMode"],
): AuthenticatedContext {
  let roles = row.roles.map(String).filter(isRole);
  let capabilities = row.capabilities.map(String).filter(isCapability);
  let authorizationScopes = (
    Array.isArray(row.authorization_scopes) ? row.authorization_scopes : []
  ).flatMap((raw): AuthorizationScope[] => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    const role = String(value.role ?? "");
    const scopeType = String(value.scopeType ?? "");
    if (
      !isRole(role) ||
      !["self", "branch", "organization"].includes(scopeType)
    )
      return [];
    return [
      {
        role,
        scopeType: scopeType as AuthorizationScope["scopeType"],
        scopeId: value.scopeId ? String(value.scopeId) : null,
        capabilities: Array.isArray(value.capabilities)
          ? value.capabilities.map(String).filter(isCapability)
          : [],
      },
    ];
  });
  if (!roles.length)
    throw new ApiProblem("SCOPE_DENIED", 403, "利用可能な権限がありません");
  if (roles.includes("system_admin")) {
    roles = ["system_admin"];
    capabilities = roleCapabilities.system_admin;
    authorizationScopes = authorizationScopes.filter(
      (scope) => scope.role === "system_admin",
    );
  }
  return {
    ...base,
    organizationId: row.organization_id,
    membershipId: row.membership_id,
    branchId: row.branch_id,
    roles,
    capabilities: [...new Set(capabilities)],
    authorizationScopes,
    authMode: mode,
  };
}
function requireNumericDate(
  payload: JWTPayload,
  claim: "exp" | "iat" | "auth_time",
) {
  const value = payload[claim];
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error(`${claim} must be an integer NumericDate`);
  return value;
}
export function validateIdentityPlatformClaims(
  payload: JWTPayload,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const exp = requireNumericDate(payload, "exp");
  const iat = requireNumericDate(payload, "iat");
  const authTime = requireNumericDate(payload, "auth_time");
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const email =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (exp <= nowSeconds) throw new Error("exp must be in the future");
  if (iat > nowSeconds) throw new Error("iat must not be in the future");
  if (authTime > nowSeconds || authTime > iat)
    throw new Error("auth_time must not be after token issuance");
  if (!subject || subject.length > 128)
    throw new Error("sub must be a non-empty Firebase uid");
  if (!email || payload.email_verified !== true)
    throw new Error("a verified email is required");
  return { subject, email };
}
async function verifyIdentityPlatformTokenWithKey(
  token: string,
  config: ApiConfig,
  key: JWTVerifyGetKey,
): Promise<JWTPayload> {
  const verified = await jwtVerify(token, key, {
    issuer: config.identityIssuer,
    audience: config.identityAudience,
    algorithms: ["RS256"],
  });
  if (
    verified.protectedHeader.alg !== "RS256" ||
    typeof verified.protectedHeader.kid !== "string" ||
    !verified.protectedHeader.kid
  )
    throw new Error("a Firebase securetoken RS256 kid is required");
  validateIdentityPlatformClaims(verified.payload);
  return verified.payload;
}
export function createIdentityPlatformTokenVerifier(
  config: ApiConfig,
  key?: JWTVerifyGetKey,
): IdentityTokenVerifier {
  let verifierKey = key;
  if (!verifierKey) {
    const url = config.identityJwksUrl;
    verifierKey = jwksCache.get(url);
    if (!verifierKey) {
      verifierKey = createRemoteJWKSet(new URL(url));
      jwksCache.set(url, verifierKey);
    }
  }
  return (token) => verifyIdentityPlatformTokenWithKey(token, config, verifierKey);
}
export async function authenticate(
  request: FastifyRequest,
  config: ApiConfig,
  repository: HanamaruRepository,
  verifyToken: IdentityTokenVerifier = createIdentityPlatformTokenVerifier(
    config,
  ),
): Promise<AuthenticatedContext> {
  const base = requestIds(request);
  if (config.allowDevAuth) {
    const roleValue = String(request.headers["x-dev-role"] ?? "assessor");
    const role: Role = isRole(roleValue) ? roleValue : "assessor";
    const membershipId =
      role === "assessor"
        ? developmentIds.membershipId
        : role === "system_admin"
          ? developmentIds.systemAdminMembershipId
          : developmentIds.managerMembershipId;
    const scopeType: AuthorizationScope["scopeType"] =
      role === "assessor" ? "self" : "organization";
    return {
      ...base,
      organizationId: developmentIds.organizationId,
      membershipId,
      branchId: developmentIds.branchId,
      roles: [role],
      capabilities: roleCapabilities[role],
      authorizationScopes: [
        {
          role,
          scopeType,
          scopeId:
            scopeType === "self" ? membershipId : developmentIds.organizationId,
          capabilities: roleCapabilities[role],
        },
      ],
      authMode: "development",
    };
  }
  const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer)
    throw new ApiProblem("AUTH_REQUIRED", 401, "再ログインが必要です");
  try {
    const payload = await verifyToken(bearer);
    const { subject, email } = validateIdentityPlatformClaims(payload);
    const subjectHash = sha(subject),
      emailHash = sha(email);
    let membership: MembershipRow;
    try {
      membership = await membershipContext(
        repository,
        request,
        "u.provider_subject_hash=$1",
        subjectHash,
      );
    } catch (error) {
      if (!(error instanceof ApiProblem) || error.code !== "AUTH_INVALID")
        throw error;
      const candidates = await repository.system<{ id: string }>(
        "SELECT id FROM users WHERE email_hash=$1 AND status='invited' ORDER BY created_at LIMIT 2",
        [emailHash],
      );
      if (candidates.rows.length !== 1) throw error;
      const bound = await repository.system(
        "UPDATE users SET provider_subject_hash=$2,status='active',last_login_at=now() WHERE id=$1 AND status='invited' RETURNING id",
        [candidates.rows[0]!.id, subjectHash],
      );
      if (!bound.rowCount) throw error;
      await repository.system(
        "UPDATE memberships SET status='active' WHERE user_id=$1 AND status='invited'",
        [candidates.rows[0]!.id],
      );
      membership = await membershipContext(
        repository,
        request,
        "u.provider_subject_hash=$1",
        subjectHash,
      );
    }
    await repository.system(
      "UPDATE users SET last_login_at=now() WHERE provider_subject_hash=$1 AND last_login_at<now()-interval '1 minute'",
      [subjectHash],
    );
    return normalizeContext(base, membership, "identity_platform");
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    throw new ApiProblem("AUTH_INVALID", 401, "認証情報を確認できませんでした");
  }
}
export function requireCapability(
  context: RequestContext,
  capability: Capability,
) {
  if (!context.capabilities.includes(capability))
    throw new ApiProblem("SCOPE_DENIED", 403, "この操作を行う権限がありません");
}
