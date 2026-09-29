#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
"$script_dir/health-gate.sh"
base="${ARRA_BASE_URL:-http://127.0.0.1:47778}"
token="${ARRA_API_TOKEN:-${ORACLE_MCP_HTTP_TOKEN:-}}"
[[ -n "$token" ]] || { echo "HTTP bearer token is required" >&2; exit 2; }
auth_config="$(mktemp "${TMPDIR:-/tmp}/arra-acceptance-auth.XXXXXX")"
tmp="$(mktemp "${TMPDIR:-/tmp}/arra-acceptance.XXXXXX")"
cleanup() { rm -f -- "$auth_config" "$tmp"; }
trap cleanup EXIT
chmod 600 "$auth_config"
printf 'header = "Authorization: Bearer %s"\n' "$token" > "$auth_config"

run_semantic="${ARRA_RUN_SEMANTIC_GATE:-1}"
curl --silent --show-error --fail --location --max-time 15 --config "$auth_config" "$base/api/v1/health" > "$tmp"
if [[ "$run_semantic" == "1" ]]; then
  bun -e 'const body=await Bun.file(process.argv[1]).json(); const vector=body.vector ?? body.subsystems?.vector; if (!vector || vector.status === "down") throw new Error("vector health is not available");' "$tmp"
fi

curl --silent --show-error --fail --location --max-time 15 --config "$auth_config" "$base/api/stats" > "$tmp"
bun -e 'const body=await Bun.file(process.argv[1]).json(); const count=Number(body.documents ?? body.total ?? body.stats?.documents ?? 0); if (!Number.isFinite(count) || count < 1) throw new Error("no indexed documents");' "$tmp"

if [[ "$run_semantic" == "1" ]]; then
  query="${ARRA_SEMANTIC_QUERY:-}"
  expected_source="${ARRA_EXPECTED_SOURCE:-}"
  semantic_provider="${ARRA_SEMANTIC_PROVIDER:-openai}"
  semantic_model="${ARRA_SEMANTIC_MODEL:-text-embedding-3-small}"
  [[ -n "$query" && -n "$expected_source" ]] || { echo "semantic gate requires ARRA_SEMANTIC_QUERY and ARRA_EXPECTED_SOURCE" >&2; exit 2; }
  curl --silent --show-error --fail --location --max-time 20 --config "$auth_config" "$base/api/vector/providers?force=1" > "$tmp"
  SEMANTIC_PROVIDER="$semantic_provider" SEMANTIC_MODEL="$semantic_model" bun -e 'const body=await Bun.file(process.argv[1]).json(); const provider=process.env.SEMANTIC_PROVIDER??""; const model=process.env.SEMANTIC_MODEL??""; const p=(body.providers??[]).find((item)=>item.type===provider || item.provider===provider); if (!p?.available || (model && !(p.models??[]).includes(model))) throw new Error(`${provider} embedding provider/model is not healthy`);' "$tmp"
  curl --silent --show-error --fail --location --max-time 20 --config "$auth_config" "$base/api/vector/stats" > "$tmp"
  bun -e 'const body=await Bun.file(process.argv[1]).json(); const rows=body.vectors??body.collections??[]; const values=Array.isArray(rows)?rows:Object.values(rows); const count=values.reduce((sum,item)=>sum+Number(item.count??item.documents??0),0); if (count < 1) throw new Error("no vector embeddings indexed");' "$tmp"
  encoded_query="$(QUERY="$query" bun -e 'console.log(encodeURIComponent(process.env.QUERY??""))')"
  curl --silent --show-error --fail --location --max-time 30 --config "$auth_config" "$base/api/vector/search?q=$encoded_query&limit=10" > "$tmp"
  EXPECTED_SOURCE="$expected_source" bun -e 'const body=await Bun.file(process.argv[1]).json(); const source=process.env.EXPECTED_SOURCE??""; const hits=body.results??[]; if (!hits.some((hit)=>String(hit.source_file??hit.source??"").includes(source))) throw new Error("paraphrased query missed expected vector source");' "$tmp"
fi

run_ask="${ARRA_RUN_ASK_GATE:-1}"
if [[ "$run_ask" == "1" ]]; then
  body='{"question":"Arra private deployment decision","llm":true,"limit":5}'
  curl --silent --show-error --fail --location --max-time 90 --config "$auth_config" -H 'content-type: application/json' -X POST --data "$body" "$base/api/ask" > "$tmp"
  bun -e 'const body=await Bun.file(process.argv[1]).json(); if (typeof body.answer!=="string") throw new Error("ask answer missing"); if (body.noEvidence!==true && (!Array.isArray(body.citations)||body.citations.length<1)) throw new Error("ask answer lacks grounded citations");' "$tmp"
  body='{"question":"What is the launch date of the imaginary Sapphire Hedgehog reactor ZX-9137?","llm":false,"limit":5}'
  curl --silent --show-error --fail --location --max-time 15 --config "$auth_config" -H 'content-type: application/json' -X POST --data "$body" "$base/api/ask" > "$tmp"
  bun -e 'const body=await Bun.file(process.argv[1]).json(); if (body.noEvidence!==true || !Array.isArray(body.citations) || body.citations.length!==0) throw new Error("unrelated ask returned unsupported evidence");' "$tmp"
fi

if [[ "$run_semantic" == "1" ]]; then
  echo "acceptance gate ok: vector health, indexed corpus, semantic retrieval, cited ask, no-evidence fallback"
else
  echo "acceptance gate ok: FTS health, indexed corpus, cited ask, no-evidence fallback; semantic gate disabled"
fi
