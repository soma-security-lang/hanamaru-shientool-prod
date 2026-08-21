export const identityPlatformProjectId = "monocle-503402";
export const identityPlatformIssuer =
  `https://securetoken.google.com/${identityPlatformProjectId}`;
export const identityPlatformAudience = identityPlatformProjectId;
export const identityPlatformJwksUrl =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export interface ApiConfig {
  host: string;
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
  allowDevAuth: boolean;
  identityIssuer: string;
  identityAudience: string;
  identityJwksUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const allowDevAuth = env.ALLOW_DEV_AUTH === "true";
  if (nodeEnv === "production" && allowDevAuth)
    throw new Error("ALLOW_DEV_AUTH must be disabled in production");
  if (
    env.IDENTITY_PLATFORM_PROJECT_ID &&
    env.IDENTITY_PLATFORM_PROJECT_ID !== identityPlatformProjectId
  )
    throw new Error(
      `IDENTITY_PLATFORM_PROJECT_ID must be ${identityPlatformProjectId}`,
    );
  return {
    host: env.API_HOST ?? "127.0.0.1",
    port: Number(env.API_PORT ?? 3200),
    nodeEnv,
    corsOrigins: (
      env.CORS_ORIGINS ??
      "http://127.0.0.1:3100,http://localhost:3100"
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    allowDevAuth,
    identityIssuer: identityPlatformIssuer,
    identityAudience: identityPlatformAudience,
    identityJwksUrl: identityPlatformJwksUrl,
  };
}
