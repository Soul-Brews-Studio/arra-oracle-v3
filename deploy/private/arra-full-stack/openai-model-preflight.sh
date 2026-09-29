#!/usr/bin/env bash
set -Eeuo pipefail

env_file="${ARRA_OPENAI_ENV_FILE:-${ARRA_PRIVATE_ENV_FILE:-}}"
read_env() {
  local key="$1" file="$2"
  [[ -n "$file" && -r "$file" ]] || return 0
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

key="${OPENAI_API_KEY:-}"
model="${OPENAI_CHAT_MODEL:-}"
if [[ -n "$env_file" ]]; then
  [[ -n "$key" ]] || key="$(read_env OPENAI_API_KEY "$env_file")"
  [[ -n "$model" ]] || model="$(read_env OPENAI_CHAT_MODEL "$env_file")"
fi
embedding_model="${OPENAI_EMBEDDING_MODEL:-text-embedding-3-small}"
base="${OPENAI_API_BASE:-https://api.openai.com/v1}"
[[ "$base" == "https://api.openai.com/v1" ]] || { echo "private preflight only permits https://api.openai.com/v1" >&2; exit 1; }
[[ -n "$key" && -n "$model" ]] || { echo "OpenAI key and chat model are required for model preflight" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v bun >/dev/null || { echo "bun is required" >&2; exit 2; }

headers="$(mktemp "${TMPDIR:-/tmp}/arra-openai-headers.XXXXXX")"
body="$(mktemp "${TMPDIR:-/tmp}/arra-openai-models.XXXXXX")"
cleanup() { rm -f -- "$headers" "$body"; }
trap cleanup EXIT
chmod 600 "$headers" "$body"
printf 'Authorization: Bearer %s\n' "$key" > "$headers"
status="$(curl --silent --show-error --output "$body" --write-out '%{http_code}' --max-time 20 -H "@$headers" "$base/models")"
[[ "$status" == "200" ]] || { echo "OpenAI model preflight failed: HTTP $status" >&2; exit 1; }
bun -e 'const file=process.argv[1], chat=process.argv[2], embed=process.argv[3]; const body=await Bun.file(file).json(); const ids=new Set((body.data??[]).map((item)=>item?.id).filter(Boolean)); for (const [label,id] of [["chat",chat],["embedding",embed]]) if (!ids.has(id)) { console.error(`missing ${label} model: ${id}`); process.exit(1); }' "$body" "$model" "$embedding_model"
printf 'OpenAI model preflight ok: chat=%s embedding=%s\n' "$model" "$embedding_model"
