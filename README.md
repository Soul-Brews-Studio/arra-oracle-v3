# Arra Oracle V3 — Docker-first MCP Memory + Search

[![CI](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml/badge.svg)](https://github.com/Soul-Brews-Studio/arra-oracle-v3/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-BUSL--1.1-blue)](./LICENSE) [![Bun](https://img.shields.io/badge/runtime-Bun%201.2%2B-f9f1e1)](https://bun.sh)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Soul-Brews-Studio/arra-oracle-v3)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSoul-Brews-Studio%2Farra-oracle-v3&env=ORACLE_URL&envDescription=Oracle%20HTTP%20API%20base%20URL%20for%20the%20Studio%20API%20proxy&envLink=https%3A%2F%2Fgithub.com%2FSoul-Brews-Studio%2Farra-oracle-v3%2Fblob%2Falpha%2Fdocs%2Fdeploy-vercel.md%23environment-variables&project-name=arra-oracle-studio&repository-name=arra-oracle-studio) — [Vercel quickstart](docs/deploy-vercel.md)

> Docker run → `arra mine ~/notes` → open the UI → search your memory.

Arra Oracle is the Oracle family's local memory and search layer. It stores your
notes in SQLite, searches them with FTS/vector-capable APIs, and exposes the same
memory through HTTP, MCP, the `arra` CLI, plugins, and the Studio UI.

## Quick start: Docker is the primary path

You only need Docker, `curl`, and a notes folder. This path starts the HTTP
server, mines `~/notes`, opens the built-in UI, and performs the first search.
No local Bun install, API key, schema choice, or vector service is required.

### 1. Run Arra Oracle

```bash
export ARRA_PORT="${ARRA_PORT:-47778}"
export ARRA_URL="http://127.0.0.1:${ARRA_PORT}"
export ARRA_CONTAINER="${ARRA_CONTAINER:-arra-oracle}"
export ARRA_VOLUME="${ARRA_VOLUME:-arra-oracle-data}"
export ARRA_NOTES_DIR="${ARRA_NOTES_DIR:-$HOME/notes}"

mkdir -p "$ARRA_NOTES_DIR"
docker volume create "$ARRA_VOLUME" >/dev/null

docker run --rm -d --name "$ARRA_CONTAINER" \
  -p "${ARRA_PORT}:47778" \
  -v "${ARRA_VOLUME}:/data" \
  -v "${ARRA_NOTES_DIR}:${ARRA_NOTES_DIR}:ro" \
  ghcr.io/soul-brews-studio/arra-oracle-v3:http

until curl -sf "${ARRA_URL}/api/health" >/dev/null; do sleep 1; done
echo "Arra Oracle is ready: ${ARRA_URL}"
```

If port `47778` is busy, run `export ARRA_PORT=47878` first. If your notes live
somewhere else, set `ARRA_NOTES_DIR=/path/to/notes` before `docker run`.

### 2. Mine your notes

Use the CLI bundled inside the running container so ingestion writes to the same
Docker volume as the server:

```bash
arra() {
  docker exec "$ARRA_CONTAINER" bun dist-cli/index.js "$@"
}

arra mine ~/notes
```

Re-running `arra mine` is safe: unchanged Markdown, MDX, and text files are
skipped with deterministic IDs. If you pointed `ARRA_NOTES_DIR` somewhere else,
run `arra mine "$ARRA_NOTES_DIR"`.

### 3. Open the UI

Open Simple Mode in your browser:

```bash
echo "${ARRA_URL}/simple"
```

Simple Mode shows health, save/search actions, and links to advanced surfaces.

### 4. Search

Use the UI search box, or call the HTTP API directly:

```bash
curl -sfS "${ARRA_URL}/api/v1/search?q=runbook&mode=fts&limit=5"
```

For grounded answers with citations:

```bash
curl -sfS "${ARRA_URL}/api/v1/ask" \
  -H 'content-type: application/json' \
  -d '{"q":"What did I write about runbooks?","limit":5,"llm":false}'
```

`"llm": false` keeps the answer extractive and local.

## Stop, restart, or inspect

```bash
curl -sf "${ARRA_URL}/api/health"
docker logs "$ARRA_CONTAINER"
docker stop "$ARRA_CONTAINER"
```

Restart later by re-running the `docker run` block. Your memory remains in the
Docker volume named by `$ARRA_VOLUME`.

## MCP clients with Docker

Use the stdio image when a desktop or agent needs Oracle MCP tools. It can share
the same Docker volume as the HTTP server:

```bash
claude mcp add arra-oracle -- docker run --rm -i \
  -e ORACLE_LOG_TARGET=stderr \
  -v "${ARRA_VOLUME:-arra-oracle-data}:/data" \
  ghcr.io/soul-brews-studio/arra-oracle-v3:stdio

claude mcp list
```

The MCP surface includes Oracle search, read, learn, recap, profile, research
note, trace, and tool-catalog capabilities.

## What ships

| Area | What it gives you |
| --- | --- |
| Docker HTTP image | Long-running local server on port `47778` with SQLite data in `/data`. |
| `arra mine` | First ingestion path for folders of `.md`, `.mdx`, and `.txt` notes. |
| Simple Mode UI | Browser entry point at `/simple` for health, save, and search. |
| HTTP API | `/api/v1/search`, `/api/v1/ask`, `/api/v1/learn`, vector status, plugins, menu, and MCP tool discovery. |
| MCP server | Stdio tool server for Claude, Codex, Docker MCP Toolkit, and agent fleets. |
| Memory contracts | Confidence-ranked retrieval, reversible supersede history, provenance, and tenant-scoped reads/writes. |
| Plugins | Unified manifests for CLI commands, API/menu rows, MCP tools, sidecars, exports, and lifecycle hooks. |
| Edge/frontends | Cloudflare Worker shapes, Vercel Studio proxy, React/Tauri Studio, and canvas surfaces. |

## Architecture at a glance

```text
Notes / agents / browsers / MCP clients
        │
        ├── Docker HTTP: ghcr.io/...:http on :47778
        ├── Docker stdio MCP: ghcr.io/...:stdio
        ├── CLI: arra mine/search/learn/export
        └── Studio and Simple Mode UI
                  │
        Elysia routes + MCP tools + plugin registry
                  │
        SQLite + FTS + optional vector stores + local vault files
```

The design goal is one memory core with thin adapters. CLI, HTTP, MCP, plugins,
canvas, and web/desktop surfaces reuse shared contracts instead of duplicating
business logic.

## Source development path

Use a local checkout only when editing Arra Oracle itself:

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3
bun install
bunx tsc --noEmit
bun run server
```

Then open `http://localhost:47778/simple` or call
`http://localhost:47778/api/v1/search?q=oracle&mode=fts`.

Useful checks before a PR:

```bash
bunx tsc --noEmit
bun test tests/http/<cluster>/
bun test tests/docs/link-checker.test.ts
```

Work targets `alpha`; never push or merge directly to `main`. Keep source, test,
and docs files at or below 250 lines.

## More docs

- [10-minute Docker quickstart](docs/QUICKSTART-10MIN.md)
- [Docker MCP Toolkit](docs/DOCKER-MCP-TOOLKIT.md)
- [HTTP API reference](docs/API-REFERENCE-INDEX.md)
- [Plugin quickstart](docs/plugin-quickstart.md)
- [DigitalOcean Docker deploy](docs/DEPLOY-DIGITALOCEAN.md)
- [Local development](docs/LOCAL-DEV.md)
- [Docs index](docs/README.md)
- [Changelog](CHANGELOG.md)

## License

Arra Oracle V3 is licensed under BUSL-1.1. See [LICENSE](LICENSE).

## Acknowledgments

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by Alex
Newman — process manager patterns, worker service architecture, and hook system
concepts.
