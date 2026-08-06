#!/usr/bin/env bash
# Ship the live Arra Oracle index from this machine to a droplet volume mount.
# Copies only live index files from ~/.arra-oracle-v2 and excludes backup/export debris.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/seed-droplet.sh --host user@droplet --remote-dir /path/to/data [options]

Required:
  --host HOST             SSH target, e.g. root@203.0.113.10
  --remote-dir PATH       Remote docker volume mount containing oracle.db/lancedb/

Options:
  --source-dir PATH       Local data dir (default: $ORACLE_DATA_DIR or ~/.arra-oracle-v2)
  --container NAME        Docker container to stop before sync and start after sync
  --compose-dir PATH      Remote dir with docker-compose.yml; runs docker compose stop/start
  --dry-run               Print rsync plan without writing remote files
  --no-stop               Do not stop/start container or compose service
  -h, --help              Show this help

Environment equivalents:
  DROPLET_HOST, DROPLET_DATA_DIR, ORACLE_DATA_DIR, DROPLET_CONTAINER, DROPLET_COMPOSE_DIR

Copies:
  oracle.db
  embedding-cache.db
  lancedb/

Excludes:
  *.backup-*  *.export-*  *.bak  *.tmp  *-wal  *-shm
USAGE
}

log() { printf '[seed-droplet] %s\n' "$*" >&2; }
fail() { printf '[seed-droplet] ERROR: %s\n' "$*" >&2; exit 1; }

HOST="${DROPLET_HOST:-}"
REMOTE_DIR="${DROPLET_DATA_DIR:-}"
SOURCE_DIR="${ORACLE_DATA_DIR:-$HOME/.arra-oracle-v2}"
CONTAINER="${DROPLET_CONTAINER:-}"
COMPOSE_DIR="${DROPLET_COMPOSE_DIR:-}"
DRY_RUN=0
NO_STOP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    --remote-dir) REMOTE_DIR="${2:-}"; shift 2 ;;
    --source-dir) SOURCE_DIR="${2:-}"; shift 2 ;;
    --container) CONTAINER="${2:-}"; shift 2 ;;
    --compose-dir) COMPOSE_DIR="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-stop) NO_STOP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$HOST" ]] || { usage; fail '--host is required'; }
[[ -n "$REMOTE_DIR" ]] || { usage; fail '--remote-dir is required'; }
[[ -d "$SOURCE_DIR" ]] || fail "source dir not found: $SOURCE_DIR"
[[ -f "$SOURCE_DIR/oracle.db" ]] || fail "missing $SOURCE_DIR/oracle.db"
[[ -f "$SOURCE_DIR/embedding-cache.db" ]] || log "warning: $SOURCE_DIR/embedding-cache.db not found; rsync will skip it"
[[ -d "$SOURCE_DIR/lancedb" ]] || log "warning: $SOURCE_DIR/lancedb/ not found; rsync will skip it"

RSYNC_ITEMS=()
[[ -f "$SOURCE_DIR/oracle.db" ]] && RSYNC_ITEMS+=("oracle.db")
[[ -f "$SOURCE_DIR/embedding-cache.db" ]] && RSYNC_ITEMS+=("embedding-cache.db")
[[ -d "$SOURCE_DIR/lancedb" ]] && RSYNC_ITEMS+=("lancedb/")

remote_quote() { printf '%q' "$1"; }
remote_run() { ssh "$HOST" "$@"; }

stop_remote() {
  [[ "$NO_STOP" -eq 0 ]] || return 0
  if [[ -n "$COMPOSE_DIR" ]]; then
    log "stopping remote compose stack in $COMPOSE_DIR"
    remote_run "cd $(remote_quote "$COMPOSE_DIR") && docker compose stop"
  elif [[ -n "$CONTAINER" ]]; then
    log "stopping remote container $CONTAINER"
    remote_run "docker stop $(remote_quote "$CONTAINER") >/dev/null || true"
  else
    log "no --container/--compose-dir supplied; skipping remote stop"
  fi
}

start_remote() {
  [[ "$NO_STOP" -eq 0 ]] || return 0
  if [[ -n "$COMPOSE_DIR" ]]; then
    log "starting remote compose stack in $COMPOSE_DIR"
    remote_run "cd $(remote_quote "$COMPOSE_DIR") && docker compose start"
  elif [[ -n "$CONTAINER" ]]; then
    log "starting remote container $CONTAINER"
    remote_run "docker start $(remote_quote "$CONTAINER") >/dev/null"
  else
    log "no --container/--compose-dir supplied; skipping remote start"
  fi
}

log "source: $SOURCE_DIR"
log "target: $HOST:$REMOTE_DIR"
log "items: ${RSYNC_ITEMS[*]}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  NO_STOP=1
fi
remote_run "mkdir -p $(remote_quote "$REMOTE_DIR")"

stop_remote
trap start_remote EXIT

RSYNC_FLAGS=(-az --info=progress2 --human-readable)
[[ "$DRY_RUN" -eq 1 ]] && RSYNC_FLAGS+=(--dry-run)
rsync "${RSYNC_FLAGS[@]}" \
  --exclude='*.backup-*' \
  --exclude='*.export-*' \
  --exclude='*.bak' \
  --exclude='*.tmp' \
  --exclude='*-wal' \
  --exclude='*-shm' \
  --relative \
  -- "${RSYNC_ITEMS[@]/#/$SOURCE_DIR/./}" "$HOST:$REMOTE_DIR/"

log "seed complete"
