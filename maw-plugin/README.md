# maw arra plugin

Compact `maw arra` commands for the ARRA Oracle HTTP API. The plugin is a thin 1:1 CLI surface over the Oracle MCP tools, using `ORACLE_API` as the base URL and falling back to `http://localhost:47778`.

## Install

```sh
ln -s $(pwd)/maw-plugin ~/.maw/plugins/arra
maw plugin enable arra
```

## Auth

Read commands are open. Write commands attach `Authorization: Bearer $ARRA_API_TOKEN` when `ARRA_API_TOKEN` is set, matching the `/api/learn` token gate.

## Commands

```sh
maw arra help
maw arra frontend          # opens https://studio.buildwithoracle.com/?api=<backend>
maw arra ui --no-open      # prints the link only
maw arra serve             # starts bun run server in the background
maw arra serve --status    # checks PID + /api/health
maw arra serve --stop      # stops the PID from ~/.arra-oracle-v2/server.pid
maw arra serve --port 47779
maw arra search "query" --mode fts --limit 5
maw arra learn "new project fact" --project my-repo
maw arra stats
maw arra health
maw arra index --project my-repo --path /path/to/vault
maw arra scan
maw arra plugins
maw arra settings
maw arra feed
maw arra menu
maw arra vector
maw arra vector-config
maw arra vector-config --json

maw arra trace "investigate auth loop" --scope project
maw arra trace_list --status raw --limit 10
maw arra trace_get <traceId> [--include-chain]
maw arra trace_link <prevTraceId> <nextTraceId>
maw arra trace_unlink <traceId> --direction next
maw arra trace_chain <traceId>

maw arra concepts --limit 20
maw arra handoff "handoff text" --slug next-step
maw arra inbox --type handoff --limit 10
maw arra list --type learning --limit 20
maw arra read --id <docId>
maw arra reflect
maw arra supersede <oldId> <newId> --reason "merged duplicate"

maw arra thread "message" --thread-id 42 --title "Investigation"
maw arra threads --status active --limit 10
maw arra thread_read 42
maw arra thread_update 42 --status closed
maw arra verify --check false --type learning
```

`serve` resolves the repo root from `ORACLE_ROOT` or `ghq locate`, writes `~/.arra-oracle-v2/server.pid`, and passes `--port` as `ORACLE_PORT`.

`frontend`, `ui`, and `open` construct `/?api=<backend>` from `ARRA_FRONTEND_URL` (default `https://studio.buildwithoracle.com`) and `ORACLE_API`.

Hyphenated aliases work for underscored commands, e.g. `trace-get` and `thread-update`.
