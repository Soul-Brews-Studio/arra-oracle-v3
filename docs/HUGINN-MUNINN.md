# Huginn & Muninn taxonomy

Arra's memory surface has two legible halves:

- **Muninn = recall.** Arra is Muninn: remembering, searching, reading,
  tracing, and summarizing what is already in memory.
- **Huginn = capture now.** Huginn is the write-side practice: catching the
  current thought/session/handoff so Muninn has something truthful to recall
  later.

This is a conceptual taxonomy for operators and roadmap readers. It is **not a
rename** of the MCP API.

## Naming rule

Keep the current tool names:

- Canonical MCP tools stay `oracle_*`.
- Existing compatibility aliases such as `muninn_*` may continue to normalize to
  `oracle_*` where already supported.
- Do **not** add `huginn_*` aliases. Capture is a different verb and lifecycle,
  not the same recall tools renamed.

## Muninn: recall tools

Muninn answers: "What do we already know, where did it come from, and how do I
navigate it?"

| Tool family | Role |
| --- | --- |
| `oracle_search` | Find matching memory by keyword/vector search. |
| `oracle_read` | Read the full source for a search result or document id. |
| `oracle_list` | Browse indexed documents. |
| `oracle_stats` | Inspect database/vector health and counts. |
| `oracle_trace*` | Recall and navigate discovery traces (`oracle_trace_list`, `oracle_trace_get`, `oracle_trace_chain`, etc.). |

Because Arra is the recall layer, the older `muninn_*` compatibility spelling is
understandable as a recall alias. The canonical spelling remains `oracle_*`.

## Huginn: capture-now surfaces

Huginn answers: "What should be saved from this moment before it disappears?"

| Surface | Role | Status |
| --- | --- | --- |
| `oracle_learn` | Capture a pattern/learning and index it for immediate recall. | shipped |
| `oracle_handoff` | Capture session context into the inbox for a future session. | shipped |
| Write-time indexing | Make newly captured memory searchable without a separate manual pass when the write path supports it. | shipped for `oracle_learn`; expanding by roadmap |
| Auto-save hook | Passive Stop/PreCompact capture from session JSONL into memory. | planned in [tracker #49](https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/49) |
| `/huginn` skill | Human-facing capture ritual/command for saving the current thought. | roadmap |

Huginn should create or queue new memory. It should not be implemented as a
second name for recall calls like `oracle_search`.

## Relationship to `/munin`

`/munin` is the planned thin WHERE-finder skill for federated location and
lookup work. Track it in [tracker #50](https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/50).
When it lands, link it here as a Muninn-facing recall/navigation surface rather
than as a new canonical MCP prefix.

## Quick operator read

- If you are **finding** something: you are using Muninn/Arra recall.
- If you are **saving** something: you are using Huginn capture.
- If you are tempted to add `huginn_search` or `huginn_read`: stop. Those are
  recall actions and should stay `oracle_*`/existing `muninn_*` compatibility.
- If you are adding passive or active write capture, connect it to Huginn and
  make sure Muninn can recall it afterward.

## See also

- [mcp-tools.md](./mcp-tools.md) — canonical MCP tool reference.
- [TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md#mcp-tool-plugin-toggles) — tool group/config reference.
- [README.md](../README.md) — top-level docs navigation.
- [CHANGELOG.md](../CHANGELOG.md) — release notes.
