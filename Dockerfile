# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.ts bakes this host into images.remotePatterns at build time.
ARG STORAGE_PUBLIC_BASE
ENV STORAGE_PUBLIC_BASE=$STORAGE_PUBLIC_BASE
RUN pnpm build
RUN for s in migrate sync-catalog import-offers; do \
      pnpm exec esbuild scripts/$s.ts \
        --bundle --platform=node --target=node20 \
        --format=cjs --outfile=$s.cjs \
        --external:pg-native || exit 1; \
    done

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next standalone binds to $HOSTNAME; Docker sets it to the container ID,
# which breaks the localhost healthcheck. Bind to all interfaces instead.
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/drizzle ./drizzle
COPY --from=builder --chown=app:app /app/migrate.cjs /app/sync-catalog.cjs /app/import-offers.cjs ./
COPY --chown=app:app scripts/entrypoint.sh ./entrypoint.sh
USER app
EXPOSE 3000
CMD ["sh", "./entrypoint.sh"]
