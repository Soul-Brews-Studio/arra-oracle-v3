#!/usr/bin/env bash
# Node side of the #3110 three-machine proof. Everything lives under /tmp; nothing else is touched.
#
#   ROLE=a HUB_URL=http://<hub>.<tailnet>.ts.net:47944 CODE=XXXX-XXXX-XXXX bash node-run.sh
#   ROLE=b HUB_URL=... CODE=... GUEST_CODE=... bash node-run.sh
#
# a: init → join → share through the hub → sync → find → then keeps syncing until the hub
#    revokes it (expects 403).
# b: init → join → syncs until a's note arrives → grouped find / read → snapshot pull →
#    guest code joined with --for 1m expires (403) → keeps syncing until the hub goes down,
#    then shows search still answering.
# Output: /tmp/arra-3110-$ROLE.log (also on screen).
set -u
ROLE=${ROLE:?ROLE=a or b}
HUB_URL=${HUB_URL:?HUB_URL}
CODE=${CODE:?CODE}
PORT=${PORT:-47913}
BRANCH=${BRANCH:-feat/3110-vault-hub}
SRC=${SRC:-/tmp/arra-3110-src}
WORK=/tmp/arra-3110-$ROLE
LOG=$WORK.log
BUN=$(command -v bun || echo "$HOME/.bun/bin/bun")
API=http://127.0.0.1:$PORT

exec > >(tee -a "$LOG") 2>&1
echo "=== arra #3110 node $ROLE on $(hostname) · $(date "+%FT%T%z") ==="
[ -x "$BUN" ] || { echo "bun not found (install: curl -fsSL https://bun.sh/install | bash)"; exit 1; }
if [ ! -d "$SRC/.git" ]; then git clone -q --depth 1 -b "$BRANCH" https://github.com/Soul-Brews-Studio/arra-oracle-v3 "$SRC"; fi
git -C "$SRC" fetch -q --depth 1 origin "$BRANCH" && git -C "$SRC" checkout -q FETCH_HEAD
echo "source $(git -C "$SRC" log --oneline -1)"
(cd "$SRC" && "$BUN" install --frozen-lockfile >/dev/null 2>&1)

arra() { (cd "$SRC" && ORACLE_API=$API "$BUN" cli/src/cli.ts "$@"); }
step() { echo; echo "\$ arra $*"; arra "$@"; }
until_out() { # until_out <seconds> <grep pattern> <arra args...>
  local limit=$1 pat=$2; shift 2; local start=$SECONDS out
  while (( SECONDS - start < limit )); do
    out=$(arra "$@" 2>&1); if grep -q -- "$pat" <<<"$out"; then echo; echo "\$ arra $*   (after $((SECONDS - start))s)"; echo "$out"; return 0; fi
    sleep 10
  done
  echo "TIMEOUT waiting for '$pat' from arra $*"; return 1
}

mkdir -p "$WORK/ψ/memory/learnings"
git -C "$WORK" init -q 2>/dev/null
printf -- '---\ntitle: private on %s\n---\n# Private note on %s\nOnly this machine knows: wedging takes 50 turns here.\n' "$(hostname)" "$(hostname)" > "$WORK/ψ/memory/learnings/private-$ROLE.md"
step init "$WORK" --name "node-$ROLE-$(hostname)"

(cd "$SRC" && ORACLE_DATA_DIR=$WORK/.arra ORACLE_REPO_ROOT=$WORK ORACLE_PORT=$PORT ORACLE_EMBEDDER=none \
  ORACLE_FILE_WATCHER=0 nohup "$BUN" src/server.ts > "$WORK.server.log" 2>&1 & echo $! > "$WORK.server.pid")
for _ in $(seq 1 120); do curl -s -o /dev/null "$API/api/health" && break; sleep 0.5; done
step status

echo; echo "\$ curl $HUB_URL/api/v1/federation/vault   # a stranger: no token"
curl -s -w '  → HTTP %{http_code}\n' "$HUB_URL/api/v1/federation/vault"
step discover --hosts "$(echo "$HUB_URL" | sed -E 's#https?://([^:/]+).*#\1#')" --port "$(echo "$HUB_URL" | sed -E 's#.*:([0-9]+).*#\1#')"
step join "$HUB_URL" --code "$CODE"
step hubs

if [ "$ROLE" = a ]; then
  step share --text "# Wedging clay
Ram-head wedging, 50 turns, removes air pockets before throwing. (shared from $(hostname))" --vault hub:soul-brews
  step sync
  step find wedging
  echo; echo "--- waiting for the hub to revoke this node (sync every 10s, up to 40 min) ---"
  until_out 2400 "403" sync
  step find wedging
else
  echo; echo "--- waiting for node a's note on the hub (sync + find every 10s, up to 40 min) ---"
  start=$SECONDS
  until arra sync >/dev/null 2>&1; arra find shared:wedging 2>&1 | grep -q "Wedging clay"; do
    (( SECONDS - start > 2400 )) && { echo "TIMEOUT waiting for the shared note"; break; }; sleep 10
  done
  step sync
  step find wedging
  step find shared:wedging
  ID=$(arra find shared:wedging --json | "$BUN" -e 'const r=JSON.parse(await Bun.stdin.text()); console.log(r.groups?.[0]?.results?.[0]?.id ?? "")')
  [ -n "$ID" ] && step read "$ID"
  echo; echo "--- waiting for a matching snapshot on the hub (up to 40 min) ---"
  until_out 2400 "restored" snapshot pull hub:soul-brews
  step status
  if [ -n "${GUEST_CODE:-}" ]; then
    echo; echo "\$ curl -X POST $HUB_URL/api/v1/federation/join   # guest code, node lasts 1m"
    TOKEN=$(curl -s -X POST -H 'content-type: application/json' -d "{\"code\":\"$GUEST_CODE\",\"label\":\"guest\"}" "$HUB_URL/api/v1/federation/join" \
      | "$BUN" -e 'const r=JSON.parse(await Bun.stdin.text()); console.log(r.token ?? ""); console.error(JSON.stringify({ hub: r.hub, nodeId: r.nodeId, expiresAt: r.expiresAt, error: r.error }))')
    echo "\$ curl -H 'authorization: Bearer <guest token>' $HUB_URL/api/v1/federation/vault"
    curl -s -o /dev/null -w '  → HTTP %{http_code} (fresh guest)\n' -H "authorization: Bearer $TOKEN" "$HUB_URL/api/v1/federation/vault"
    sleep 65
    curl -s -w '\n  → HTTP %{http_code} (65 s later)\n' -H "authorization: Bearer $TOKEN" "$HUB_URL/api/v1/federation/vault"
  fi
  echo; echo "--- waiting for the hub to go down (sync every 10s, up to 60 min) ---"
  until_out 3600 "unreachable" sync
  step find wedging
fi

echo; echo "=== node $ROLE done · $(date "+%FT%T%z") ==="
kill "$(cat "$WORK.server.pid")" 2>/dev/null
exit 0
