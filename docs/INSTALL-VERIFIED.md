# Installation, end to end, actually run

Every command here was executed on a clean macOS account (no prior `arra-oracle` install) on
2026-08-16 against `alpha` at `1252c735`, and every output is real. Where the existing docs and
the shipped UI disagree, that is recorded rather than smoothed over.

Companion to [QUICKSTART.md](QUICKSTART.md) (Docker-first) and [INSTALL.md](INSTALL.md). This file
is the from-scratch native path plus the Studio connection, which nothing else documents together.

---

## 1. Install

`arra-oracle-v3` is **github-only** — there is no npm package.

```bash
bun add -g github:Soul-Brews-Studio/arra-oracle-v3#alpha
```

```
installed arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3#1252c73 with binaries:
 - arra-oracle
 - arra-oracle-v3
 - arra-oracle-v2
 - arra-cli
 - arra
315 packages installed [7.58s]
Blocked 4 postinstalls. Run `bun pm -g untrusted` for details.
```

### Choose your ref deliberately — the tag is far behind

There are two documented install refs and they are **not** equivalent:

| Ref | Documented in | What you get |
|---|---|---|
| `#alpha` | `docs/QUICKSTART.md:21`, the Studio's own first-run screen | current trunk |
| `#vX.Y.Z` | `CLAUDE.md:14`, `docs/QUICKSTART.md:14` | the newest release tag |

At time of writing the newest tag is `v26.7.26-alpha.227` (2026-07-25) and `alpha` is **174 commits
ahead of it**. Pinning the tag is reproducible; it also misses everything merged since. Pick on
purpose.

### The blocked postinstalls are expected

```
@mongodb-js/zstd  » prebuild-install --runtime napi || npm run clean-install
node-liblzma      » node-gyp rebuild
core-js-pure      » node -e "try{require('./postinstall')}catch(e){}"
```

Bun blocks untrusted postinstall scripts by default. The server starts and self-tests pass without
running them — they are optional compression/native paths. Leave them blocked unless you hit a
specific failure.

### `--version` does not work on the server binary

```bash
$ arra-oracle --version
Error: unknown serve option: --version
```

`arra-oracle` defaults to the `serve` subcommand, so bare flags are parsed as serve options. Use:

```bash
arra --version        # arra-cli v26.7.26-alpha.227
arra-oracle --help    # subcommand list
```

Note the version string tracks `package.json`, not the installed commit — a `#alpha` install
reports the last tagged version (`26.7.26-alpha.227`) even though the code is 174 commits newer.
Verify what you actually installed with the commit hash in `bun add`'s output.

---

## 2. Run the backend

```bash
arra-oracle serve                       # defaults to :47778
arra-oracle serve --port 47901          # or pick a port
```

Use a dedicated data directory if you are trying it out, so you do not touch an existing corpus:

```bash
ORACLE_DATA_DIR="$HOME/.arra-oracle-trial" arra-oracle serve --port 47901
```

Healthy startup ends with a self-test summary:

```
[SelfTest] PASS health-endpoint
[SelfTest] PASS vector-config
[SelfTest] summary: 3 passed, 0 failed
🔮 Arra Oracle HTTP server → http://localhost:47901
```

### Health endpoints

Both of these work and return the same payload — the Studio's error text suggests `/api/v1/health`:

```bash
curl -s localhost:47901/api/health      # HTTP 200
curl -s localhost:47901/api/v1/health   # HTTP 200
curl -s localhost:47901/health          # HTTP 404 — not a route
```

### `healthStatus: degraded` on a fresh install is normal

```json
{ "status": "ok", "healthStatus": "degraded", "db": "connected",
  "vectorStatus": "down", "vectorAvailable": false, "mcpToolCount": 32 }
```

`degraded` here means **no embedder/vector backend**, not broken. FTS search works; semantic search
does not until you configure one. `status: ok` and `db: connected` are the fields that tell you the
server itself is fine.

---

## 3. Connect the Studio

<https://studio.buildwithoracle.com/> is a **thin client**. It ships no backend and stores nothing
server-side; it talks to the Oracle running on your machine.

With no reachable backend you get a gate:

> **ARRA Oracle 🔮 needs a local MCP** — This studio is a thin client. Run the backend locally first.
> Current host: `localhost:47778` (default)

### Pointing it at your port

The reliable way is the **`?host=` query parameter, including the scheme**:

```
https://studio.buildwithoracle.com/?host=http://localhost:47901
```

The `http://` prefix is required. A bare `localhost:47901` is what the UI *displays* and what it
passes to sub-apps, but the connect path wants a full origin.

There is also a **Change host** button, which opens a **native browser prompt**. That works for a
human but blocks page JavaScript while open, so automation should use the query parameter instead.

### It persists

After connecting once, a plain reload of `https://studio.buildwithoracle.com/` (no query string)
stays connected. Setup is one-time per browser profile, not per visit.

### Connected state

```
ARRA Oracle 🔮   ui v0.8.0+d61178f · api 26.7.26-alpha.227
[ localhost:47901 ] [ Disconnect ]   live
Overview · Search · Feed · Memory · Forum · Activity · Traces · Canvas · Tools ▾
```

`Tools ▾` holds Schedule, Pulse, Sessions, Plugins, Vector Playground, Compare, Evolution. Feed,
Forum, Canvas, Schedule and Vector are **separate hosted sub-apps** (`feed.`, `forum.`, `canvas.`,
`schedule.`, `vector.buildwithoracle.com`) which receive the host as `?host=localhost%3A47901`.

A fresh install shows all zeros — documents, learnings, retros, principles, embeddings — with
status `Healthy`. That is correct for an empty corpus; ingest with `arra mine <dir>`.

### If it will not connect

The Studio says this itself, and it is the right diagnosis:

> A browser cannot tell "nothing is running" apart from "the request was blocked before it left the
> page". If the backend is up, this is usually Chrome's private-network rules or CORS on a
> `localhost` host reached from an `https://` origin.

So check the server directly before believing the UI:

```bash
curl -s localhost:47901/api/v1/health
```

If `curl` succeeds and the Studio does not, it is a browser policy problem, not a server problem.
In testing here, an `https://` origin reached `http://localhost` successfully — the server's
CORS/private-network preflight handling works.

---

## 4. MCP client

The stdio MCP server needs **no running daemon** by default:

```bash
claude mcp add arra-oracle -- arra-oracle mcp
```

With `ORACLE_HTTP_URL` unset it runs in **embedded mode** and opens the database directly
(`src/mcp/server.ts`). Set `ORACLE_HTTP_URL` only when you deliberately want it to proxy to a
running server — for example to share one open database with a live Studio session rather than
opening it twice:

```bash
ORACLE_HTTP_URL=http://localhost:47778 arra-oracle mcp
```

Since #3011, proxy mode auto-starts a **local** daemon on the configured port if it is not running.
A *remote* `ORACLE_HTTP_URL` is never auto-started — that would open a different database and answer
with the wrong corpus.

---

## Known rough edges

Found while writing this, all reproducible:

| Symptom | Reality |
|---|---|
| `arra-oracle --version` errors | bare flags parse as `serve` options; use `arra --version` |
| version reports `26.7.26-alpha.227` after a `#alpha` install | version tracks `package.json`, not the installed commit |
| Studio header shows a huge uptime (e.g. `2552h 4m`) | the backend reported `uptimeSeconds: 1355` (~23 min); no field in `/api/health` produces the displayed figure |
| `healthStatus: degraded` on first run | no embedder configured; FTS works, semantic search does not |
| `Change host` freezes automation | it is a native `prompt()`; use `?host=http://host:port` |
| Old documents appear after switching Oracles | the Studio caches docs and searches in `localStorage` under `oracle_cache/v1:*` (10 min for searches, 24 h for docs), and that cache survives a host change |

That last one is worth knowing before you point one browser profile at two different Oracles.
