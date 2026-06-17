# Arra Oracle easy install

Goal: install Arra Oracle like a plugin, start the HTTP/MCP surfaces, then add
Oracle plugins without cloning the repo unless you are developing core code.

Use this guide for tagged alpha releases. Use `#alpha` only when you explicitly
want the moving branch head.

## Prerequisites

- Bun `>=1.2` in `PATH`.
- Optional: Docker Desktop/Engine for container installs.
- Optional: `ghq` if you use `arra plugin install github.com/owner/repo`.

## Fast path: global Bun install

Pick a released tag from GitHub Releases, then install the package globally:

```bash
bun add -g github:Soul-Brews-Studio/arra-oracle-v3#vX.Y.Z
# alpha prerelease example: #vX.Y.Z-alpha.N
```

Development/head install:

```bash
bun add -g github:Soul-Brews-Studio/arra-oracle-v3#alpha
```

Verify the installed bins:

```bash
arra-oracle-v3 --help     # HTTP/MCP server runner
arra --version            # operator CLI
arra --help
```

The current package also keeps legacy aliases (`arra-cli`, `arra-oracle-v2`). Use
`arra-oracle-v3` for new server docs and `arra` for operator commands.

## First server

Choose a data directory and start the HTTP API:

```bash
export ORACLE_DATA_DIR="$HOME/.oracle"
export ORACLE_PORT=47778
arra-oracle-v3 serve --port "$ORACLE_PORT"
```

From another shell:

```bash
curl -sf "http://localhost:$ORACLE_PORT/api/health"
arra config add local "http://localhost:$ORACLE_PORT"
arra config use local
arra health
```

Expected health includes `status: ok` / `server: arra-oracle-v3`.

## First memory

Store and search a small learning:

```bash
arra learn "Arra Oracle is installed from a pinned GitHub tag." \
  --source "quickstart"

arra search "pinned GitHub tag" --limit 5
arra list --limit 5
```

If vectors are unavailable, FTS5 still works; vector backfill can happen later.

## MCP stdio client setup

Use the same installed package as an MCP server. Keep logs on stderr so stdout
stays valid JSON-RPC:

```json
{
  "mcpServers": {
    "arra-oracle": {
      "command": "arra-oracle-v3",
      "args": ["mcp"],
      "env": {
        "ORACLE_LOG_TARGET": "stderr",
        "ORACLE_DATA_DIR": "~/.oracle"
      }
    }
  }
}
```

For HTTP-proxy MCP mode, point stdio clients at an already running HTTP server:

```json
{
  "mcpServers": {
    "arra-oracle": {
      "command": "arra-oracle-v3",
      "args": ["mcp"],
      "env": {
        "ORACLE_LOG_TARGET": "stderr",
        "ORACLE_HTTP_URL": "http://localhost:47778"
      }
    }
  }
}
```

## Plugin-style install

Arra plugins live under parent-walk `.maw/plugins`, `$MAW_PLUGINS_DIR`, `~/.maw/plugins`, `~/.arra/plugins`, and `~/.oracle/plugins`. Install from a
repo, local path, or prebuilt artifact:

```bash
arra plugin install github.com/owner/oracle-plugin
arra plugin install ./local-plugin --dry-run
arra plugin install --artifact https://example.com/plugin.wasm \
  --manifest https://example.com/plugin.json
arra plugin list
```

A source plugin needs `plugin.json`; a WASM artifact install can either provide a
manifest URL or let the CLI synthesize one from the artifact name. Re-run with
`--force` to overwrite an existing plugin install.

## Source development install

Use source only when editing core code:

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3
bun install
bunx tsc --noEmit
bun run server
```

Useful checks:

```bash
bun test tests/http/health/
bun test src/tools/__tests__/
```

## Docker install

HTTP API image:

```bash
docker run --rm -p 47778:47778 -v arra-oracle-data:/data \
  ghcr.io/soul-brews-studio/arra-oracle-v3:http
curl -sf http://localhost:47778/api/health
```

MCP stdio image:

```bash
docker run --rm -i -e ORACLE_LOG_TARGET=stderr -v arra-oracle-data:/data \
  ghcr.io/soul-brews-studio/arra-oracle-v3:stdio
```

Docker MCP Toolkit catalog:

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3
docker mcp profile create --name arra-oracle \
  --server file://$(pwd)/catalog/arra-oracle.yaml
docker mcp client connect claude-desktop --profile arra_oracle
```

## Common setup knobs

| Need | Knob |
| --- | --- |
| Data directory | `ORACLE_DATA_DIR=$HOME/.oracle` |
| HTTP port | `ORACLE_PORT=47778` or `--port 47778` |
| Protected HTTP writes | `ARRA_API_TOKEN=<token>` |
| Tenant-scoped HTTP | `ORACLE_TENANT_TOKENS='team=<token>'` + `X-Oracle-Tenant` |
| MCP proxy mode | `ORACLE_HTTP_URL=http://localhost:47778` |
| Stdio-safe logs | `ORACLE_LOG_TARGET=stderr` |
| Disable embeddings | `ORACLE_EMBEDDER=none` |

## Troubleshooting

### `command not found: arra-oracle-v3`

Check Bun's global bin directory is on `PATH`:

```bash
bun pm bin -g
```

Add that directory to your shell profile, then restart the shell.

### Port already in use

```bash
ORACLE_PORT=47881 arra-oracle-v3 serve --port 47881
arra config add local-47881 http://localhost:47881
arra config use local-47881
```

### MCP client shows JSON parse errors

Set `ORACLE_LOG_TARGET=stderr`. Do not print logs to stdout in stdio mode.

## Next

- [QUICKSTART.md](./QUICKSTART.md) — five-minute first run.
- [PLUGIN-GUIDE.md](./PLUGIN-GUIDE.md) — author unified plugins.
- [BINS.md](./BINS.md) — command roles and aliases.
- [FEDERATION.md](./FEDERATION.md) — peer pairing and security.
- [vector-runtime.md](./vector-runtime.md) — vector backend configuration.
