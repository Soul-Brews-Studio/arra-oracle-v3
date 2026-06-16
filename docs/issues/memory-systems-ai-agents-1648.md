# #1648 Memory Systems for AI Agents

Status: 2026-06-16 implementation summary for issue
[#1648](https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/1648).

This file promotes the issue research into a repo-local planning artifact. It
does not introduce a second memory backend; it records the architecture choices
that future implementation issues should follow.

## Research verdict

ARRA should stay a **provenance-first hybrid memory system**:

1. **Files are durable truth.** Keep reviewable knowledge in `ψ/memory/`, docs,
   and rule files so humans can diff and rebuild indexes.
2. **SQLite is the ledger.** Use Drizzle-managed metadata for tenant scope,
   provenance, validation status, access stats, and lifecycle state.
3. **FTS + vectors are working recall.** Continue retrieving ranked chunks,
   then package them with citations for agent context.
4. **MCP is a facade.** Expose ARRA memory/search through MCP tools; do not copy
   the official MCP memory server as the storage engine.
5. **Capture is review-gated.** Auto-extracted notes are candidates until a
   human or trusted policy promotes them into durable memory.

## Confirmed findings to carry forward

| Finding | Design consequence |
| --- | --- |
| Official MCP memory is graph + substring search, not vector recall | Keep ARRA's stronger hybrid store and wrap it with MCP compatibility |
| Retrieval plus context injection is the practical baseline | Improve ranking, provenance, and tenant scope before adding graph memory |
| Static rule files dominate coding assistants | Treat files as the portable memory layer and index them rather than replacing them |
| Query-time confidence avoids silent drift | Derive trust at read time from validation, freshness, access, and supersede state |
| LangMem-style background extraction is useful | Model it as candidate generation, not automatic trusted writes |
| Product memory needs citation validation | Recheck path/hash/symbol anchors before ranking repo facts highly |

## ARRA taxonomy

Use these names consistently:

- **Durable knowledge memory**: `oracle_documents`, `oracle_fts`, vector
  collections, and source files under `ψ/memory/` or docs.
- **Lightweight personal memory**: `oracle_memories` and `/api/memory/*`.
- **Trace/session memory**: `trace_log`, handoffs, inbox, and distillation
  artifacts.

The taxonomy keeps `/api/memory/*` from being confused with the canonical
knowledge corpus.

## Implementation sequence

### Phase 1 — contract and visibility

- Keep this summary and the `ψ/memory/ai-memory-*` filings as the source
  references for future issues.
- Add or update API docs when memory endpoints expose provenance, lifecycle, or
  confidence fields.
- Keep Huginn/Muninn language aligned: Huginn captures, Muninn recalls.

### Phase 2 — confidence and validation

- Add a small query-time confidence service before changing ranking.
- Inputs should include validation status, source hash/path, supersede state,
  access count, updated/indexed timestamps, tenant scope, and vector health.
- Return confidence metadata and warnings first; only alter ranking after
  measuring false positives.

### Phase 3 — review-gated writes

- Add `memory_propose` for untrusted candidates with complete provenance.
- Add `memory_validate` for local file path/hash and remote excerpt checks.
- Add CLI/UI `memory promote`, `archive`, `reindex`, and `doctor` operations.
- MCP write tools should stay narrow and admin-scoped; CLI/UI own destructive
  or durable promotion workflows.

### Phase 4 — interoperability and graph links

- If LangMem compatibility is needed, implement it as an adapter over existing
  `oracle_search`, `oracle_learn`, `oracle_read/list`, tenant, and supersede
  metadata.
- Add graph/tiered memory only when search logs show repeated relation misses,
  stale retrievals, or trace chains that cannot distill into useful chunks.

## Multi-tenant guardrails

- Derive tenant identity from authenticated request context.
- Keep `tenant_id` in SQL metadata and vector collection/path scoping.
- Treat global/system memory as read-only unless explicitly shared.
- Verify tenant-scoped vector search end to end before advertising semantic
  multi-tenant memory beyond FTS-safe paths.

## Source filings

- `ψ/memory/ai-memory-systems-research.md`
- `ψ/memory/ai-memory-systems-claims-ledger.md`
- `ψ/memory/ai-memory-product-patterns-2026.md`
- `ψ/memory/ai-agent-memory-recommendations-1648.md`
- `docs/HUGINN-MUNINN.md`
