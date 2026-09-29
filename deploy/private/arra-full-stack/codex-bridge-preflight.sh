#!/usr/bin/env bash
set -Eeuo pipefail

env_file="${ARRA_LLM_ENV_FILE:-/etc/arra-oracle/hermes.env}"
read_env() {
  local key="$1" file="$2"
  [[ -n "$file" && -r "$file" ]] || return 0
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

key="${CODEX_BRIDGE_KEY:-}"
url="${CODEX_CHAT_URL:-}"
model="${CODEX_MODEL:-}"
[[ -n "$key" ]] || key="$(read_env CODEX_BRIDGE_KEY "$env_file")"
[[ -n "$url" ]] || url="$(read_env CODEX_CHAT_URL "$env_file")"
[[ -n "$model" ]] || model="$(read_env CODEX_MODEL "$env_file")"
url="${url:-http://127.0.0.1:47781/v1/chat/completions}"
model="${model:-codex}"
[[ -n "$key" ]] || { echo "Codex bridge key is required for provider preflight" >&2; exit 2; }
[[ "$url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/v1/chat/completions$ ]] || { echo "Codex bridge preflight requires a loopback chat URL" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }

base="${url%/v1/chat/completions}"
headers="$(mktemp "${TMPDIR:-/tmp}/arra-codex-headers.XXXXXX")"
health_body="$(mktemp "${TMPDIR:-/tmp}/arra-codex-health.XXXXXX")"
models_body="$(mktemp "${TMPDIR:-/tmp}/arra-codex-models.XXXXXX")"
cleanup() { rm -f -- "$headers" "$health_body" "$models_body"; }
trap cleanup EXIT
chmod 600 "$headers" "$health_body" "$models_body"
printf 'Authorization: Bearer %s\n' "$key" > "$headers"
health_status="$(curl --silent --show-error --output "$health_body" --write-out '%{http_code}' --max-time 15 -H "@$headers" "$base/health")"
[[ "$health_status" == "200" ]] || { echo "Codex bridge health preflight failed: HTTP $health_status" >&2; exit 1; }
models_status="$(curl --silent --show-error --output "$models_body" --write-out '%{http_code}' --max-time 15 -H "@$headers" "$base/v1/models")"
[[ "$models_status" == "200" ]] || { echo "Codex bridge model preflight failed: HTTP $models_status" >&2; exit 1; }
MODEL_FILE="$models_body" EXPECTED_MODEL="$model" python3 - <<'PY'
import json, os
body = json.load(open(os.environ["MODEL_FILE"], encoding="utf-8"))
ids = {item.get("id") for item in body.get("data", []) if isinstance(item, dict)}
if os.environ["EXPECTED_MODEL"] not in ids:
    raise SystemExit(f"missing Codex bridge model: {os.environ['EXPECTED_MODEL']}")
PY
printf 'Codex bridge preflight ok: model=%s endpoint=loopback\n' "$model"
