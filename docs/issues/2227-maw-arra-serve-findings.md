# #2227 maw arra serve path findings

## Scope

Verify the current `maw arra serve` path for the modular backend design and
identify gaps before making the backend a fully installable maw plugin surface.

## Evidence checked

- Issue #2227 vision and acceptance criteria.
- Built-in ARRA plugin manifest: `src/plugins/arra/plugin.json`.
- Built-in ARRA plugin CLI dispatcher: `src/plugins/arra/index.ts`.
- Serve implementation: `src/plugins/arra/serve-cli.ts`.
- Legacy/package plugin surface: `maw-plugin/index.ts`, `maw-plugin/serve.ts`.
- Tests: `src/plugins/__tests__/arra-plugin.test.ts` and
  `maw-plugin/__tests__/serve.test.ts`.
- Runtime smoke using `serveCli` with an isolated `ORACLE_DATA_DIR` and random
  local port.

## Findings

1. `src/plugins/arra` is the current in-repo maw plugin surface for ARRA.
   Its manifest exposes CLI command `arra` and verb `serve`.
2. `arraCli()` dispatches `serve` to `serveCli(argv(ctx).slice(1))`.
3. `serveCli()` starts the backend by spawning `bun run server` with:
   - `cwd`: `deps.cwd`, `ORACLE_REPO_ROOT`, or `process.cwd()`
   - `PORT` and `ORACLE_PORT` set to the requested port
   - detached stdio ignored
   - PID metadata written through `src/process-manager`
4. Code-level verification passed: the plugin serve path started the HTTP
   backend and `/api/health` returned HTTP 200 with `status: ok`.
5. Existing scoped tests already cover start/status/stop behavior for both the
   built-in plugin path and the legacy `maw-plugin` path.

## Runtime verification

```bash
ORACLE_DATA_DIR=/tmp/arra-2227-* ORACLE_REPO_ROOT=$PWD bun - <<'TS'
import { serveCli } from "./src/plugins/arra/serve-cli.ts";
await serveCli(["--port", "57927"]);
await serveCli(["--status", "--json", "--port", "57927"]);
await fetch("http://127.0.0.1:57927/api/health");
await serveCli(["--stop", "--port", "57927"]);
TS
```

Observed result:

- Start returned `ok: true`.
- Status returned `running: true`, `healthy: true`, `url:
  http://127.0.0.1:57927`.
- `/api/health` returned HTTP 200 and `status: ok`.
- Stop returned `ok: true` and removed the tracked server process.

## Gap analysis

### Working now

- The in-repo plugin implementation can start the backend.
- The backend loads with the built-in `arra` plugin registered.
- Vector is already reported separately in health as disabled/down when local
  vector storage is not configured, matching the issue's separate vector-server
  direction.

### Gaps before acceptance can be fully checked from `maw arra serve`

1. The host `maw` installation used for this verification does not currently
   expose `maw arra`; `maw arra help` returns `unknown command: arra`.
2. The verified runtime path is direct plugin code (`serveCli`), not the external
   installed maw CLI command.
3. Packaging/installation wiring is still needed so the installed maw plugin
   loader discovers this repo's `src/plugins/arra` or packaged `maw-plugin` as
   the `arra` command.
4. The backend is still started as `bun run server`; endpoint registration is
   plugin-discovered at server boot, but the backend process is not yet a pure
   standalone plugin server manifest (`server.command`) surface.
5. End-to-end Workers → backend → vector DB was not verified here; this pass only
   validates the backend start path and documents remaining integration gaps.

## Recommendation

Treat `serveCli` as the reference backend-start implementation, then add the
missing maw plugin install/discovery wiring so the acceptance test can become:

```bash
maw arra serve --port <port>
maw arra serve --status --port <port>
curl http://127.0.0.1:<port>/api/health
maw arra serve --stop --port <port>
```
