# Arra Oracle quickstart

A five-minute path from empty machine to searchable local Oracle memory.

One-line ingest if Bun is already installed:

```bash
bunx -p arra-oracle-v3 arra-oracle mine docs/sample-notes
```

## 1. Install

```bash
bun add -g github:Soul-Brews-Studio/arra-oracle-v3#vX.Y.Z
# alpha prerelease example: #vX.Y.Z-alpha.N
```

For latest alpha branch testing instead of a pinned tag:

```bash
bun add -g github:Soul-Brews-Studio/arra-oracle-v3#alpha
```

Verify the global `arra` command is on your `PATH`:

```bash
command -v arra
arra --version
```

## 2. Start the server

```bash
export ORACLE_DATA_DIR="$HOME/.oracle"
export ORACLE_PORT=47778
arra-oracle-v3 serve --port "$ORACLE_PORT"
```

Keep this shell open. In a second shell:

```bash
curl -sf "http://localhost:$ORACLE_PORT/api/health"
arra config add local "http://localhost:$ORACLE_PORT"
arra config use local
arra health
```

## 3. Mine the sample notes

```bash
arra mine docs/sample-notes
# or keep it live while editing notes:
# arra mine docs/sample-notes --watch
```

## 4. Search it

```bash
arra search "memory onboarding" --limit 5
arra read --help
arra list --limit 5
```

## 5. Connect MCP

Use the installed server bin in your MCP client config:

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

Then list tools in the client; expected tools include `oracle_search`,
`oracle_learn`, `oracle_read`, `oracle_list`, and trace/supersede helpers.

## 6. Add a plugin

```bash
arra plugin install github.com/owner/oracle-plugin --dry-run
arra plugin install github.com/owner/oracle-plugin
arra plugin list
```

A plugin repo needs a `plugin.json` and an entry module or artifact described by
that manifest. See [PLUGIN-GUIDE.md](./PLUGIN-GUIDE.md).

## Smoke checks

```bash
arra --help
arra health --json
curl -sf http://localhost:47778/api/health
```

If vectors are not configured yet, search still falls back to SQLite FTS5.
