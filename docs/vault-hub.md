# Vault + local DB + hub (issue #3110)

Every oracle keeps its own memory; an org can share part of it.

| layer | what | where |
|---|---|---|
| vault (truth) | markdown in git | private: this repo's `ψ/` · shared: one org vault repo |
| `.arra/` (search) | SQLite + FTS5 (+ vectors), a rebuildable cache | `<dir>/.arra/`, made by `arra init`, gitignored |
| hub (door) | serves a shared vault to joined nodes | `arra serve --hub`, tailnet/LAN only, invite code + node token |

No `arra init` = today's arra (`~/.arra-oracle-v2`), unchanged.

## One API, four doors

Logic lives in the HTTP API. The CLI, MCP tools and the `/vault` skill only call it.
The skill is `skills/vault/SKILL.md` (install: `cp -R skills/vault ~/.claude/skills/`).

| task | skill | CLI | MCP | API |
|---|---|---|---|---|
| init | `/vault connect <dir>` | `arra init [dir] [--vault <path>] [--hub --name n] [--from <old dir>]` | – | – |
| status | `/vault` | `arra status` | `arra_status` | `GET /api/arra/status` |
| share | `/vault share` | `arra share <id\|file> \| --text ".." [--vault <org>\|hub:<org>]` | `arra_vault` share | `POST /api/arra/share` |
| sync | `/vault sync` | `arra sync` | `arra_vault` sync | `POST /api/arra/sync` |
| search | `/vault search` | `arra find "q"` (`self:` / `shared:`) | `arra_vault` search | `GET /api/arra/search` |
| read | `/vault read` | `arra open <id>` | `arra_vault` read | `GET /api/arra/read` |
| snapshot | `/vault snapshot` | `arra snapshot create\|push <dir\|hub:o>\|pull <dir\|hub:o>\|list` | `arra_vault` snapshot_* | `POST /api/arra/snapshot/:action` |
| hub | `/vault hub …` | `arra hub invite\|nodes\|revoke`, `arra join`, `arra hubs`, `arra discover` | `arra_hub` | `/api/arra/hub/*`, `/api/arra/join`, `/api/arra/hubs`, `/api/arra/discover` |
| retire | `/vault retire` | `arra retire <thing> --successor <x\|nothing> --why ".."` | `arra_hub` retire | `POST /api/arra/retire` |

`/api/arra/*` answers loopback callers only (the box owner). Remote nodes use `/api/federation/*`.

## Quick start

```bash
# hub (once), on the machine that keeps the org vault checkout
arra init ~/hub --hub --name soul-brews --vault ~/Code/github.com/<org>/<org-vault>
ORACLE_DATA_DIR=~/hub/.arra arra serve --hub
arra hub invite --for 7d --label node-a         # → one-use code, valid 10 minutes

# a node
arra init .                                     # in an oracle repo: .arra/, .gitignore, .envrc
direnv allow && arra serve
arra join http://hub.<tailnet>.ts.net:47778 --code ABCD-EFGH-JKMN
arra share --text "# Glaze recipe ..." --vault hub:soul-brews
arra sync                                       # the hub's vault → this .arra as hub:soul-brews
arra find "glaze"                               # grouped: self, hub:soul-brews
```

## The door

- **Layer 1, network:** the caller's socket address must be loopback, LAN (10/8, 172.16/12,
  192.168/16) or tailnet (100.64/10, fd7a:115c:a1e0::/48). The server stamps the real peer address
  into `x-arra-peer-ip` on every request, overwriting any client value. Otherwise 403.
- **Layer 2, token:** `arra hub invite --for 15m|1h|7d|forever` makes a one-use code (10 minutes).
  `arra join` trades it for a per-node token. The hub stores sha256 hashes of codes and tokens only;
  the node keeps its token in `.arra/hubs.json` (mode 0600). No token / unknown token → 401;
  expired or revoked → 403.
- A hub never serves its own private rows: `/api/federation/search` and `/doc` see `hub:<name>`
  sources only.
- `/api/federation`: `GET /hub` (name, no token), `POST /join`, then with a token: `POST /share`,
  `GET /vault`, `GET /search`, `GET /doc/:id`, `GET|PUT /snapshots/:file`.

## Search is grouped by source

`arra find "q"` returns one group per source — `self`, then each `hub:<name>` — each ranked on its
own (self: the normal hybrid search; hubs: FTS bm25 over the synced rows). Scores from different
groups are not comparable (different embedders, or FTS only), so nothing is merged. A hub that is
down does not break search: hub rows are the synced cache, and each joined hub gets a note (last
sync, expired).

## Snapshots are manual

`arra snapshot create` packs `lancedb/` + `vectors.db` with a manifest as
`lancedb-<model>-<vault sha>.tar.zst`. `pull` restores it only when model and vault commit both match
(otherwise `arra sync` embeds the diff through the indexer job queue) and moves the old store aside
as `*.prev-<time>`. Create is refused while the arra holds private rows — vector rows carry text — so
snapshots come from a vault-only arra (the hub). Vectors are never committed to git.

## Lifecycle: arise · stand · cease

- No auto-delete, no retention logic. Every snapshot is kept.
- Cease only by hand: `arra retire <thing> --successor <x|nothing> --why ".."` writes a row to the
  vault's `RETIRED.md` (when, what, why, successor, how to bring it back) and commits it.
- `arra hub revoke <id>` stops the token at once and writes a RETIRED row.
- A note that left the vault is superseded in `.arra` (`_vault_removed`), never deleted; git keeps it.
- Memory notes cease by supersede (`arra_supersede`). `.arra/` itself is a cache: rebuild with
  `arra init --reindex` + `arra sync`.

## Files in `.arra/`

| file | what |
|---|---|
| `oracle.db` | the local index (rebuildable) |
| `arra.json` | this node: name, connected vaults, hub mode |
| `hubs.json` | hubs joined: url, node id, token (0600) |
| `hub-state.json` | hub only: invite code hashes, nodes (token hashes), expiry, last seen, calls |
| `snapshots/` | manual vector snapshots |

## Proof

`scripts/arra-proof/node-run.sh` is what each node ran in the three-machine proof (hub + 2 nodes
over a tailnet); `scripts/arra-proof/mcp-call.ts` drives the MCP door against a running arra.
