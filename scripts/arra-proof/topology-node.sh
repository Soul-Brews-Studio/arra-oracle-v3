#!/usr/bin/env bash
# Node side of the #3110 Topology proof. Everything lives under /tmp; nothing else is touched.
#
#   ROLE=a HUB_URL=http://<hub>.<tailnet>.ts.net:47944 CODE=XXXX-XXXX-XXXX bash topology-node.sh
#   ROLE=b HUB_URL=... CODE=... GUEST_CODE=... bash topology-node.sh
#
# init → join → share one note → then syncs every 15 s so the hub's Topology view sees calls and
# "last seen" move. b also knocks twice as a stranger (401) and joins a guest that lasts 1m.
# Stops after 4 refused syncs in a row (403: revoked) or MINUTES (default 40).
# Output: /tmp/arra-topo-$ROLE.log (also on screen).
set -u
ROLE=${ROLE:?ROLE=a or b}
HUB_URL=${HUB_URL:?HUB_URL}
CODE=${CODE:?CODE}
PORT=${PORT:-47913}
MINUTES=${MINUTES:-40}
BRANCH=${BRANCH:-feat/3110-graph-view}
SRC=${SRC:-/tmp/arra-3110-src}
WORK=/tmp/arra-topo-$ROLE-$(date +%H%M%S)
LOG=/tmp/arra-topo-$ROLE.log
BUN=$(command -v bun || echo "$HOME/.bun/bin/bun")
API=http://127.0.0.1:$PORT

exec > >(tee -a "$LOG") 2>&1
echo "=== arra #3110 topology node $ROLE · $(date "+%FT%T%z") ==="
[ -x "$BUN" ] || { echo "bun not found"; exit 1; }
if [ ! -d "$SRC/.git" ]; then git clone -q --depth 1 -b "$BRANCH" https://github.com/Soul-Brews-Studio/arra-oracle-v3 "$SRC"; fi
git -C "$SRC" fetch -q --depth 1 origin "$BRANCH" && git -C "$SRC" checkout -q FETCH_HEAD
echo "source $(git -C "$SRC" log --oneline -1)"
(cd "$SRC" && "$BUN" install --frozen-lockfile >/dev/null 2>&1)

arra() { (cd "$SRC" && ORACLE_API=$API "$BUN" cli/src/cli.ts "$@"); }
step() { echo; echo "\$ arra $*"; arra "$@"; }

mkdir -p "$WORK/ψ/memory/learnings" && git -C "$WORK" init -q
step init "$WORK" --name "node-$ROLE"
# `;` not `&&` before the server: `a && b &` backgrounds a subshell, and $! would be its pid, not bun's.
(cd "$SRC" || exit 1; ORACLE_DATA_DIR=$WORK/.arra ORACLE_REPO_ROOT=$WORK ORACLE_PORT=$PORT ORACLE_EMBEDDER=none \
  ORACLE_FILE_WATCHER=0 nohup "$BUN" src/server.ts > "$WORK.server.log" 2>&1 & echo $! > "$WORK.server.pid")
for _ in $(seq 1 120); do curl -s -o /dev/null "$API/api/health" && break; sleep 0.5; done

step join "$HUB_URL" --code "$CODE"
step share --text "# Note from node $ROLE
Bisque at cone 04 before glazing keeps the body porous. (topology proof, node $ROLE)" --vault hub:soul-brews

if [ "$ROLE" = b ]; then
  echo; echo "\$ curl $HUB_URL/api/v1/federation/vault   # stranger, no token"
  curl -s -o /dev/null -w '  -> HTTP %{http_code}\n' "$HUB_URL/api/v1/federation/vault"
  echo "\$ curl -H 'authorization: Bearer not-a-token' $HUB_URL/api/v1/federation/vault"
  curl -s -o /dev/null -w '  -> HTTP %{http_code}\n' -H 'authorization: Bearer not-a-token' "$HUB_URL/api/v1/federation/vault"
  if [ -n "${GUEST_CODE:-}" ]; then
    echo "\$ curl -X POST $HUB_URL/api/v1/federation/join   # guest, lasts 1m"
    TOKEN=$(curl -s -X POST -H 'content-type: application/json' -d "{\"code\":\"$GUEST_CODE\",\"label\":\"guest\"}" "$HUB_URL/api/v1/federation/join" \
      | "$BUN" -e 'const r=JSON.parse(await Bun.stdin.text()); console.log(r.token ?? ""); console.error(JSON.stringify({ nodeId: r.nodeId, expiresAt: r.expiresAt, error: r.error }))')
    curl -s -o /dev/null -w '  -> HTTP %{http_code} (fresh guest)\n' -H "authorization: Bearer $TOKEN" "$HUB_URL/api/v1/federation/vault"
  fi
fi

echo; echo "--- syncing every 15 s (up to $MINUTES min, or until revoked) ---"
start=$SECONDS refused=0
while (( SECONDS - start < MINUTES * 60 )); do
  out=$(arra sync 2>&1 | tr -s ' ' | tail -1)
  echo "$(date +%T) sync: $out"
  if grep -q 403 <<<"$out"; then refused=$((refused + 1)); else refused=0; fi
  (( refused >= 4 )) && { echo "refused 4 times in a row: this node was revoked"; break; }
  sleep 15
done
step find bisque
echo; echo "=== node $ROLE done · $(date "+%FT%T%z") ==="
kill "$(cat "$WORK.server.pid")" 2>/dev/null
exit 0
