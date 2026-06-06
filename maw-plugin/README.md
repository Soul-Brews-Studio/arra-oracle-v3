# maw arra plugin

`maw arra` is a compact ARRA Oracle HTTP client for the maw plugin system.

## Install from this repo

```bash
ln -s $(pwd)/maw-plugin ~/.maw/plugins/arra
maw plugin enable arra
```

## Usage

```bash
maw arra health
maw arra stats
maw arra search "oracle memory" --mode fts --limit 5
maw arra learn "FTS stays useful before vectors" --project arra-oracle-v3
maw arra trace
maw arra trace <trace-id>
```

The base URL resolves from `ORACLE_API`, then `NEO_ARRA_API`, then `http://localhost:47778`.

`learn` sends `Authorization: Bearer $ARRA_API_TOKEN` when `ARRA_API_TOKEN` (or `NEO_ARRA_API_TOKEN`) is set, matching the optional HTTP write gate.
