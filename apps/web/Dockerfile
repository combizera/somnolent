# Build a partir da RAIZ do repo (a web depende de packages/core via workspace).
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.exemplo.com .
FROM node:24-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @somnolent/web...

COPY packages/core packages/core
COPY apps/web apps/web

# A URL da API é assada no bundle no build — trocar de API exige rebuild.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @somnolent/web build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
