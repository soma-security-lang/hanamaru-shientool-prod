FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/platform/package.json packages/platform/package.json
RUN pnpm install --frozen-lockfile --filter @hanamaru/api...
COPY apps/api apps/api
COPY apps/web/src/mocks/poc-content.json apps/web/src/mocks/poc-content.json
COPY packages packages
RUN pnpm build:packages && pnpm --filter @hanamaru/api build \
  && pnpm --filter @hanamaru/api deploy --prod --legacy /opt/hanamaru/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm \
    /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=build --chown=appuser:appuser /opt/hanamaru/api /app/apps/api
COPY --from=build --chown=appuser:appuser /app/apps/web/src/mocks/poc-content.json /app/apps/web/src/mocks/poc-content.json
USER appuser
EXPOSE 8080
CMD ["node","apps/api/dist/server.js"]
