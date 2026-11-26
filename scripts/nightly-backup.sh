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
# BACKUP_DIR (/backups), UPLOAD_SRC (/uploads), RUN_ONCE=1 to make one backup and exit (tests, manual runs),
# APP_UID/APP_GID (1000, the app container's user): the files are handed to that user so Administration › Backups can
# check and restore-test them.
#
# Off-site copy (wave 39, optional): after a good run the new dump and uploads archive are copied off this server.
#   BACKUP_REMOTE_KIND=s3     BACKUP_REMOTE_URL=https://<endpoint>/<bucket>[/<folder>]  (any S3-compatible store)
#                             BACKUP_REMOTE_ACCESS_KEY, BACKUP_REMOTE_SECRET_KEY, BACKUP_REMOTE_REGION (us-east-1)
#   BACKUP_REMOTE_KIND=rsync  BACKUP_REMOTE_URL=user@host:/path (over ssh) or a mounted folder
#                             BACKUP_REMOTE_SSH_KEY=/path/inside/the/container (a private key, mounted read-only)
# The result goes to .remote-status (shown on Administration › Backups; a failure alerts administrators). A failed
# copy never removes local backups. curl / rsync are installed in this container on first use.
set -u
# S13 (audit wave 30): backups hold every record, so they are written readable by their owner only (files 0600).
umask 077
APP_UID="${APP_UID:-1000}"; APP_GID="${APP_GID:-1000}"
own() { chown "$APP_UID:$APP_GID" "$@" 2>/dev/null || true; }
DIR="${BACKUP_DIR:-/backups}"
UP="${UPLOAD_SRC:-/uploads}"
KEEP="${KEEP_DAYS:-14}"
HOST="${PGHOST:-db}"; USER_="${PGUSER:-hpams}"; DB_="${PGDATABASE:-hpams}"
STATUS="$DIR/.nightly-status"

status() { # ok|failed, message
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf 'status=%s\nat=%s\nmessage=%s\n' "$1" "$now" "$2" > "$STATUS.tmp" && own "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
  echo "backup $1 at $now: $2"
}

REMOTE_STATUS="$DIR/.remote-status"
remote_status() { # ok|failed, message
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  last_ok=""
  [ -f "$REMOTE_STATUS" ] && last_ok=$(sed -n 's/^last_ok=//p' "$REMOTE_STATUS")
  [ "$1" = ok ] && last_ok="$now"
  # The target without any user:password@ part, so the page never shows a secret.
  target="$BACKUP_REMOTE_KIND $(echo "$BACKUP_REMOTE_URL" | sed 's#//[^/@]*@#//#')"
  printf 'status=%s\nat=%s\nmessage=%s\ntarget=%s\nlast_ok=%s\n' "$1" "$now" "$2" "$target" "$last_ok" > "$REMOTE_STATUS.tmp" \
    && own "$REMOTE_STATUS.tmp" && mv "$REMOTE_STATUS.tmp" "$REMOTE_STATUS"
  echo "off-site copy $1 at $now: $2"
}

need_tool() { # command, packages…
  command -v "$1" >/dev/null 2>&1 && return 0
  shift
  (apt-get update -qq && apt-get install -y -qq --no-install-recommends "$@") >/dev/null 2>&1
}

copy_remote() { # files…
  BACKUP_REMOTE_KIND="${BACKUP_REMOTE_KIND:-}"; BACKUP_REMOTE_URL="${BACKUP_REMOTE_URL:-}"
  [ -n "$BACKUP_REMOTE_KIND" ] || return 0
  [ -n "$BACKUP_REMOTE_URL" ] || { remote_status failed "BACKUP_REMOTE_URL is not set"; return 1; }
  case "$BACKUP_REMOTE_KIND" in
    s3)
      need_tool curl curl ca-certificates || { remote_status failed "curl could not be installed in the backup container"; return 1; }
      [ -n "${BACKUP_REMOTE_ACCESS_KEY:-}" ] && [ -n "${BACKUP_REMOTE_SECRET_KEY:-}" ] \
        || { remote_status failed "BACKUP_REMOTE_ACCESS_KEY and BACKUP_REMOTE_SECRET_KEY are needed for s3"; return 1; }
      base="${BACKUP_REMOTE_URL%/}"
      for f in "$@"; do
        # Signed with AWS Signature V4 (curl 7.75+), so it works with AWS, Wasabi, Backblaze B2, MinIO, Cloudflare R2…
        if ! err=$(curl -sS --fail --retry 3 --aws-sigv4 "aws:amz:${BACKUP_REMOTE_REGION:-us-east-1}:s3" \
            --user "$BACKUP_REMOTE_ACCESS_KEY:$BACKUP_REMOTE_SECRET_KEY" -T "$f" "$base/$(basename "$f")" 2>&1); then
          remote_status failed "upload of $(basename "$f") failed: $(echo "$err" | tr '\n' ' ' | cut -c1-300)"; return 1
        fi
      done ;;
    rsync)
      need_tool rsync rsync openssh-client || { remote_status failed "rsync could not be installed in the backup container"; return 1; }
      ssh_cmd="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$DIR/.remote-known-hosts"
      [ -n "${BACKUP_REMOTE_SSH_KEY:-}" ] && ssh_cmd="$ssh_cmd -i $BACKUP_REMOTE_SSH_KEY"
      if ! err=$(rsync -t --chmod=F600 -e "$ssh_cmd" "$@" "${BACKUP_REMOTE_URL%/}/" 2>&1); then
        remote_status failed "rsync failed: $(echo "$err" | tr '\n' ' ' | cut -c1-300)"; return 1
      fi ;;
    *) remote_status failed "BACKUP_REMOTE_KIND must be s3 or rsync, not $BACKUP_REMOTE_KIND"; return 1 ;;
  esac
  remote_status ok "$(for f in "$@"; do basename "$f"; done | tr '\n' ' ' | sed 's/ $//')"
}

run_once() {
  t=$(date -u +%Y%m%d-%H%M)
  mkdir -p "$DIR" || { status failed "the backup folder $DIR can't be created"; return 1; }
  own "$DIR" # the app (user 1000) writes Back up now copies here too
  dump="$DIR/hpams-$t.dump"; dpart="$DIR/.partial-hpams-$t.dump"
  up="$DIR/uploads-$t.tar.gz"; upart="$DIR/.partial-uploads-$t.tar.gz"
  rm -f "$dpart" "$upart"
  if ! err=$(pg_dump -h "$HOST" -U "$USER_" -d "$DB_" -Fc -f "$dpart" 2>&1); then
    rm -f "$dpart"; status failed "pg_dump failed: $(echo "$err" | tr '\n' ' ' | cut -c1-300)"; return 1
  fi
  if [ ! -s "$dpart" ]; then rm -f "$dpart"; status failed "pg_dump wrote an empty file"; return 1; fi
  if ! pg_restore --list "$dpart" >/dev/null 2>&1; then rm -f "$dpart"; status failed "the dump can't be read back by pg_restore"; return 1; fi
  own "$dpart"; mv "$dpart" "$dump"
  if [ -d "$UP" ]; then
    if ! tar -czf "$upart" -C "$UP" . 2>/dev/null || [ ! -s "$upart" ]; then
      rm -f "$upart"; status failed "database saved as $(basename "$dump"), but the uploads archive failed"; return 1
    fi
    own "$upart"; mv "$upart" "$up"
  fi
  # Only now, with a verified backup in hand: remove backups older than KEEP days (never the one just made).
  find "$DIR" -maxdepth 1 -type f \( -name 'hpams-*' -o -name 'uploads-*' \) -mtime +"$KEEP" \
    ! -name "$(basename "$dump")" ! -name "$(basename "$up")" -exec rm -f {} +
  status ok "$(basename "$dump") ($(wc -c < "$dump" | tr -d ' ') bytes)"
  # Off-site copy last: its failure is reported on its own and leaves the local backup as it is.
  if [ -f "$up" ]; then copy_remote "$dump" "$up" || true; else copy_remote "$dump" || true; fi
}

if [ "${RUN_ONCE:-}" = 1 ]; then run_once; exit $?; fi
while true; do run_once || true; sleep 86400; done
