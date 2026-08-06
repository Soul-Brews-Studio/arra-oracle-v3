# Simple Mode spec for non-developers

Simple Mode is the friendly first screen at `/simple`. It is additive: Advanced
Studio keeps its existing routes, but non-dev users can start here to see whether
Arra is working, search memory, save a memory, and learn what to do next.

Refs #2440.

## Non-dev promise

A person who does not know the codebase should be able to open:

```text
http://localhost:47778/simple
```

…and immediately answer three questions:

1. Is my Oracle reachable?
2. Can I search or save memories right now?
3. If not, what exact Docker or Bun command should I try next?

The page must never fail silently. Health is the gate and stays visible while the
user searches, saves, or reads recovery copy.

## Simple Mode layout

- **Health hero** at the top, backed by `GET /api/health` and a 10s poll.
- **Search card** with one visible query box, a button, debounce, and plain empty
  result copy.
- **Add-memory card** that posts to `/api/v1/learn` and announces success with
  `aria-live`.
- **Index-folder accordion** with local/Tauri gates and copy for `arra mine`.
- **Advanced Studio link** for users who want vectors, plugins, MCP tools, or
  route details.

## Health states and copy

| State | User-facing title | Meaning | Recovery guidance |
| --- | --- | --- | --- |
| Healthy | Awake and remembering | Backend, memory store, search, and plugins are ready enough to use. | Ask a question or add a memory. |
| Starting | Starting up… | Health is not ready yet, or the app is inside startup grace. | Wait briefly; after ~30s show retry/start commands. |
| Degraded FTS | Running, but search is limited | App is reachable, but vectors/search are not fully ready. | Save memories still works; rebuild or retry indexing for better search. |
| Degraded DB | Running, but memory storage needs help | Backend answered, but SQLite/data dir is not healthy. | Check `ORACLE_DATA_DIR`, permissions, and disk path. |
| Degraded plugin | Running, but a plugin needs attention | Core memory is up, but a plugin reports degraded/down. | Disable or fix the plugin; keep core search visible. |
| Down | Can't reach your Oracle | Polling `/api/health` failed or timed out after retries. | Show Docker and Bun start commands plus a Retry button. |

## Health state rules

- Poll `GET /api/health` every 10 seconds.
- Show `checked Xs ago` so a stale poll becomes obvious.
- Treat startup as temporary for the first few seconds.
- Escape startup after about 30 seconds into Down with recovery commands.
- Flip to Down after repeated failed polls instead of leaving stale green copy.
- Use degraded states when the backend answers but DB, plugins, or search/vector
  capability is limited.
- Prefer backend `healthStatus` (`healthy|starting|degraded|down`) and
  `subsystems.{db,fts,vector,plugin}` when present; fall back to legacy fields.

## README and recap entry points

- README should point non-dev users to `/simple` immediately after server start.
- `oracle_recap` should mention `/simple` so session wake-up output gives humans
  a visual health/search/save path, not only MCP tool names.
