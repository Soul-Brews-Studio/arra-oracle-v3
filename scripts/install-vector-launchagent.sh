#!/bin/bash
# Install the read-only vector sidecar as a per-user macOS LaunchAgent.

set -euo pipefail

LABEL="com.tt3p.arra-vector"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${ARRA_VECTOR_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BUN_BIN="${ARRA_VECTOR_BUN_BIN:-$(command -v bun || true)}"
DATA_DIR="${ORACLE_DATA_DIR:-$HOME/.arra-oracle-v2}"
LAUNCH_AGENT_DIR="${ARRA_VECTOR_LAUNCHAGENT_DIR:-$HOME/Library/LaunchAgents}"
PLIST_PATH="$LAUNCH_AGENT_DIR/$LABEL.plist"
INSTALL_ONLY="${ARRA_VECTOR_INSTALL_ONLY:-0}"
PORT="${ARRA_VECTOR_PORT:-8081}"

if [[ -z "$BUN_BIN" || ! -x "$BUN_BIN" ]]; then
  echo "error: Bun executable not found; set ARRA_VECTOR_BUN_BIN" >&2
  exit 1
fi
if [[ ! -f "$REPO_ROOT/src/vector-server.ts" ]]; then
  echo "error: vector server source not found under $REPO_ROOT" >&2
  exit 1
fi
if [[ ! "$PORT" =~ ^[0-9]+$ || "$PORT" -lt 1 || "$PORT" -gt 65535 ]]; then
  echo "error: ARRA_VECTOR_PORT must be an integer from 1 to 65535" >&2
  exit 1
fi

for value in "$BUN_BIN" "$REPO_ROOT" "$DATA_DIR" "$PLIST_PATH" "$PORT"; do
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "error: LaunchAgent paths cannot contain newlines" >&2
    exit 1
  fi
done

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\&apos;/g"
}

mkdir -p "$LAUNCH_AGENT_DIR" "$DATA_DIR"
tmp_plist="$(mktemp "$LAUNCH_AGENT_DIR/.${LABEL}.XXXXXX")"
trap 'rm -f "$tmp_plist"' EXIT

cat > "$tmp_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$BUN_BIN")</string>
    <string>src/vector-server.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$REPO_ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ORACLE_DATA_DIR</key>
    <string>$(xml_escape "$DATA_DIR")</string>
    <key>ORACLE_DB_PATH</key>
    <string>$(xml_escape "$DATA_DIR/oracle.db")</string>
    <key>ORACLE_VECTOR_READONLY</key>
    <string>1</string>
    <key>VECTOR_PORT</key>
    <string>$(xml_escape "$PORT")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$DATA_DIR/vector-server.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$DATA_DIR/vector-server.error.log")</string>
</dict>
</plist>
PLIST

plutil -lint "$tmp_plist" >/dev/null
chmod 0644 "$tmp_plist"
mv "$tmp_plist" "$PLIST_PATH"
trap - EXIT

echo "installed: $PLIST_PATH"
if [[ "$INSTALL_ONLY" == "1" ]]; then
  exit 0
fi

domain="gui/$(id -u)"
if launchctl print "$domain/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$domain/$LABEL"
elif lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "scheduled: $LABEL will start at next login; existing listener on port $PORT retained"
  exit 0
fi
launchctl bootstrap "$domain" "$PLIST_PATH"
launchctl kickstart -k "$domain/$LABEL"
launchctl print "$domain/$LABEL" >/dev/null
for _ in {1..40}; do
  if /usr/bin/curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "running: $LABEL (http://127.0.0.1:$PORT)"
    exit 0
  fi
  sleep 0.25
done
echo "error: $LABEL loaded but failed its health check; inspect $DATA_DIR/vector-server.error.log" >&2
exit 1
