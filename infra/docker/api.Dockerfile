FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.33.2
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ledgerline/api build
RUN pnpm --filter @ledgerline/api deploy --prod --legacy /production

FROM node:24.21.0-bookworm-slim AS runtime
ARG IMAGE_SOURCE=""
LABEL org.opencontainers.image.source="${IMAGE_SOURCE}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /production/node_modules ./node_modules
COPY --from=build --chown=node:node /production/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./drizzle
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
