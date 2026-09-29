#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "usage: $0 --data-dir DIR --recipient AGE_RECIPIENT --authority-stopped [--output FILE] [--vector PATH] [--vector-config FILE] --corpus-manifest JSON [--source-root NAME=DIR ...]"
}

data_dir="${ORACLE_DATA_DIR:-}"
recipient="${AGE_RECIPIENT:-}"
output=""
vector_path="${ORACLE_VECTOR_DB_PATH:-}"
vector_config=""
corpus_manifest=""
authority_stopped="${ARRA_AUTHORITY_STOPPED:-0}"
authority_pids=()
source_roots=()
while (($#)); do
  case "$1" in
    --data-dir) data_dir="${2:?}"; shift 2 ;;
    --recipient) recipient="${2:?}"; shift 2 ;;
    --output) output="${2:?}"; shift 2 ;;
    --vector) vector_path="${2:?}"; shift 2 ;;
    --vector-config) vector_config="${2:?}"; shift 2 ;;
    --corpus-manifest) corpus_manifest="${2:?}"; shift 2 ;;
    --authority-stopped) authority_stopped=1; shift ;;
    --authority-pid) authority_pids+=("${2:?}"); shift 2 ;;
    --source-root) source_roots+=("${2:?}"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$data_dir" && -d "$data_dir" ]] || { echo "data directory is required and must exist" >&2; exit 2; }
[[ -n "$recipient" ]] || { echo "age recipient is required" >&2; exit 2; }
[[ "$authority_stopped" == "1" ]] || { echo "refusing live backup: stop all Arra/vector writers and pass --authority-stopped" >&2; exit 2; }
for pid in "${authority_pids[@]}"; do kill -0 "$pid" 2>/dev/null && { echo "authority writer is still alive: pid=$pid" >&2; exit 2; } || true; done
command -v age >/dev/null || { echo "age is required" >&2; exit 2; }
command -v tar >/dev/null || { echo "tar is required" >&2; exit 2; }
command -v bun >/dev/null || { echo "bun is required for SQLite checkpoint" >&2; exit 2; }

db_path="${ORACLE_DB_PATH:-$data_dir/oracle.db}"
[[ -f "$db_path" ]] || { echo "database not found: $db_path" >&2; exit 2; }
[[ -n "${ARRA_PINNED_COMMIT:-}" && "${ARRA_PINNED_COMMIT}" =~ ^[0-9a-fA-F]{40}$ ]] || { echo "ARRA_PINNED_COMMIT must be a full 40-hex commit" >&2; exit 2; }
if [[ -z "$vector_path" ]]; then vector_path="$data_dir/vectors.db"; fi
if [[ -z "$vector_config" ]]; then vector_config="$data_dir/vector-server.json"; fi
if [[ -z "$output" ]]; then output="$data_dir/backups/arra-private-$(date -u +%Y%m%dT%H%M%SZ).age"; fi
[[ -n "$corpus_manifest" && -f "$corpus_manifest" ]] || { echo "curated JSON corpus manifest is required" >&2; exit 2; }
[[ ! -e "$output" ]] || { echo "refusing to overwrite existing backup: $output" >&2; exit 2; }

stage="$(mktemp -d "${TMPDIR:-/tmp}/arra-private-backup.XXXXXX")"
archive="$stage/archive.tar.gz"
cleanup() { rm -r -- "$stage"; }
trap cleanup EXIT
mkdir -p "$stage/data" "$stage/vector" "$stage/deployment"

BACKUP_DB_PATH="$db_path" bun -e 'const { Database } = await import("bun:sqlite"); const db = new Database(process.env.BACKUP_DB_PATH); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close();'
cp -- "$db_path" "$stage/data/oracle.db"
for sidecar in "$db_path-wal" "$db_path-shm"; do [[ -e "$sidecar" ]] && cp -- "$sidecar" "$stage/data/"; done
if [[ -e "$vector_path" ]]; then
  if [[ -d "$vector_path" ]]; then cp -R -- "$vector_path" "$stage/vector/"; else cp -- "$vector_path" "$stage/vector/"; fi
fi
[[ -e "$vector_path" ]] || { echo "vector database/state is required for private full-stack backup: $vector_path" >&2; exit 2; }
for sidecar in "$vector_path-wal" "$vector_path-shm"; do
  [[ -e "$sidecar" ]] && cp -- "$sidecar" "$stage/vector/"
done
if [[ -e "$vector_config" ]]; then
  [[ -f "$vector_config" && ! -L "$vector_config" ]] || { echo "vector config must be a regular file: $vector_config" >&2; exit 2; }
  cp -- "$vector_config" "$stage/deployment/vector-server.json"
fi
[[ -f "$stage/deployment/vector-server.json" ]] || { echo "vector config is required for private full-stack backup: $vector_config" >&2; exit 2; }
cp -- "$corpus_manifest" "$stage/deployment/corpus.manifest.json"
cp -- "$(dirname "$0")/compose.private.yml" "$(dirname "$0")/compose.embeddings.yml" \
  "$(dirname "$0")/runtime.env.example" "$stage/deployment/"
mkdir -p "$stage/corpus"
source_args=()
for root in "${source_roots[@]}"; do source_args+=(--root "$root"); done
bun "$(dirname "$0")/corpus-snapshot.ts" --manifest "$corpus_manifest" --dest "$stage/corpus" "${source_args[@]}"
bun "$(dirname "$0")/corpus-coverage.ts" --db "$db_path" --snapshot "$stage/corpus/snapshot-manifest.json" --output "$stage/deployment/source-coverage.json"
printf '{"commit":"%s","db":"oracle.db","vector":"%s","vectorConfig":"%s","corpus":"corpus","authorityQuiesced":true,"secretIncluded":false}\n' \
  "$ARRA_PINNED_COMMIT" "$(basename "$vector_path")" "$(basename "$vector_config")" > "$stage/deployment/backup-manifest.json"

hash_file() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }
 (cd "$stage" && find data vector deployment corpus -type f -print0 | sort -z | while IFS= read -r -d '' file; do hash_file "$file" | sed "s#  $file#  ${file#./}#"; done) > "$stage/checksums.sha256"
tar -C "$stage" -czf "$archive" data vector deployment corpus checksums.sha256
mkdir -p "$(dirname "$output")"
tmp_output="$(mktemp "$(dirname "$output")/.arra-private-backup.XXXXXX")"
rm -f -- "$tmp_output"
cleanup_output() { rm -f -- "$tmp_output"; }
trap 'cleanup; cleanup_output' EXIT
age -r "$recipient" -o "$tmp_output" "$archive"
chmod 600 "$tmp_output"
mv -- "$tmp_output" "$output"
[[ -s "$output" ]] || { echo "encrypted backup was empty" >&2; exit 1; }
echo "encrypted backup created: $output (quiesced, atomic)"
