#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "usage: $0 --target RESTORE_DIR --repo ARRA_REPO [--port PORT] [--require-vector --embedding-env FILE --vector-query QUERY --expected-source SOURCE] (--openai-env remains supported)"
}

target=""; repo=""; port="48778"; require_vector=0; openai_env=""; vector_query=""; expected_source=""
while (($#)); do
  case "$1" in
    --target) target="${2:?}"; shift 2 ;;
    --repo) repo="${2:?}"; shift 2 ;;
    --port) port="${2:?}"; shift 2 ;;
    --require-vector) require_vector=1; shift ;;
    --openai-env|--embedding-env) openai_env="${2:?}"; shift 2 ;;
    --vector-query) vector_query="${2:?}"; shift 2 ;;
    --expected-source) expected_source="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -d "$target" && -f "$target/data/oracle.db" ]] || { echo "verified restore target is required" >&2; exit 2; }
[[ -d "$repo" && -f "$repo/package.json" ]] || { echo "Arra repo is required" >&2; exit 2; }
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1024 && "$port" -le 65535 ]] || { echo "restore port must be 1024..65535" >&2; exit 2; }
command -v bun >/dev/null || { echo "bun is required" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
if command -v lsof >/dev/null && lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q .; then
  echo "restore port is already occupied: $port" >&2
  exit 2
fi

backup_commit="$(MANIFEST="$target/deployment/backup-manifest.json" bun -e 'const m=await Bun.file(process.env.MANIFEST).json(); process.stdout.write(String(m.commit ?? ""));')"
actual_commit="$(git -C "$repo" rev-parse HEAD)"
[[ "$backup_commit" =~ ^[0-9a-fA-F]{40}$ && "$backup_commit" == "$actual_commit" ]] || {
  echo "restore commit mismatch: archive=$backup_commit repo=$actual_commit" >&2
  exit 1
}

if [[ "$require_vector" == "1" ]]; then
  source "$(dirname "$0")/restore-embedding-env.sh"
  load_restore_embedding_env "$openai_env"
  vector_query="${vector_query:-${ARRA_SEMANTIC_QUERY:-}}"
  expected_source="${expected_source:-${ARRA_EXPECTED_SOURCE:-}}"
  [[ -n "$vector_query" && -n "$expected_source" ]] || { echo "--require-vector needs --vector-query and --expected-source" >&2; exit 2; }
fi

run_root="$(mktemp -d "${TMPDIR:-/tmp}/arra-isolated-restore.XXXXXX")"
run_data="$run_root/data"
runtime_repo="$run_root/runtime-repo"
run_home="$run_root/home"
log="$(mktemp "${TMPDIR:-/tmp}/arra-restore-service.XXXXXX")"
auth="$(mktemp "${TMPDIR:-/tmp}/arra-restore-http-auth.XXXXXX")"
mcp_auth="$(mktemp "${TMPDIR:-/tmp}/arra-restore-mcp-auth.XXXXXX")"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf -- "$run_root" "$log" "$auth" "$mcp_auth"
}
trap cleanup EXIT
mkdir -p "$run_data" "$run_home" "$runtime_repo"
chmod 700 "$run_root" "$run_home"
chmod 600 "$auth" "$mcp_auth"
api_token="$(openssl rand -hex 24 2>/dev/null || bun -e 'console.log(Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join(""))')"
mcp_token="$(openssl rand -hex 24 2>/dev/null || bun -e 'console.log(Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join(""))')"
printf 'header = "Authorization: Bearer %s"\n' "$api_token" > "$auth"
printf 'header = "Authorization: Bearer %s"\n' "$mcp_token" > "$mcp_auth"
cp -a "$target/data/." "$run_data/"

# Reconstruct every allowlisted source under the isolated restore root. The
# server is pointed at this snapshot, never at the live checkout's corpus.
for source in repo arra mac-setup mint; do
  if [[ -d "$target/corpus/$source" ]]; then
    mkdir -p "$run_root/corpus/$source"
    cp -a "$target/corpus/$source/." "$run_root/corpus/$source/"
  fi
done
[[ -d "$run_root/corpus/repo" ]] || { echo "restored repo corpus is missing" >&2; exit 1; }
if find "$run_root/corpus" -type l -print -quit | grep -q .; then
  echo "restore corpus contains a symlink" >&2
  exit 1
fi
# Merge the allowlisted source roots into an isolated read root. Conflicting
# paths must be byte-identical; otherwise the snapshot is ambiguous.
for source in repo arra mac-setup mint; do
  if [[ -d "$run_root/corpus/$source" ]]; then
    while IFS= read -r -d '' file; do
      relative_path="${file#"$run_root/corpus/$source/"}"
      destination="$runtime_repo/$relative_path"
      mkdir -p "$(dirname "$destination")"
      if [[ -e "$destination" ]] && ! cmp -s "$file" "$destination"; then
        echo "restored corpus has conflicting source paths: $relative_path" >&2
        exit 1
      fi
      [[ -e "$destination" ]] || cp -- "$file" "$destination"
    done < <(find "$run_root/corpus/$source" -type f -print0)
  fi
done
SOURCE_COVERAGE="$target/deployment/source-coverage.json" RESTORE_CORPUS="$run_root/corpus" RESTORE_DB="$run_data/oracle.db" RUNTIME_ROOT="$runtime_repo" bun -e '
  const crypto = await import("node:crypto");
  const coverage = await Bun.file(process.env.SOURCE_COVERAGE).json();
  if (coverage.covered !== true || !Array.isArray(coverage.files) || !Array.isArray(coverage.documents) || coverage.uncovered?.length) throw new Error("source coverage is not complete");
  for (const file of coverage.files) {
    const path = `${process.env.RESTORE_CORPUS}/${file.source}/${file.relativePath}`;
    const bytes = await Bun.file(path).arrayBuffer();
    const hash = crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    if (hash !== file.sha256 || bytes.byteLength !== file.bytes) throw new Error(`restored source hash mismatch: ${file.sourceFile}`);
  }
  const { Database } = await import("bun:sqlite");
  const db = new Database(process.env.RESTORE_DB, { readonly: true });
  for (const file of coverage.documents) {
    const row = db.query("SELECT content FROM oracle_fts WHERE id = ?").get(file.id) as { content?: unknown } | undefined;
    if (typeof row?.content !== "string") throw new Error(`restored FTS content missing: ${file.id}`);
    const content = Buffer.from(row.content, "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    if (hash !== file.contentSha256 || content.byteLength !== file.contentBytes) throw new Error(`restored FTS content hash mismatch: ${file.id}`);
  }
  db.close();
'

if [[ -d "$target/vector" ]]; then
  find "$target/vector" -maxdepth 1 -type f -exec cp -- {} "$run_data/" \;
fi
[[ -f "$run_data/vectors.db" ]] || { echo "restored vector database is missing" >&2; exit 1; }
VECTOR_SOURCE="$target/deployment/vector-server.json" VECTOR_TARGET="$run_data/vector-server.json" VECTOR_DB="$run_data/vectors.db" bun -e '
  const source = await Bun.file(process.env.VECTOR_SOURCE).json();
  const db = process.env.VECTOR_DB;
  source.dataPath = db;
  for (const collection of Object.values(source.collections ?? {})) if (collection && typeof collection === "object") collection.dataPath = db;
  source.host = "127.0.0.1";
  await Bun.write(process.env.VECTOR_TARGET, JSON.stringify(source, null, 2) + "\n");
'

server_env=(
  "HOME=$run_home" "PATH=${PATH:-/usr/bin:/bin}" "ORACLE_DATA_DIR=$run_data"
  "ORACLE_DB_PATH=$run_data/oracle.db" "ORACLE_VECTOR_DB_PATH=$run_data/vectors.db"
  "ORACLE_VECTOR_CONFIG_PATH=$run_data/vector-server.json" "ORACLE_REPO_ROOT=$runtime_repo"
  "ORACLE_PRIVATE_PLUGIN_ROOT=$repo/src/plugins" "ORACLE_PLUGIN_HOME=$repo/src/plugins"
  "ORACLE_DIG_SESSION_ROOT=$run_data/arra-session" "ORACLE_PRIVATE_DEPLOYMENT=1"
  "ORACLE_BIND_HOST=127.0.0.1" "ARRA_API_TOKEN=$api_token" "ORACLE_MCP_HTTP_TOKEN=$mcp_token"
  "ORACLE_PORT=$port" "PORT=$port" "ARRA_ENV=staging" "ORACLE_VECTOR_DB=sqlite-vec"
  "ORACLE_FILE_WATCHER=0" "ORACLE_CONSOLIDATION_WORKER=0" "ORACLE_ENTITY_BACKFILL=0"
  "ORACLE_ASK_LLM=0" "ORACLE_CONSOLIDATION_LLM=0"
)
if [[ "$require_vector" == "1" ]]; then
  server_env+=("${restore_embedding_env[@]}")
else
  server_env+=("ORACLE_EMBEDDER=none" "VECTOR_FALLBACK=fts5")
fi

start_server() {
  (cd "$repo" && env -i "${server_env[@]}" bun src/server.ts) >"$log" 2>&1 &
  pid=$!
}
wait_for_healthy() {
  for _ in {1..60}; do
    if curl --silent --show-error --fail --location --max-time 2 "http://127.0.0.1:${port}/api/health" --config "$auth" > /dev/null; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "restored service exited before health" >&2
      tail -n 60 "$log" >&2
      return 1
    fi
    sleep 1
  done
  echo "restored service did not become healthy" >&2
  tail -n 60 "$log" >&2
  return 1
}

start_server
wait_for_healthy
stats="$(curl --silent --show-error --fail --location --max-time 5 "http://127.0.0.1:${port}/api/stats" --config "$auth")"
STATS="$stats" bun -e 'const body=JSON.parse(process.env.STATS); const count=Number(body.documents ?? body.total ?? body.stats?.documents ?? 0); if (!Number.isFinite(count) || count < 1) throw new Error("restored service has no documents");'
id="$(RESTORE_DB="$run_data/oracle.db" bun -e 'const { Database } = await import("bun:sqlite"); const db = new Database(process.env.RESTORE_DB, { readonly: true }); console.log(db.query("SELECT id FROM oracle_documents ORDER BY rowid LIMIT 1").get()?.id ?? ""); db.close();')"
[[ -n "$id" ]] || { echo "restored database has no readable document id" >&2; exit 1; }
encoded_id="$(ID="$id" bun -e 'console.log(encodeURIComponent(process.env.ID ?? ""))')"
read_body="$(curl --silent --show-error --fail --location --max-time 5 "http://127.0.0.1:${port}/api/read?id=${encoded_id}" --config "$auth")"
READ_BODY="$read_body" bun -e 'const body=JSON.parse(process.env.READ_BODY); if (typeof body.content !== "string" || !body.content.trim()) throw new Error("restored read is empty");'
query="$(RESTORE_DB="$run_data/oracle.db" bun -e 'const { Database } = await import("bun:sqlite"); const db = new Database(process.env.RESTORE_DB, { readonly: true }); const row=db.query("SELECT content FROM oracle_fts ORDER BY rowid LIMIT 1").get(); console.log(String(row?.content ?? "restore-gate").split(/\s+/).slice(0,3).join(" ")); db.close();')"
encoded="$(QUERY="$query" bun -e 'console.log(encodeURIComponent(process.env.QUERY ?? ""))')"
search="$(curl --silent --show-error --fail --location --max-time 5 "http://127.0.0.1:${port}/api/search?q=${encoded}&mode=fts" --config "$auth")"
SEARCH="$search" bun -e 'const body=JSON.parse(process.env.SEARCH); if (!Array.isArray(body.results) || body.results.length < 1) throw new Error("restored FTS search is empty");'

vector_stats="$(curl --silent --show-error --fail --location --max-time 10 "http://127.0.0.1:${port}/api/vector/stats" --config "$auth")"
if [[ "$require_vector" == "1" ]]; then
  VECTOR_STATS="$vector_stats" bun -e 'const body=JSON.parse(process.env.VECTOR_STATS); const rows=body.vectors??body.collections??[]; const values=Array.isArray(rows)?rows:Object.values(rows); const count=values.reduce((sum,item)=>sum+Number(item.count??item.documents??0),0); if (count < 1) throw new Error("restored vector stats has no embeddings");'
  encoded_query="$(QUERY="$vector_query" bun -e 'console.log(encodeURIComponent(process.env.QUERY ?? ""))')"
  vector_search="$(curl --silent --show-error --fail --location --max-time 120 "http://127.0.0.1:${port}/api/vector/search?q=${encoded_query}&limit=10" --config "$auth")"
  EXPECTED_SOURCE="$expected_source" VECTOR_SEARCH="$vector_search" bun -e 'const body=JSON.parse(process.env.VECTOR_SEARCH); const source=process.env.EXPECTED_SOURCE??""; const hits=body.results??[]; if (!hits.some((hit)=>String(hit.source_file??hit.source??"").includes(source))) throw new Error("restored semantic query missed expected vector source");'
fi

mcp_body="$(mktemp "${TMPDIR:-/tmp}/arra-restore-mcp-body.XXXXXX")"
trap 'rm -f -- "$mcp_body"; cleanup' EXIT
mcp_status="$(curl --silent --show-error --location --max-time 10 --config "$mcp_auth" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -X POST --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"restore-gate","version":"1"}}}' -o "$mcp_body" -w '%{http_code}' "http://127.0.0.1:${port}/mcp")"
[[ "$mcp_status" =~ ^2[0-9][0-9]$ && -s "$mcp_body" ]] || { echo "authenticated MCP initialize failed: HTTP $mcp_status" >&2; exit 1; }
MCP_BODY="$mcp_body" bun -e '
  const raw = await Bun.file(process.env.MCP_BODY).text();
  const candidates = raw.trimStart().startsWith("{")
    ? [raw.trim()]
    : raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter((line) => line && line !== "[DONE]");
  let message;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && parsed.jsonrpc === "2.0" && parsed.id === 1) message = parsed;
    } catch { /* Ignore non-JSON SSE frames; a valid initialize result is required below. */ }
  }
  const result = message?.result;
  if (!message || message.error !== undefined || !result || typeof result.protocolVersion !== "string" || !result.capabilities || typeof result.capabilities !== "object" || !result.serverInfo || typeof result.serverInfo.name !== "string" || typeof result.serverInfo.version !== "string") {
    throw new Error("MCP initialize returned no valid JSON-RPC initialize result");
  }
'

kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
pid=""
start_server
wait_for_healthy
curl --silent --show-error --fail --location --max-time 5 "http://127.0.0.1:${port}/api/health" --config "$auth" > /dev/null

if [[ "$require_vector" == "1" ]]; then
  echo "isolated Arra service restore passed: commit, corpus, FTS, sqlite-vec semantic retrieval, MCP auth, loopback bind, and restart verified"
else
  echo "isolated Arra service restore passed: commit, corpus, FTS, MCP auth, loopback bind, and restart verified; vector artifact checksum present (semantic gate not run)"
fi
