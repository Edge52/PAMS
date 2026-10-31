#!/bin/bash
# Back up Hospital PAMS without Docker: database + uploaded files into ./backups (or $BACKUP_DIR).
#   npm run backup
# Embedded database (laptop): copies the .pglite-data / .pglite folder while the app is stopped.
# PostgreSQL: needs pg_dump and DATABASE_URL (from .env or the environment).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
OUT="${BACKUP_DIR:-./backups}"; mkdir -p "$OUT"
T=$(date +%Y%m%d-%H%M)
UP="${UPLOAD_DIR:-./storage/uploads}"
if [ -z "${DATABASE_URL:-}" ] || [[ "$DATABASE_URL" == pglite:* ]]; then
  DIR="${DATABASE_URL#pglite:}"; [ -z "${DATABASE_URL:-}" ] && DIR=./.pglite-data
  [ -d "$DIR" ] || DIR=./.pglite
  if lsof -ti tcp:"${PORT:-3000}" >/dev/null 2>&1; then echo "Stop the app first (Ctrl+C in its window), then run the backup."; exit 1; fi
  tar -czf "$OUT/hpams-db-$T.tar.gz" -C "$(dirname "$DIR")" "$(basename "$DIR")"
else
  pg_dump "$DATABASE_URL" -Fc -f "$OUT/hpams-$T.dump"
fi
[ -d "$UP" ] && tar -czf "$OUT/uploads-$T.tar.gz" -C "$UP" .
echo "Backup written to $OUT ($T)."
