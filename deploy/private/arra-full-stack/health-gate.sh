#!/usr/bin/env bash
set -Eeuo pipefail

base="${ARRA_BASE_URL:-http://127.0.0.1:47778}"
adapter="${ARRA_LLM_ADAPTER_URL:-http://127.0.0.1:47779}"
token="${ARRA_API_TOKEN:-${ORACLE_MCP_HTTP_TOKEN:-}}"
[[ -n "$token" ]] || { echo "ARRA_API_TOKEN or ORACLE_MCP_HTTP_TOKEN is required in the gate environment" >&2; exit 2; }
mcp_token="${ORACLE_MCP_HTTP_TOKEN:-$token}"
auth_config="$(mktemp "${TMPDIR:-/tmp}/arra-health-auth.XXXXXX")"
wrong_config="$(mktemp "${TMPDIR:-/tmp}/arra-health-wrong.XXXXXX")"
mcp_config="$(mktemp "${TMPDIR:-/tmp}/arra-health-mcp.XXXXXX")"
cleanup() { rm -f -- "$auth_config" "$wrong_config" "$mcp_config"; }
trap cleanup EXIT
chmod 600 "$auth_config" "$wrong_config" "$mcp_config"
printf 'header = "Authorization: Bearer %s"\n' "$token" > "$auth_config"
printf 'header = "Authorization: Bearer wrong-private-gate-token"\n' > "$wrong_config"
printf 'header = "Authorization: Bearer %s"\n' "$mcp_token" > "$mcp_config"

status() { curl --silent --show-error --location --output /dev/null --max-time 10 --write-out '%{http_code}' "$@"; }
expect_status() {
  local expected="$1"; shift
  local actual; actual="$(status "$@")"
  [[ "$actual" == "$expected" ]] || { echo "gate failed: expected HTTP $expected, got $actual" >&2; exit 1; }
}
expect_status 200 "$base/api/health"
expect_status 200 "$adapter/health"
expect_status 401 "$base/api/search?q=private-gate"
expect_status 401 --config "$wrong_config" "$base/api/search?q=private-gate"
expect_status 200 --config "$auth_config" "$base/api/search?q=private-gate"
docs="$(curl --silent --show-error --fail --location --max-time 10 --config "$auth_config" "$base/api/docs/json")"
OPENAPI_BODY="$docs" bun -e 'const spec=JSON.parse(process.env.OPENAPI_BODY??"{}"); if (typeof spec.openapi!=="string" || !spec.paths?.["/api/search"] || spec.error || spec.success===false) throw new Error("OpenAPI response is not a valid authenticated specification");'

plugin_health="$(curl --silent --show-error --fail --location --max-time 10 --config "$auth_config" "$base/api/health")"
PLUGIN_HEALTH="$plugin_health" bun -e '
  const body = JSON.parse(process.env.PLUGIN_HEALTH ?? "{}");
  const plugins = body.data?.plugins ?? body.plugins;
  const items = Array.isArray(plugins?.items) ? plugins.items : [];
  const names = new Set(items.map((item) => String(item.name ?? "")));
  for (const required of ["arra", "oracle-dig"]) if (!names.has(required)) throw new Error(`required private plugin missing from health: ${required}`);
'

expect_status 401 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "$base/mcp"
mcp="$(curl --silent --show-error --fail --location --max-time 15 --config "$mcp_config" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -X POST --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"private-health-gate","version":"1"}}}' "$base/mcp")"
MCP_BODY="$mcp" bun -e '
  const raw=process.env.MCP_BODY??"";
  const frames=raw.trimStart().startsWith("{") ? [raw] : raw.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trim());
  let message;
  for (const frame of frames) { try { const parsed=JSON.parse(frame); if(parsed.jsonrpc==="2.0" && parsed.id===1) message=parsed; } catch {} }
  const result=message?.result;
  if (message?.error || typeof result?.protocolVersion!=="string" || !result?.capabilities || typeof result?.serverInfo?.name!=="string") throw new Error("MCP initialize returned no valid result");
'

echo "health gate ok: health, adapter, HTTP/MCP auth negatives/positives, plugins, docs"
