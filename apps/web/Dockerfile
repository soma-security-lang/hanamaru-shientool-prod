FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/market-price/package.json packages/market-price/package.json
COPY packages/platform/package.json packages/platform/package.json
COPY packages/alignment/package.json packages/alignment/package.json
RUN pnpm install --frozen-lockfile --filter @hanamaru/web...
COPY scripts/build-help.mjs scripts/build-help.mjs
COPY docs/help docs/help
COPY docs/help-config.json docs/help-config.json
COPY apps/web apps/web
COPY apps/api apps/api
COPY packages packages
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY
ARG NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN
ARG NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID
ARG NEXT_PUBLIC_GOOGLE_PICKER_API_KEY
ARG NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_SSO_ISSUER
ARG NEXT_DEPLOYMENT_ID
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY=$NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN=$NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID=$NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID NEXT_PUBLIC_GOOGLE_PICKER_API_KEY=$NEXT_PUBLIC_GOOGLE_PICKER_API_KEY NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER=$NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID NEXT_PUBLIC_SSO_ISSUER=$NEXT_PUBLIC_SSO_ISSUER
RUN test -n "$NEXT_DEPLOYMENT_ID"
RUN pnpm -r --filter @hanamaru/web... --if-present build \
  && pnpm --filter @hanamaru/web deploy --prod --legacy /opt/hanamaru/web-runtime

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libpcre2-8-0 perl-base && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm \
    /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/standalone ./
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=appuser:appuser /app/apps/web/public ./apps/web/public
# Next's standalone tracing is not the production dependency manifest for the
# lazily constructed native API/GCP providers. Keep the complete frozen-lock
# production graph, with workspace exports and SDK data files resolvable.
RUN rm -rf /app/apps/web/node_modules
COPY --from=build --chown=appuser:appuser /opt/hanamaru/web-runtime/node_modules ./apps/web/node_modules
RUN PROVIDER_MODE=gcp GOOGLE_CLOUD_PROJECT=monocle-503402 GCP_LOCATION=asia-northeast1 \
  GCS_PRIVATE_BUCKET=synthetic-container-no-objects CLOUD_TASKS_QUEUE=synthetic-container-no-tasks \
  WORKER_TASK_URL=https://synthetic-worker.example.invalid/internal/tasks \
  TASK_SERVICE_ACCOUNT=synthetic-task@example.invalid SPEECH_LOCATION=us SPEECH_MODEL=chirp_3 \
  VERTEX_LOCATION=asia-northeast1 VERTEX_AI_MODEL=gemini-2.5-flash \
  GOOGLE_DRIVE_CLIENT_ID=synthetic-container-client GOOGLE_DRIVE_CLIENT_SECRET=synthetic-container-not-a-user-secret \
  GOOGLE_DRIVE_REDIRECT_URI=https://synthetic-container.example.invalid/api/google-drive/callback \
  node --input-type=module -e 'import{createRequire}from"node:module";const r=createRequire("/app/apps/web/package.json");for(const name of["@hanamaru/api/alignment","@hanamaru/alignment","@hanamaru/platform"])r(name);if(r("@hanamaru/platform").createProviders().mode!=="gcp")throw new Error("Formal GCP providers required");console.log("NATIVE_API_GCP_PRODUCTION_IMPORTS_PASS_NO_EXTERNAL_REQUESTS")'
USER appuser
EXPOSE 8080
CMD ["node","apps/web/server.js"]
