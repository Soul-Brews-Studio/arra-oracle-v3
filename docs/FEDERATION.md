# Arra federation guide

Arra exposes a small MAW-compatible federation surface so another Oracle can
pair, verify identity, read a bounded peer feed, and call Arra search. This
guide is for the `alpha` source tree where the federation routes are mounted by
`src/routes/peer/*`.

## What is public vs protected

| Surface | Method/path | Auth | Purpose |
| --- | --- | --- | --- |
| Pairing info | `GET /info` | Always open | MAW schema, node name, locators, and capabilities. |
| Identity | `GET /api/identity` | Always open | Stable local pubkey for TOFU pinning. |
| Peer probe | `GET /api/peers` | Local operator endpoint | Probes configured peers and updates TOFU pins. |
| Peer feed | `GET /api/peer/feed` | Optional `ARRA_PEER_TOKEN` | Peer-readable Arra feed. This is **not** `/api/feed`; `/api/feed` is the local/oraclenet feed surface. |
| Peer search | `POST /api/peer/search` | Optional `ARRA_PEER_TOKEN` | Peer-callable Arra search. `POST /api/search` is also kept as a compatibility alias. |

When `ARRA_PEER_TOKEN` is unset, feed and peer-search are open. When it is set,
callers must pass either `Authorization: Bearer <token>` or `?token=<token>`.
`/info` and `/api/identity` remain open so peers can discover and pin identity.

## Start an Arra node for federation

```bash
# Optional but recommended for state isolation while testing.
export ORACLE_DATA_DIR=$HOME/.oracle

# Optional shared token for feed + peer search.
export ARRA_PEER_TOKEN='replace-with-shared-secret'

# Optional Scout HELLO multicast announcer.
export ARRA_SCOUT_ANNOUNCE=1

bun run server
```

Useful Scout knobs:

| Env | Default | Purpose |
| --- | --- | --- |
| `ARRA_SCOUT_ANNOUNCE` | unset/off | Set to `1` to emit Scout HELLO multicast. |
| `ARRA_SCOUT_GROUP` | `224.0.0.224` | Multicast group. |
| `ARRA_SCOUT_PORT` | `31746` | Multicast port. |
| `ARRA_SCOUT_INTERVAL_MS` | `5000` | HELLO interval. |

The HELLO payload advertises Arra locators, node name, and capabilities
`pair`, `feed`, `send`, and `arra-search`.

## Pairing contract

A peer pairs by reading Arra's public info and identity documents:

```bash
curl -s http://localhost:47778/info | jq
curl -s http://localhost:47778/api/identity | jq
```

`GET /info` returns a MAW-compatible document shaped like:

```json
{
  "maw": { "schema": "1", "capabilities": ["arra-search", "feed"] },
  "node": "arra@hostname",
  "oracle": "arra",
  "locators": ["http://hostname:47778"],
  "version": "...",
  "ts": 1780000000000
}
```

`GET /api/identity` returns the stable local TOFU key:

```json
{
  "pubkey": "64-hex-character-key",
  "node": "arra@hostname",
  "oracle": "arra",
  "version": "...",
  "uptime": 12.34,
  "clockUtc": "2026-06-06T00:00:00.000Z"
}
```

Arra stores its own identity key in `$ORACLE_DATA_DIR/peer-key.hex`.

## Configure named peers

Arra probes outbound peers from either `ARRA_NAMED_PEERS` or a JSON file. The
environment variable wins when both are set.

### Option A: environment variable

```bash
export ARRA_NAMED_PEERS='{"mawjs":"http://127.0.0.1:47800"}'
```

### Option B: peers.json

By default Arra reads `$ORACLE_DATA_DIR/peers.json`. Override the path with
`ARRA_PEERS_CONFIG`.

```json
{
  "namedPeers": {
    "mawjs": "http://127.0.0.1:47800"
  }
}
```

The flat form also works:

```json
{
  "mawjs": "http://127.0.0.1:47800"
}
```

## Probe peers and pin TOFU keys

Use the operator CLI:

```bash
arra peers --token "$ARRA_PEER_TOKEN"
arra peers --json --token "$ARRA_PEER_TOKEN"
```

Or call the HTTP endpoint:

```bash
curl -s http://localhost:47778/api/peers | jq
```

For each named peer Arra fetches:

1. `GET <peer>/info`
2. `GET <peer>/api/identity`

The first successful probe writes `$ORACLE_DATA_DIR/peers-tofu.json` with the
peer's pubkey. Later probes must match the pinned key. If a peer returns a
different pubkey, Arra reports a `MISMATCH` and you should verify the rotation
out-of-band before deleting or editing the pin.

Override the pin file with `ARRA_PEERS_TOFU_PATH` when needed.

## Query Arra as a peer

### Feed

Use `/api/peer/feed` for federation. Do not use `/api/feed`; that path belongs
to Arra's local/oraclenet feed surface.

```bash
curl -s -H "Authorization: Bearer $ARRA_PEER_TOKEN" \
  'http://localhost:47778/api/peer/feed?limit=20' | jq
```

For quick browser/manual checks, `?token=` is accepted when a token is set:

```bash
curl -s 'http://localhost:47778/api/peer/feed?token=replace-with-shared-secret&limit=20' | jq
```

The server caps overly large feed limits, so peers should request only what
they need.

### Search

```bash
curl -s -X POST http://localhost:47778/api/peer/search \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $ARRA_PEER_TOKEN" \
  -d '{"query":"mawjs federation","limit":5}' | jq
```

Expected response shape:

```json
{
  "node": "arra@hostname",
  "oracle": "arra",
  "query": "mawjs federation",
  "results": []
}
```

## Worked example: pair Arra and mawjs

This example assumes Arra runs on `http://127.0.0.1:47778` and mawjs exposes the
same pairing contract on `http://127.0.0.1:47800`.

### 1. Start Arra with a shared peer token

```bash
export ORACLE_DATA_DIR=$(mktemp -d)
export ARRA_PEER_TOKEN='dev-secret'
export ARRA_NAMED_PEERS='{"mawjs":"http://127.0.0.1:47800"}'
export ARRA_SCOUT_ANNOUNCE=1
bun run server
```

### 2. Confirm Arra's public pairing documents

```bash
curl -s http://127.0.0.1:47778/info | jq '.maw, .node, .locators'
curl -s http://127.0.0.1:47778/api/identity | jq '.node, .pubkey'
```

Give mawjs the Arra locator, token, and pubkey out-of-band if mawjs requires
manual trust confirmation.

### 3. Probe mawjs from Arra and create the TOFU pin

```bash
arra peers --token dev-secret
# or
curl -s http://127.0.0.1:47778/api/peers | jq
```

The first successful probe should report a new pin. The next probe should
report the peer as pinned. If it reports `MISMATCH`, stop and verify the mawjs
identity key before trusting feed/search results.

### 4. Let mawjs query Arra feed/search

```bash
curl -s -H 'Authorization: Bearer dev-secret' \
  'http://127.0.0.1:47778/api/peer/feed?limit=20' | jq

curl -s -X POST http://127.0.0.1:47778/api/peer/search \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer dev-secret' \
  -d '{"query":"federation","limit":5}' | jq
```

## Security checklist

- Keep `/info` and `/api/identity` open; they are the discovery and pairing
  contract.
- Set `ARRA_PEER_TOKEN` before exposing `/api/peer/feed` or
  `/api/peer/search` beyond a trusted local network.
- Prefer bearer auth over `?token=` outside quick manual checks because URLs are
  often logged.
- Treat `$ORACLE_DATA_DIR/peers-tofu.json` as a trust store. Unexpected key
  changes are a security event until verified out-of-band.
- Keep Scout multicast opt-in (`ARRA_SCOUT_ANNOUNCE=1`) and review
  `ARRA_SCOUT_GROUP` / `ARRA_SCOUT_PORT` for your network.

## Verification commands

```bash
bun test src/integration/federation-peer.test.ts
bun run build
```

The integration test covers public discovery, stable identity, token-protected
feed/search, named peer probing, first-use pins, and mismatch detection.
