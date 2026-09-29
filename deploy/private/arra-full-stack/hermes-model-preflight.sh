#!/usr/bin/env bash
set -Eeuo pipefail

env_file="${ARRA_LLM_ENV_FILE:-/etc/arra-oracle/hermes.env}"
read_env() {
  local key="$1" file="$2"
  [[ -n "$file" && -r "$file" ]] || return 0
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

key="${HERMES_API_KEY:-}"
model="${HERMES_MODEL:-}"
url="${HERMES_CHAT_URL:-}"
[[ -n "$key" ]] || key="$(read_env HERMES_API_KEY "$env_file")"
[[ -n "$model" ]] || model="$(read_env HERMES_MODEL "$env_file")"
[[ -n "$url" ]] || url="$(read_env HERMES_CHAT_URL "$env_file")"
url="${url:-http://127.0.0.1:8642/v1/chat/completions}"
[[ -n "$key" && -n "$model" ]] || { echo "Hermes API key and model are required for provider preflight" >&2; exit 2; }
[[ "$url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/v1/chat/completions$ ]] || { echo "Hermes provider preflight requires a loopback chat URL" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v bun >/dev/null || { echo "bun is required" >&2; exit 2; }

base="${url%/v1/chat/completions}"
headers="$(mktemp "${TMPDIR:-/tmp}/arra-hermes-headers.XXXXXX")"
health_body="$(mktemp "${TMPDIR:-/tmp}/arra-hermes-health.XXXXXX")"
models_body="$(mktemp "${TMPDIR:-/tmp}/arra-hermes-models.XXXXXX")"
cleanup() { rm -f -- "$headers" "$health_body" "$models_body"; }
trap cleanup EXIT
chmod 600 "$headers" "$health_body" "$models_body"
printf 'Authorization: Bearer %s\n' "$key" > "$headers"
health_status="$(curl --silent --show-error --output "$health_body" --write-out '%{http_code}' --max-time 15 -H "@$headers" "$base/health")"
[[ "$health_status" == "200" ]] || { echo "Hermes health preflight failed: HTTP $health_status" >&2; exit 1; }
models_status="$(curl --silent --show-error --output "$models_body" --write-out '%{http_code}' --max-time 15 -H "@$headers" "$base/v1/models")"
[[ "$models_status" == "200" ]] || { echo "Hermes model preflight failed: HTTP $models_status" >&2; exit 1; }
bun -e 'const file=process.argv[1], wanted=process.argv[2]; const body=await Bun.file(file).json(); const ids=new Set((body.data??[]).map((item)=>item?.id).filter(Boolean)); if (!ids.has(wanted)) { console.error(`missing Hermes model: ${wanted}`); process.exit(1); }' "$models_body" "$model"
printf 'Hermes provider preflight ok: model=%s endpoint=loopback\n' "$model"
