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
