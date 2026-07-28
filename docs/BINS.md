# Command bins

`arra-oracle-v3` ships two canonical command roles and two legacy aliases.

| Bin | Role | Entrypoint | Status |
| --- | --- | --- | --- |
| `arra-oracle` | Server runner | `bin/arra.ts` | Primary |
| `arra-cli` | Operator client | `cli/src/cli.ts` | Primary |
| `arra-oracle-v3` | Server runner | `bin/arra.ts` | Legacy alias, kept working |
| `arra-oracle-v2` | Stdio MCP server | `src/index.ts` | Legacy alias, kept working |

Do not add the bare `arra` bin: the npm package name is already taken by an
unrelated package, so `bunx arra` would be unsafe.

## Federation opt-in

Bare `arra-oracle serve` is network-silent by default: it serves core HTTP APIs
but does not mount maw peer discovery routes (`/info`, `/api/identity`) or emit
Scout multicast HELLO packets.

Enable federation explicitly for paired hosts:

```bash
FED_ENABLED=true arra-oracle serve
```

Equivalent plugin config also works:

```bash
ORACLE_ENABLED_PLUGINS=federation arra-oracle serve
```

`ORACLE_DISABLED_PLUGINS=federation` wins over an enable switch when both are
set, so deployment configs can force federation off.
