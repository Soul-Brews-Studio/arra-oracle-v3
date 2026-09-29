#!/bin/sh
set -eu
state=${ARRA_FILES_STATE:?set ARRA_FILES_STATE}
recipient=${ARRA_FILES_AGE_RECIPIENT:?set recipient}
out=${ARRA_FILES_BACKUP_DIR:?set backup dir}
mkdir -p -m 700 "$out"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
python3 - "$state/private/files.db" "$tmp/files.db" <<'PY'
import sqlite3, sys
source=sqlite3.connect(sys.argv[1]); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.close(); source.close()
PY
chmod 600 "$tmp/files.db"
mkdir -m 700 "$tmp/private"
mv "$tmp/files.db" "$tmp/private/files.db"
tar -C "$tmp" -cf - private/files.db -C "$state" received 2>/dev/null \
  | age -r "$recipient" -o "$out/arra-files-$timestamp.tar.age"
(cd "$out" && sha256sum "arra-files-$timestamp.tar.age" > "arra-files-$timestamp.tar.age.sha256")
chmod 600 "$out"/*
printf '%s\n' "$out/arra-files-$timestamp.tar.age"
