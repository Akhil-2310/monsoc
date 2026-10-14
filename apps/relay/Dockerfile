# Relay image. Build from the repo root so the workspace SDK is included:
#   docker build -f apps/relay/Dockerfile .
# node:sqlite needs Node >= 22.5.
FROM node:23-slim
WORKDIR /app
RUN corepack enable

# install deps for the relay + sdk only (layer cached until lockfile/manifests change)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY apps/relay/package.json apps/relay/package.json
RUN pnpm install --frozen-lockfile --filter @monsoc/relay...

COPY packages/sdk packages/sdk
COPY apps/relay apps/relay

ENV NODE_ENV=production
# mount a persistent volume here (Railway: Volumes → mount path /data)
ENV DB_PATH=/data/relay.db
WORKDIR /app/apps/relay
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/index.ts"]
