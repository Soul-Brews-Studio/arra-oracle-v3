#!/bin/bash
# Login-managed pull: an offline/sleeping Mac catches up on the next run.
set -euo pipefail
umask 077
destination=/Users/poramateake/.codex/arra-backups
mkdir -p "$destination"
/usr/bin/rsync -a --ignore-existing \
  --include='arra-private-*.age' --include='arra-private-*.age.sha256' --exclude='*' \
  -e '/usr/bin/ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ConnectTimeout=15' \
  arra-mini:/home/poramateake/Documents/arra-oracle/backups/ "$destination/"
shopt -s nullglob
receipts=("$destination"/arra-private-*.age.sha256)
[[ ${#receipts[@]} -gt 0 ]] || { echo 'No encrypted backup receipt available' >&2; exit 1; }
cd "$destination"
for receipt in "${receipts[@]}"; do
  /usr/bin/shasum -a 256 -c "$receipt"
done
