# Build a partir da RAIZ do repo (o server depende de packages/core via workspace).
#   docker build -f apps/server/Dockerfile .
FROM node:24-alpine

RUN corepack enable
WORKDIR /app

# Manifests primeiro: camada de deps só invalida quando um package.json muda.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @somnolent/server...

COPY packages/core packages/core
COPY apps/server apps/server

# `start` roda via tsx (não há passo de compilação) e aplica as migrations
# de apps/server/drizzle no boot.
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# node direto, e não `pnpm start`: assim o processo é o PID 1 e recebe o
# SIGTERM do orquestrador em vez de ser derrubado junto com o pnpm, sem chance
# de fechar o pool do Postgres.
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
