#!/usr/bin/env bash
set -euo pipefail

DROPLET_NAME="arra-oracle"
FIREWALL_NAME="arra-oracle-firewall"
IMAGE="docker-20-04"
SIZE="s-1vcpu-2gb"
REGION="sgp1"
SSH_KEY="${DO_SSH_KEY_FINGERPRINT:-}"
ARRA_TOKEN="${ARRA_API_TOKEN:-}"
DRY_RUN=0
ALLOW_IPS=()
ARRA_PORT="80"
CONTAINER_PORT="47778"
IMAGE_REF="ghcr.io/soul-brews-studio/arra-oracle-v3:http"

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-do.sh [options]

Provision Arra Oracle on a DigitalOcean Docker droplet. Safe dry-run is supported
and creates nothing.

Options:
  --dry-run             Print the doctl/ssh/docker plan; create nothing
  --allow-ip <cidr>     Allow SSH(22) and Arra HTTP(80) from this IP/CIDR; repeatable
  --token <token>       ARRA_API_TOKEN for the container (or env ARRA_API_TOKEN)
  --ssh-key <fingerprint>
                        DigitalOcean SSH key fingerprint/id (or env DO_SSH_KEY_FINGERPRINT)
  --region <region>     DigitalOcean region (default: sgp1)
  --size <size>         Droplet size (default: s-1vcpu-2gb)
  --name <name>         Droplet name (default: arra-oracle)
  --help                Show this help

DigitalOcean auth is read by doctl, usually via DIGITALOCEAN_ACCESS_TOKEN or
`doctl auth init`. This script does not accept or print the DO access token.
USAGE
}

log() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; }

quote_cmd() {
  printf '%q ' "$@"
  printf '\n'
}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '+ '
    quote_cmd "$@"
  else
    "$@"
  fi
}

require_real() {
  if [[ "$DRY_RUN" == "0" ]]; then
    command -v doctl >/dev/null 2>&1 || { err "doctl is required for real deploys"; exit 1; }
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --allow-ip) [[ $# -ge 2 ]] || { err "--allow-ip needs a value"; exit 1; }; ALLOW_IPS+=("$2"); shift 2 ;;
    --token) [[ $# -ge 2 ]] || { err "--token needs a value"; exit 1; }; ARRA_TOKEN="$2"; shift 2 ;;
    --ssh-key|--ssh-keys) [[ $# -ge 2 ]] || { err "$1 needs a value"; exit 1; }; SSH_KEY="$2"; shift 2 ;;
    --region) [[ $# -ge 2 ]] || { err "--region needs a value"; exit 1; }; REGION="$2"; shift 2 ;;
    --size) [[ $# -ge 2 ]] || { err "--size needs a value"; exit 1; }; SIZE="$2"; shift 2 ;;
    --name) [[ $# -ge 2 ]] || { err "--name needs a value"; exit 1; }; DROPLET_NAME="$2"; FIREWALL_NAME="$2-firewall"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) err "unknown option: $1"; usage >&2; exit 1 ;;
  esac
done

if [[ ${#ALLOW_IPS[@]} -eq 0 ]]; then
  err "at least one --allow-ip <ip-or-cidr> is required; firewall defaults deny inbound"
  exit 1
fi

if [[ -z "$ARRA_TOKEN" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    ARRA_TOKEN="<ARRA_API_TOKEN>"
  else
    err "--token or ARRA_API_TOKEN is required"
    exit 1
  fi
fi

if [[ -z "$SSH_KEY" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    SSH_KEY="<DO_SSH_KEY_FINGERPRINT>"
  else
    err "--ssh-key or DO_SSH_KEY_FINGERPRINT is required"
    exit 1
  fi
fi

require_real

log "== Arra DigitalOcean deploy plan =="
log "droplet:  $DROPLET_NAME"
log "region:   $REGION"
log "size:     $SIZE"
log "image:    $IMAGE"
log "firewall: $FIREWALL_NAME"
log "allow:    ${ALLOW_IPS[*]}"
log "mode:     $([[ "$DRY_RUN" == "1" ]] && echo dry-run || echo real)"
log ""

DROPLET_ID=""
PUBLIC_IP=""

if [[ "$DRY_RUN" == "1" ]]; then
  log "# Would check for existing droplet named $DROPLET_NAME"
  run doctl compute droplet list --format ID,Name,PublicIPv4 --no-header
  log "# If missing, would create droplet"
  run doctl compute droplet create "$DROPLET_NAME" --image "$IMAGE" --size "$SIZE" --region "$REGION" --ssh-keys "$SSH_KEY" --wait
  DROPLET_ID="<droplet-id>"
  PUBLIC_IP="<public-ip>"
else
  existing=$(doctl compute droplet list --format ID,Name,PublicIPv4 --no-header | awk -v name="$DROPLET_NAME" '$2 == name { print $1 " " $3; exit }')
  if [[ -n "$existing" ]]; then
    DROPLET_ID=${existing%% *}
    PUBLIC_IP=${existing#* }
    log "Found existing droplet $DROPLET_NAME ($DROPLET_ID) at $PUBLIC_IP; skipping create."
  else
    run doctl compute droplet create "$DROPLET_NAME" --image "$IMAGE" --size "$SIZE" --region "$REGION" --ssh-keys "$SSH_KEY" --wait
    existing=$(doctl compute droplet list --format ID,Name,PublicIPv4 --no-header | awk -v name="$DROPLET_NAME" '$2 == name { print $1 " " $3; exit }')
    [[ -n "$existing" ]] || { err "droplet create finished but $DROPLET_NAME was not found"; exit 1; }
    DROPLET_ID=${existing%% *}
    PUBLIC_IP=${existing#* }
  fi
fi

inbound_rules=()
for ip in "${ALLOW_IPS[@]}"; do
  inbound_rules+=("protocol:tcp,ports:22,address:${ip}")
  inbound_rules+=("protocol:tcp,ports:${ARRA_PORT},address:${ip}")
done
OUTBOUND_RULE="protocol:tcp,ports:all,address:0.0.0.0/0"

log ""
log "# Firewall: allow only requested IPs for SSH(22) and Arra HTTP(${ARRA_PORT}); deny other inbound."
if [[ "$DRY_RUN" == "1" ]]; then
  run doctl compute firewall list --format ID,Name --no-header
  run doctl compute firewall create --name "$FIREWALL_NAME" --droplet-ids "$DROPLET_ID" --inbound-rules "${inbound_rules[*]}" --outbound-rules "$OUTBOUND_RULE"
else
  fw_id=$(doctl compute firewall list --format ID,Name --no-header | awk -v name="$FIREWALL_NAME" '$2 == name { print $1; exit }')
  if [[ -z "$fw_id" ]]; then
    run doctl compute firewall create --name "$FIREWALL_NAME" --droplet-ids "$DROPLET_ID" --inbound-rules "${inbound_rules[*]}" --outbound-rules "$OUTBOUND_RULE"
  else
    log "Found existing firewall $FIREWALL_NAME ($fw_id); ensuring droplet is attached."
    run doctl compute firewall add-droplets "$fw_id" --droplet-ids "$DROPLET_ID" || true
  fi
fi

remote_cmd="docker rm -f arra 2>/dev/null || true; docker pull ${IMAGE_REF}; docker run -d --name arra -p ${ARRA_PORT}:${CONTAINER_PORT} -v arra-data:/data -e ORACLE_DATA_DIR=/data -e ARRA_API_TOKEN=${ARRA_TOKEN} --restart unless-stopped ${IMAGE_REF}; docker ps --filter name=arra"

log ""
log "# Container: run GHCR HTTP image on the droplet."
run doctl compute ssh "$DROPLET_NAME" --ssh-retry-max 30 --ssh-command "bash -lc $(printf '%q' "$remote_cmd")"

log ""
log "== Ready =="
log "Public IP: $PUBLIC_IP"
log "ORACLE_API=http://$PUBLIC_IP"
log "Health: curl -sf http://$PUBLIC_IP/api/health"
