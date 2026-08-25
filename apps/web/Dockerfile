FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @hanamaru/web...
COPY apps/web apps/web
COPY packages/contracts packages/contracts
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY
ARG NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN
ARG NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID
ARG NEXT_PUBLIC_GOOGLE_PICKER_API_KEY
ARG NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY=$NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN=$NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID=$NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID NEXT_PUBLIC_GOOGLE_PICKER_API_KEY=$NEXT_PUBLIC_GOOGLE_PICKER_API_KEY NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER=$NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
RUN pnpm --filter @hanamaru/contracts build && pnpm --filter @hanamaru/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm \
    /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/standalone ./
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=appuser:appuser /app/apps/web/public ./apps/web/public
USER appuser
EXPOSE 8080
CMD ["node","apps/web/server.js"]
