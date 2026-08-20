#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN_BIN="${ARRA_BUN_BIN:-}"

if [[ -z "$BUN_BIN" ]]; then
  BUN_BIN="$(command -v bun || true)"
fi
if [[ -z "$BUN_BIN" && -x "${HOME:-}/.bun/bin/bun" ]]; then
  BUN_BIN="${HOME}/.bun/bin/bun"
fi
if [[ -z "$BUN_BIN" || ! -x "$BUN_BIN" ]]; then
  echo "Arra MCP launcher: Bun executable not found" >&2
  exit 1
fi

ORACLE_DATA_DIR="${ORACLE_DATA_DIR:-${HOME}/.arra-oracle-v2}"
export ORACLE_DATA_DIR
export ORACLE_READ_ONLY=true

# Delegates own no memory and receive no remote-write route. Read-mostly seats
# retain the single bounded owner-core exception implemented by Oracle itself.
if [[ "${ORACLE_PROFILE:-}" == "delegate" ]]; then
  unset ORACLE_REMOTE_WRITE_URL
  unset ORACLE_HTTP_URL
  unset ORACLE_API
  unset NEO_ARRA_API
else
  export ORACLE_REMOTE_WRITE_URL="${ORACLE_REMOTE_WRITE_URL:-http://127.0.0.1:47778}"
fi

export ORACLE_VECTOR_DB="${ORACLE_VECTOR_DB:-lancedb}"
export ORACLE_VECTOR_DB_PATH="${ORACLE_VECTOR_DB_PATH:-$ORACLE_DATA_DIR/lancedb}"
export ORACLE_EMBEDDER="${ORACLE_EMBEDDER:-ollama}"
export ORACLE_EMBEDDING_MODEL="${ORACLE_EMBEDDING_MODEL:-bge-m3}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export ORACLE_TOOL_GROUPS_HOT_RELOAD="${ORACLE_TOOL_GROUPS_HOT_RELOAD:-0}"
export ARRA_PLUGIN_HOT_RELOAD="${ARRA_PLUGIN_HOT_RELOAD:-0}"

exec "$BUN_BIN" "$ROOT/bin/mcp.ts"
