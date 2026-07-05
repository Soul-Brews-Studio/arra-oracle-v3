#!/usr/bin/env bash
set -euo pipefail

DROPLET_NAME="arra-oracle"
FIREWALL_NAME="arra-oracle-firewall"
DRY_RUN=0
YES=0

usage() {
  cat <<'USAGE'
Usage: scripts/destroy-do.sh [options]

Tear down the DigitalOcean resources created by scripts/deploy-do.sh.

Options:
  --dry-run       Print doctl commands; delete nothing
  --yes           Do not prompt before deleting in real mode
  --name <name>   Droplet name (default: arra-oracle)
  --help          Show this help
USAGE
}

err() { printf 'error: %s\n' "$*" >&2; }
quote_cmd() { printf '%q ' "$@"; printf '\n'; }
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '+ '
    quote_cmd "$@"
  else
    "$@"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --name) [[ $# -ge 2 ]] || { err "--name needs a value"; exit 1; }; DROPLET_NAME="$2"; FIREWALL_NAME="$2-firewall"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) err "unknown option: $1"; usage >&2; exit 1 ;;
  esac
done

if [[ "$DRY_RUN" == "0" ]]; then
  command -v doctl >/dev/null 2>&1 || { err "doctl is required for real teardown"; exit 1; }
  if [[ "$YES" != "1" ]]; then
    printf 'Delete droplet %s and firewall %s? Type the droplet name to confirm: ' "$DROPLET_NAME" "$FIREWALL_NAME"
    read -r answer
    [[ "$answer" == "$DROPLET_NAME" ]] || { err "confirmation mismatch; aborting"; exit 1; }
  fi
fi

printf '== Arra DigitalOcean destroy plan ==\n'
printf 'droplet:  %s\n' "$DROPLET_NAME"
printf 'firewall: %s\n' "$FIREWALL_NAME"
printf 'mode:     %s\n\n' "$([[ "$DRY_RUN" == "1" ]] && echo dry-run || echo real)"

if [[ "$DRY_RUN" == "1" ]]; then
  run doctl compute droplet list --format ID,Name,PublicIPv4 --no-header
  run doctl compute firewall list --format ID,Name --no-header
  run doctl compute droplet delete "$DROPLET_NAME" --force
  printf '# Would delete firewall id matching name %s\n' "$FIREWALL_NAME"
  run doctl compute firewall delete "<firewall-id>" --force
  exit 0
fi

if doctl compute droplet get "$DROPLET_NAME" >/dev/null 2>&1; then
  run doctl compute droplet delete "$DROPLET_NAME" --force
else
  printf 'Droplet %s not found; skipping.\n' "$DROPLET_NAME"
fi

fw_id=$(doctl compute firewall list --format ID,Name --no-header | awk -v name="$FIREWALL_NAME" '$2 == name { print $1; exit }')
if [[ -n "$fw_id" ]]; then
  run doctl compute firewall delete "$fw_id" --force
else
  printf 'Firewall %s not found; skipping.\n' "$FIREWALL_NAME"
fi
