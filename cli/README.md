# arra-cli CLI

`arra-cli` is the command-line interface for ARRA Oracle V3 — a plugin-based CLI that wraps the arra-oracle-v3 MCP tools (`muninn_search`, `muninn_learn`, `muninn_list`, `muninn_trace`, and more) so humans can call them directly from the shell. Plugins live in `src/plugins/` (bundled) or `~/.neo-arra/plugins/` (user-installed), each providing a `plugin.json` manifest and a default-export handler.

```
arra-cli --help
```
