---
name: vault
description: Private + shared memory with arra — connect a folder (arra init), check it (status), share a note into an org vault, sync shared vaults, search grouped by source, open a document, make/pull manual vector snapshots, and run the hub door (invite, join, nodes, revoke, retire, discover). Use when the user says "vault", "connect vault", "share this memory", "sync the vault", "search shared", "join the hub", "invite a node", "revoke node", "retire", or "/vault ...". Every step calls the arra CLI, which calls the same HTTP API as MCP arra_status / arra_vault / arra_hub.
argument-hint: "[connect <dir> | status | share <id|file> | sync | search <q> | read <id> | snapshot create|push|pull | hub invite|nodes|revoke | join <url> --code X | hubs | discover | retire <thing>]"
---

# /vault — vault (truth) · .arra (local cache) · hub (door)

Three layers (issue #3110):

1. **Vault = truth.** Markdown in git. Private = this repo's `ψ/`. Shared = one org vault repo.
2. **`.arra/` = search.** Local DB made by `arra init`, gitignored, rebuildable from the vault.
3. **Hub = door, only where opened.** `arra serve --hub`; tailnet/LAN + one-use invite code + node token.

No init = today's arra (`~/.arra-oracle-v2`), unchanged. This skill only calls the CLI; never edit
`.arra/` files by hand.

## Step 0: where am I

```bash
date "+%H:%M %Z (%A %d %B %Y)"
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
echo "ORACLE_DATA_DIR=${ORACLE_DATA_DIR:-~/.arra-oracle-v2 (default)}"
```

The CLI talks to the arra server for this data dir (`ORACLE_API`, default http://localhost:47778).
If it is not running: `ORACLE_DATA_DIR=$ROOT/.arra arra serve`.

## Commands

| /vault … | runs | API (MCP) |
|---|---|---|
| `connect [dir]` | `arra init [dir] [--vault <org vault checkout> --vault-name <org>]` then `direnv allow` | CLI only |
| *(no args)* / `status` | `arra status` | GET /api/arra/status (arra_status) |
| `share <id\|file>` / `share --text ".."` | `arra share … [--vault <org> \| hub:<org>]` | POST /api/arra/share (arra_vault share) |
| `sync` | `arra sync` | POST /api/arra/sync (arra_vault sync) |
| `search <q>` | `arra find "<q>"` (`self:` / `shared:` narrow) | GET /api/arra/search (arra_vault search) |
| `read <id>` | `arra open <id>` | GET /api/arra/read (arra_vault read) |
| `snapshot create\|push <dir\|hub:org>\|pull <dir\|hub:org>` | `arra snapshot …` | POST /api/arra/snapshot/:action (arra_vault snapshot_*) |
| `hub invite --for 15m\|1h\|7d\|forever --label x` | `arra hub invite …` | POST /api/arra/hub/invite (arra_hub invite) |
| `hub nodes` / `hub revoke <id> --why ".."` | `arra hub nodes` / `arra hub revoke …` | /api/arra/hub/* (arra_hub nodes / revoke) |
| `join <url> --code X` / `hubs [--leave n]` | `arra join …` / `arra hubs …` | /api/arra/join, /api/arra/hubs (arra_hub join / hubs / leave) |
| `discover` | `arra discover` | GET /api/arra/discover (arra_hub discover) |
| `retire <thing> --successor <x\|nothing> --why ".."` | `arra retire …` | POST /api/arra/retire (arra_hub retire) |

## Rules

- **Share on purpose.** Nothing becomes shared by itself; old private notes stay private after a join.
- **Search output is grouped by source** (`self`, `hub:<org>`). Scores compare only inside one group —
  never present them as one ranking.
- **Snapshots are manual** and only from an arra with no private rows (the hub). Never commit vectors.
- **Cease by hand, with a record.** No auto-delete anywhere: `arra hub revoke` and `arra retire` write
  a RETIRED.md row (what, why, successor, how to bring it back). Memory notes cease by
  supersede, never by removal from git.
- **Confidential company material never goes to a hub other people joined.** One org = one hub.
- Report results as the CLI prints them; if a command fails, show its one-line error.
