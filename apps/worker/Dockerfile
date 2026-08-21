FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/platform/package.json packages/platform/package.json
RUN pnpm install --frozen-lockfile --filter @hanamaru/worker...
COPY apps/worker apps/worker
COPY packages packages
RUN pnpm build:packages && pnpm --filter @hanamaru/worker build \
  && pnpm --filter @hanamaru/worker deploy --prod --legacy /opt/hanamaru/worker

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production WORKER_HOST=0.0.0.0 WORKER_PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm \
    /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=build --chown=appuser:appuser /opt/hanamaru/worker /app/apps/worker
USER appuser
EXPOSE 8080
CMD ["node","apps/worker/dist/server.js"]
