#!/usr/bin/env bash
# Verify a public Arra endpoint behaves for read clients and gates writes.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/verify-remote.sh <url> [token]

Checks:
  GET  /api/health       returns 200
  GET  /api/stats        returns JSON with a positive-ish document count when available
  GET  /api/search       returns JSON and at least one result for a sample query
  POST /api/learn        returns 401/403 without a token (write must be gated)
  POST /api/learn        with token, if supplied, must not return 401/403

Env:
  ORACLE_API             URL fallback when <url> is omitted
  ORACLE_TOKEN           token fallback when [token] is omitted
  ORACLE_VERIFY_QUERY    search query (default: oracle)
  ORACLE_TOKEN_HEADER    token header for writes (default: x-oracle-token)
USAGE
}

log() { printf '[verify-remote] %s\n' "$*" >&2; }
fail() { printf '[verify-remote] ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"; }

if [[ "${1:-}" == '-h' || "${1:-}" == '--help' ]]; then usage; exit 0; fi

BASE="${1:-${ORACLE_API:-}}"
TOKEN="${2:-${ORACLE_TOKEN:-}}"
QUERY="${ORACLE_VERIFY_QUERY:-oracle}"
TOKEN_HEADER="${ORACLE_TOKEN_HEADER:-x-oracle-token}"
[[ -n "$BASE" ]] || { usage; fail 'url argument or ORACLE_API is required'; }
BASE="${BASE%/}"
need curl
need jq
need python3

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl_json() {
  local name="$1"; shift
  local body="$TMP_DIR/$name.body"
  local status
  status=$(curl -sS -o "$body" -w '%{http_code}' "$@") || fail "curl failed for $name"
  printf '%s %s\n' "$status" "$body"
}

read -r HEALTH_STATUS HEALTH_BODY < <(curl_json health "$BASE/api/health")
[[ "$HEALTH_STATUS" == '200' ]] || fail "health returned $HEALTH_STATUS: $(cat "$HEALTH_BODY")"
jq -e . "$HEALTH_BODY" >/dev/null || fail 'health did not return JSON'
log "health ok"

read -r STATS_STATUS STATS_BODY < <(curl_json stats "$BASE/api/stats")
[[ "$STATS_STATUS" == '200' ]] || fail "stats returned $STATS_STATUS: $(cat "$STATS_BODY")"
jq -e . "$STATS_BODY" >/dev/null || fail 'stats did not return JSON'
DOC_COUNT=$(jq -r '(.totalDocuments // .total // .documents // .count // .stats.totalDocuments // .stats.total // empty)' "$STATS_BODY")
if [[ -n "$DOC_COUNT" && "$DOC_COUNT" =~ ^[0-9]+$ ]]; then
  [[ "$DOC_COUNT" -gt 0 ]] || fail "stats document count is not positive: $DOC_COUNT"
  log "stats ok: documents=$DOC_COUNT"
elif [[ -n "$DOC_COUNT" ]]; then
  log "stats ok: non-numeric document count field: $DOC_COUNT"
else
  log "stats ok: document count field not found"
fi

SEARCH_URL="$BASE/api/search?q=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$QUERY")&limit=5"
read -r SEARCH_STATUS SEARCH_BODY < <(curl_json search "$SEARCH_URL")
[[ "$SEARCH_STATUS" == '200' ]] || fail "search returned $SEARCH_STATUS: $(cat "$SEARCH_BODY")"
jq -e . "$SEARCH_BODY" >/dev/null || fail 'search did not return JSON'
RESULT_COUNT=$(jq -r '(.results // .items // .data // []) | length' "$SEARCH_BODY")
[[ "$RESULT_COUNT" =~ ^[0-9]+$ ]] || fail 'search result count not parseable'
[[ "$RESULT_COUNT" -gt 0 ]] || fail "search returned zero results for query '$QUERY'"
log "search ok: query='$QUERY' results=$RESULT_COUNT"

# Intentionally invalid body: an authenticated request should reach the handler
# and return 400 without creating a learning; an unauthenticated request must be
# rejected earlier by the public token gate.
LEARN_PAYLOAD='{}'
read -r WRITE_STATUS WRITE_BODY < <(curl_json write_no_token -X POST -H 'content-type: application/json' --data "$LEARN_PAYLOAD" "$BASE/api/learn")
case "$WRITE_STATUS" in
  401|403) log "write gate ok: unauthenticated POST /api/learn returned $WRITE_STATUS" ;;
  *) fail "write endpoint is not token-gated; unauthenticated POST /api/learn returned $WRITE_STATUS: $(cat "$WRITE_BODY")" ;;
esac

if [[ -n "$TOKEN" ]]; then
  read -r AUTH_STATUS AUTH_BODY < <(curl_json write_token -X POST -H 'content-type: application/json' -H "$TOKEN_HEADER: $TOKEN" -H "authorization: Bearer $TOKEN" --data "$LEARN_PAYLOAD" "$BASE/api/learn")
  case "$AUTH_STATUS" in
    401|403) fail "token was rejected by POST /api/learn ($AUTH_STATUS): $(cat "$AUTH_BODY")" ;;
    2*|400|409|422) log "token path reached write handler: status=$AUTH_STATUS" ;;
    *) fail "unexpected token write status $AUTH_STATUS: $(cat "$AUTH_BODY")" ;;
  esac
else
  log "no token supplied; skipped authenticated write probe"
fi

printf '{"ok":true,"url":"%s","documents":"%s","searchResults":%s,"writeWithoutToken":%s}\n' "$BASE" "$DOC_COUNT" "$RESULT_COUNT" "$WRITE_STATUS"
