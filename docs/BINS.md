# Command bins

`arra-oracle-v3` exposes one server runner and one operator CLI, plus legacy
aliases kept for existing installs.

| Bin | Role | Entrypoint | Status |
| --- | --- | --- | --- |
| `arra-oracle-v3` | HTTP/MCP server runner | `bin/arra.ts` | Primary server bin |
| `arra` | Operator CLI and plugin dispatcher | `cli/src/cli.ts` | Primary operator bin |
| `arra-cli` | Operator CLI alias | `cli/src/cli.ts` | Legacy-compatible alias |
| `arra-oracle-v2` | Stdio MCP server alias | `src/index.ts` | Legacy-compatible alias |

Recommended usage after global install:

```bash
arra-oracle-v3 serve --port 47778
arra-oracle-v3 mcp
arra config add local http://localhost:47778
arra config use local
arra health
arra plugin list
```

Do not rely on the old `arra-oracle` name unless a downstream package explicitly
provides it. New docs should use `arra-oracle-v3` for the server and `arra` for
operator/plugin commands.

## Federation opt-in

Bare `arra-oracle-v3 serve` is network-silent by default: it serves core HTTP
APIs but does not mount maw peer discovery routes (`/info`, `/api/identity`) or
emit Scout multicast HELLO packets.

Enable federation explicitly for paired hosts:

```bash
FED_ENABLED=true arra-oracle-v3 serve
```

Equivalent plugin config also works:

```bash
ORACLE_ENABLED_PLUGINS=federation arra-oracle-v3 serve
```

`ORACLE_DISABLED_PLUGINS=federation` wins over an enable switch when both are
set, so deployment configs can force federation off.
