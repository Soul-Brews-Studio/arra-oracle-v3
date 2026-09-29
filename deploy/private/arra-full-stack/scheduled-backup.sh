#!/usr/bin/env bash
# Mint-only entry point for the existing arra-backup.service.
set -Eeuo pipefail
umask 077
export PATH=/home/poramateake/.bun/bin:/usr/bin:/bin
bundle="$(cd "$(dirname "$0")" && pwd)"
base=/home/poramateake/Documents/arra-oracle
corpus="$base/staging/full-deploy-20260927d/corpus-20260927d"
container=arra-mint-arra-oracle-1
exec 9>/run/lock/arra-private-backup.lock
flock -n 9 || { echo 'Arra backup already running' >&2; exit 1; }
data="$(docker --context default volume inspect -f '{{.Mountpoint}}' arra-mint_arra-oracle-data)"
[[ "$data" == /var/lib/docker/volumes/arra-mint_arra-oracle-data/_data ]]
[[ "$(docker --context default inspect -f '{{.State.Running}}' "$container")" == true ]]
export ARRA_PINNED_COMMIT="$(docker --context default inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container")"
[[ "$ARRA_PINNED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'Runtime image lacks a pinned source revision' >&2; exit 1; }
archive="arra-private-$(date -u +%Y%m%dT%H%M%SZ).age"
trap 'docker --context default start "$container" >/dev/null' EXIT
docker --context default stop --time 30 "$container" >/dev/null
bash "$bundle/backup-age.sh" --data-dir "$data" --authority-stopped \
  --recipient age1ynq4unjcv2rghfm9rcgayqjnwleane6q4976w2rxj8mzeg3n2ygqrup09v \
  --output "$base/backups/$archive" \
  --corpus-manifest "$base/staging/full-deploy-20260927d/corpus.manifest-20260927d.json" \
  --source-root "arra=$corpus/arra" --source-root "repo=$corpus/repo" \
  --source-root "mint=$corpus/mint" --source-root "mac-setup=$corpus/mac-setup"
docker --context default start "$container" >/dev/null
trap - EXIT
(cd "$base/backups" && sha256sum "$archive" > "$archive.sha256")
chmod 600 "$base/backups/$archive" "$base/backups/$archive.sha256"
chown poramateake:poramateake "$base/backups/$archive" "$base/backups/$archive.sha256"
echo "Encrypted backup and receipt ready: $archive"
