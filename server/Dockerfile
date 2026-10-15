# Game server image. Build from the repository root (it needs shared/ too):
#   docker build -f server/Dockerfile -t leuchtturm-server .
#   docker run -p 2567:2567 leuchtturm-server
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production PORT=2567 HOST=0.0.0.0

# manifests first, so the dependency layer is cached between code changes
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace @lw/server --workspace @lw/shared --no-audit --no-fund

COPY shared shared
COPY server/src server/src
COPY server/tsconfig.json server/
COPY tsconfig.base.json ./

EXPOSE 2567
USER node
CMD ["node_modules/.bin/tsx", "server/src/main.ts"]
