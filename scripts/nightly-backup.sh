#!/bin/sh
# Nightly backup for docker-compose.yml (runs in the postgres image; POSIX sh only).
#
# Every 24 h: a database dump and an archive of the uploaded files, each written to a hidden temporary file and
# renamed only when complete and verified (CO-02, audit wave 30):
#   - the dump must exit 0, be non-empty and be readable by pg_restore --list;
#   - old backups are removed only after a successful run, so a failing job never empties the folder;
#   - the result goes to .nightly-status in the backup folder, which Administration › Backups shows and the hourly
#     alert run turns into a notification for administrators (CO-07).
#
# Environment: PGHOST/PGUSER/PGDATABASE/PGPASSWORD (or the -h/-U/-d defaults below), KEEP_DAYS (14),
# BACKUP_DIR (/backups), UPLOAD_SRC (/uploads), RUN_ONCE=1 to make one backup and exit (tests, manual runs).
set -u
DIR="${BACKUP_DIR:-/backups}"
UP="${UPLOAD_SRC:-/uploads}"
KEEP="${KEEP_DAYS:-14}"
HOST="${PGHOST:-db}"; USER_="${PGUSER:-hpams}"; DB_="${PGDATABASE:-hpams}"
STATUS="$DIR/.nightly-status"

status() { # ok|failed, message
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf 'status=%s\nat=%s\nmessage=%s\n' "$1" "$now" "$2" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
  echo "backup $1 at $now: $2"
}

run_once() {
  t=$(date -u +%Y%m%d-%H%M)
  mkdir -p "$DIR" || { status failed "the backup folder $DIR can't be created"; return 1; }
  dump="$DIR/hpams-$t.dump"; dpart="$DIR/.partial-hpams-$t.dump"
  up="$DIR/uploads-$t.tar.gz"; upart="$DIR/.partial-uploads-$t.tar.gz"
  rm -f "$dpart" "$upart"
  if ! err=$(pg_dump -h "$HOST" -U "$USER_" -d "$DB_" -Fc -f "$dpart" 2>&1); then
    rm -f "$dpart"; status failed "pg_dump failed: $(echo "$err" | tr '\n' ' ' | cut -c1-300)"; return 1
  fi
  if [ ! -s "$dpart" ]; then rm -f "$dpart"; status failed "pg_dump wrote an empty file"; return 1; fi
  if ! pg_restore --list "$dpart" >/dev/null 2>&1; then rm -f "$dpart"; status failed "the dump can't be read back by pg_restore"; return 1; fi
  mv "$dpart" "$dump"
  if [ -d "$UP" ]; then
    if ! tar -czf "$upart" -C "$UP" . 2>/dev/null || [ ! -s "$upart" ]; then
      rm -f "$upart"; status failed "database saved as $(basename "$dump"), but the uploads archive failed"; return 1
    fi
    mv "$upart" "$up"
  fi
  # Only now, with a verified backup in hand: remove backups older than KEEP days (never the one just made).
  find "$DIR" -maxdepth 1 -type f \( -name 'hpams-*' -o -name 'uploads-*' \) -mtime +"$KEEP" \
    ! -name "$(basename "$dump")" ! -name "$(basename "$up")" -exec rm -f {} +
  status ok "$(basename "$dump") ($(wc -c < "$dump" | tr -d ' ') bytes)"
}

if [ "${RUN_ONCE:-}" = 1 ]; then run_once; exit $?; fi
while true; do run_once || true; sleep 86400; done
