#!/usr/bin/env bash
set -euo pipefail

umask 077
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
DATA_DIR=${1:?usage: install-vector-config.sh DATA_DIR [CONFIG_PATH]}
CONFIG_PATH=${2:-${DATA_DIR}/vector-server.json}
TEMPLATE=${SCRIPT_DIR}/vector-server.private.json

[[ -f "$TEMPLATE" ]] || { echo "missing vector template: $TEMPLATE" >&2; exit 1; }
mkdir -p -- "$DATA_DIR"
if [[ -e "$CONFIG_PATH" || -L "$CONFIG_PATH" ]]; then
  echo "refusing to overwrite existing vector config: $CONFIG_PATH" >&2
  exit 1
fi
install -m 600 "$TEMPLATE" "$CONFIG_PATH"
if command -v sha256sum >/dev/null 2>&1; then
  checksum=$(sha256sum "$CONFIG_PATH" | awk '{print $1}')
else
  checksum=$(shasum -a 256 "$CONFIG_PATH" | awk '{print $1}')
fi
printf 'vector-config-installed path=%s sha256=%s\n' "$CONFIG_PATH" "$checksum"
