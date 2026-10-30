FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.14.0
COPY . .
RUN pnpm install --frozen-lockfile
ARG APP_VERSION=""
ENV APP_VERSION=${APP_VERSION}
RUN pnpm --filter @ledgerline/web build

FROM caddy:2-alpine AS runtime
ARG IMAGE_SOURCE=""
LABEL org.opencontainers.image.source="${IMAGE_SOURCE}"
COPY infra/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80
