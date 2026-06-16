# Local Development

This repo ships three surfaces: the **MCP / HTTP server** (`src/server.ts`), the
**CLI** (`cli/`), and the **React frontend** (`frontend/`). For full local dev
you run all three in separate terminals.

## Prerequisites

- [Bun](https://bun.sh) `>= 1.3.0`
- [`gh`](https://cli.github.com/) (for issue / PR workflow)
- `curl` (for probing the HTTP API)

```bash
bun --version   # >= 1.3.0
gh --version
curl --version
```

From the repo root, install deps once:

```bash
bun install
```

## 1. Start the MCP / HTTP server

The server reads `ORACLE_PORT` (default `47778`, defined as
`ORACLE_DEFAULT_PORT` in `src/const.ts`) and exposes routes under `/api/*`
(e.g. `/api/health`, `/api/search`).

```bash
ORACLE_PORT=47778 bun run src/server.ts
```

Smoke test in another terminal:

```bash
curl http://localhost:47778/api/health
```

## 2. Run the CLI

The CLI is a separate package in `cli/` and talks to the server over HTTP.

```bash
cd cli
bun run src/cli.ts --help
```

Run a search:

```bash
bun run src/cli.ts search "oracle principles"
```

## 3. Run the React frontend

The frontend is in `frontend/`. The dev server proxies `/api` requests to the
backend (`http://127.0.0.1:47778` by default).

```bash
cd frontend
bun run dev
```

Vite prints the dev URL (default `http://localhost:3000`).

## CORS note

When the frontend and the MCP server run on different ports, the browser enforces
CORS. `src/server.ts` reads `CORS_ORIGIN` — set it to your frontend dev origin
if requests are blocked:

```bash
CORS_ORIGIN=http://localhost:4321 ORACLE_PORT=47778 bun run src/server.ts
```

**Fallback:** if you can't touch the server, set `FRONTEND_PROXY_TARGET` on the
frontend dev command to direct `/api` calls:

```bash
cd frontend
FRONTEND_PROXY_TARGET=http://localhost:47778 bun run dev
```

This is wired in `web/src/lib/backend.ts` and wins over `PUBLIC_BACKEND_URL`
only when no env var is set.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `EADDRINUSE: address already in use :47778` | Another process (or a stale server) holds the port | `lsof -i :47778` then kill, or pick a new port: `ORACLE_PORT=47779 bun run src/server.ts` |
| Browser console: `CORS error` / `blocked by CORS policy` | Server didn't allow the web origin | Start the server with `CORS_ORIGIN=http://localhost:4321`, or use the `?api=` fallback above |
| `bun: command not found` or syntax errors on startup | Bun missing or too old | Install / upgrade Bun (`curl -fsSL https://bun.sh/install \| bash`), confirm `bun --version` is `>= 1.3.0` |
