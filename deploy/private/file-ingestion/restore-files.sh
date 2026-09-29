#!/bin/sh
set -eu
archive=${1:?encrypted archive}
identity=${ARRA_FILES_AGE_IDENTITY:?set recovery identity}
target=${2:?isolated target}
test ! -e "$target" || { echo 'target exists; refusing overwrite' >&2; exit 2; }
mkdir -m 700 -p "$target"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
age -d -i "$identity" -o "$tmp/files.tar" "$archive"
tar -C "$target" --no-same-owner -xf "$tmp/files.tar"
chmod 700 "$target" "$target/private" "$target/received" 2>/dev/null || true
chmod 600 "$target/private/files.db" 2>/dev/null || true
printf '%s\n' "$target"
