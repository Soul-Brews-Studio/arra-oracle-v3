# AI Memory Systems Claims Ledger — #1648

Source: issue #1648 and verified issue comments from 2026-06-16. This file is the compact claim ledger for future implementation decisions.

## Confirmed findings

| Claim | Confidence | Evidence | ARRA consequence |
| --- | --- | --- | --- |
| Official MCP memory is local graph + substring search, not vector memory | High | `@modelcontextprotocol/server-memory` source and package docs | Expose ARRA through MCP; do not copy the official server as backend |
| Retrieval store + context injection is the practical baseline | Medium | 2026 agent memory survey cited in #1648 | Improve hybrid FTS/vector retrieval before graph complexity |
| Query-time confidence is safer than static stored confidence | Low/medium | Memex-style confidence formula and issue verification | Store provenance and validation fields; derive confidence at read time |
| LangMem demonstrates self-hostable background extraction | Medium | LangMem upstream docs | Treat as an interoperability/reference pattern, not a required dependency |
| Citation validation prevents stale coding memories | Medium/high | GitHub Copilot Memory pattern from issue comments | Validate path/hash/symbol anchors before ranking memory highly |
| Static rules files are the coding-assistant common denominator | High | Cursor, Copilot, Zed, Aider, Continue, Windsurf comments | Keep `ψ/memory/`, AGENTS/CLAUDE docs, and rules files as durable source of truth |

## Refuted or unsafe claims

| Claim | Verdict | Reason to avoid |
| --- | --- | --- |
| Mem0 80% token reduction | Refuted | Marketing claim without independent benchmark in issue evidence |
| codebase-memory-mcp 99.2% token reduction | Refuted | Unverifiable and too precise for planning |
| Eve Memory 94.4% LongMemEval | Refuted | Marketing copy; not a product baseline |
| Long context always loses to dedicated memory | Refuted | Overstated; context injection remains valid for small/medium memory |
| RAG beats pure long-context across the board | Refuted | Depends on corpus size, task, retrieval quality, and context budget |
| File markdown is always optimal | Refuted | Files are best for ground truth, not for ranked semantic recall |
| Vector DBs degrade 25% at 10x scale | Refuted | No primary source in the issue |
| Episodic+semantic+procedural split is mandatory | Refuted | Useful taxonomy, but premature as a storage mandate |

## Decision rules for ARRA

1. Prefer **retrieval-first memory**: hybrid FTS/vector with citations.
2. Promote durable memories into **files first**, then index them.
3. Keep SQLite as metadata ledger: tenant, validation, provenance, access stats.
4. Make MCP a typed facade over ARRA, not the storage engine.
5. Keep automatic extraction review-gated to reduce poisoning and stale facts.
6. Add graph/tiered memory only when retrieval logs show ranked chunks cannot answer recurring agent questions.

## Implementation hooks

- `memory_search`: cited chunks + validation state + confidence explanation.
- `memory_propose`: unvalidated candidate with full provenance.
- `memory_validate`: path/hash/URL validation and stale marking.
- `memory_promote`: approved candidate to markdown under `ψ/memory/`.
- `memory_reindex`: tenant/project scoped index refresh.
