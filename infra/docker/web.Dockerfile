FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.33.2
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ledgerline/web build

FROM caddy:2-alpine AS runtime
ARG IMAGE_SOURCE=""
LABEL org.opencontainers.image.source="${IMAGE_SOURCE}"
COPY infra/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80
