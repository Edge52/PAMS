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

FROM node:22-bookworm-slim
WORKDIR /app
ARG APP_TIME_ZONE=Africa/Cairo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups NEXT_PUBLIC_APP_TIME_ZONE=$APP_TIME_ZONE
# pg_dump for Administration › Backups › Back up now: the PostgreSQL 17 client from the PostgreSQL project's own
# repository (a newer pg_dump can dump older servers, so it covers PostgreSQL 16 here and Supabase).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/uploads /data/backups && chown -R node:node /data
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fs http://localhost:3000/login >/dev/null || exit 1
# Migrations and reference data (device catalogue, standards, default approval rules) are applied on every start;
# both are idempotent. The first visit to the site asks for the first administrator.
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts --only=none && npx next start -p ${PORT}"]
