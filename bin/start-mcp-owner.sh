#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN_BIN="${ARRA_BUN_BIN:-}"
if [[ -z "$BUN_BIN" ]]; then
  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
  elif [[ -x "$HOME/.bun/bin/bun" ]]; then
    BUN_BIN="$HOME/.bun/bin/bun"
  else
    echo "Oracle owner launcher: bun not found" >&2
    exit 127
  fi
fi

export ORACLE_PROFILE=owner
export ORACLE_READ_ONLY=false
export ORACLE_HTTP_URL="${ORACLE_HTTP_URL:-http://127.0.0.1:47778}"
export ORACLE_DATA_DIR="${ORACLE_DATA_DIR:-$HOME/.arra-oracle-v2}"
export ORACLE_VECTOR_DB="${ORACLE_VECTOR_DB:-lancedb}"
export ORACLE_LANCEDB_PATH="${ORACLE_LANCEDB_PATH:-$ORACLE_DATA_DIR/lancedb}"
export ORACLE_EMBEDDING_MODEL="${ORACLE_EMBEDDING_MODEL:-bge-m3}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export ORACLE_TOOL_GROUPS_HOT_RELOAD="${ORACLE_TOOL_GROUPS_HOT_RELOAD:-0}"
unset ORACLE_REMOTE_WRITE_URL

exec "$BUN_BIN" "$ROOT/bin/mcp.ts" "$@"
