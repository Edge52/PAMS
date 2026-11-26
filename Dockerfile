# Hospital PAMS — production image (PostgreSQL required; see docker-compose.yml).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_TIME_ZONE=Africa/Cairo
# NEXT_PUBLIC_* values are compiled into the app, so the time zone is set here, at build time.
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_APP_TIME_ZONE=$APP_TIME_ZONE
RUN npx next build
# CO-13 (audit wave 30): ship only what running needs. Dev tools (TypeScript, ESLint, Vitest, Playwright, drizzle-kit,
# the CAD reader…) are pruned after the build. tsx and its esbuild stay: the start command runs scripts/migrate.ts and
# scripts/seed.ts through tsx, and docs/deploy.md runs other scripts the same way. The build cache goes too.
# (Next's "standalone" output would be smaller still, but it copies only what the web server uses, so migrate, seed and
# the CAD loaders would need their own node_modules again.)
RUN mkdir /tmp/keep && cp -a node_modules/tsx node_modules/esbuild node_modules/@esbuild /tmp/keep/ \
 && npm prune --omit=dev --no-audit --no-fund \
 && cp -a /tmp/keep/. node_modules/ && ln -sf ../tsx/dist/cli.mjs node_modules/.bin/tsx \
 && rm -rf /tmp/keep .next/cache

FROM node:22-bookworm-slim
WORKDIR /app
ARG APP_TIME_ZONE=Africa/Cairo
# The PostgreSQL client must have the same major version as the database server: a newer pg_dump writes dumps an
# older pg_restore refuses ("unsupported version (1.16) in file header", audit CO-03). docker-compose.yml runs
# PostgreSQL 16; build with --build-arg PG_CLIENT_MAJOR=17 for a PostgreSQL 17 server (Supabase).
ARG PG_CLIENT_MAJOR=16
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups NEXT_PUBLIC_APP_TIME_ZONE=$APP_TIME_ZONE
# pg_dump/pg_restore for Administration › Backups (Back up now, restore test) from the PostgreSQL project's own
# repository, and unzip for restoring an uploads .zip (audit CO-04).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-${PG_CLIENT_MAJOR} unzip \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/uploads /data/backups && chown -R node:node /data
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
# Wave 39: /api/health checks the database too (503 when it is down), not just that the web server answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fs http://localhost:3000/api/health >/dev/null || exit 1
# Migrations and reference data (device catalogue, standards, default approval rules) are applied on every start.
# The reference seed only adds missing rows: it never overwrites an administrator's edits (audit CO-01). The first visit to the site asks for the first administrator.
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts --only=none && npx next start -p ${PORT}"]
