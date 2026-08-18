#!/bin/bash
# Install the Oracle HTTP server as a per-user macOS LaunchAgent.
# Mirrors scripts/install-vector-launchagent.sh so both long-lived Oracle
# processes survive a reboot the same way.

set -euo pipefail

LABEL="com.tt3p.arra-oracle"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${ARRA_ORACLE_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BUN_BIN="${ARRA_ORACLE_BUN_BIN:-$(command -v bun || true)}"
DATA_DIR="${ORACLE_DATA_DIR:-$HOME/.arra-oracle-v2}"
LAUNCH_AGENT_DIR="${ARRA_ORACLE_LAUNCHAGENT_DIR:-$HOME/Library/LaunchAgents}"
PLIST_PATH="$LAUNCH_AGENT_DIR/$LABEL.plist"
INSTALL_ONLY="${ARRA_ORACLE_INSTALL_ONLY:-0}"
PORT="${ARRA_ORACLE_PORT:-47778}"

if [[ -z "$BUN_BIN" || ! -x "$BUN_BIN" ]]; then
  echo "error: Bun executable not found; set ARRA_ORACLE_BUN_BIN" >&2
  exit 1
fi
if [[ ! -f "$REPO_ROOT/src/server.ts" ]]; then
  echo "error: oracle server source not found under $REPO_ROOT" >&2
  exit 1
fi
if [[ ! "$PORT" =~ ^[0-9]+$ || "$PORT" -lt 1 || "$PORT" -gt 65535 ]]; then
  echo "error: ARRA_ORACLE_PORT must be an integer from 1 to 65535" >&2
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
    <string>src/server.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$REPO_ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ORACLE_DATA_DIR</key>
    <string>$(xml_escape "$DATA_DIR")</string>
    <key>ORACLE_DB_PATH</key>
    <string>$(xml_escape "$DATA_DIR/oracle.db")</string>
    <key>ORACLE_PORT</key>
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
  <string>$(xml_escape "$DATA_DIR/oracle-server.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$DATA_DIR/oracle-server.error.log")</string>
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
fi
# An unmanaged (manually started) server must exit before launchd takes over.
existing_pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
if [[ -n "$existing_pid" ]]; then
  echo "stopping unmanaged server on port $PORT (PID $existing_pid)"
  kill -TERM $existing_pid
  for _ in {1..40}; do
    lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.25
  done
fi
launchctl bootstrap "$domain" "$PLIST_PATH"
launchctl kickstart -k "$domain/$LABEL"
launchctl print "$domain/$LABEL" >/dev/null
for _ in {1..60}; do
  if /usr/bin/curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "running: $LABEL (http://127.0.0.1:$PORT)"
    exit 0
  fi
  sleep 0.25
done
echo "error: $LABEL loaded but failed its health check; inspect $DATA_DIR/oracle-server.error.log" >&2
exit 1
