# AI Memory Systems Research for ARRA Oracle V3

Source: GitHub issue #1648, "Memory Systems for AI Agents — Deep Research Findings (2026)", plus issue comments with product-by-product memory architecture notes.

## Filing map

This research is split into three reviewable files:

- `ψ/memory/ai-memory-systems-research.md` — ARRA architecture synthesis and roadmap.
- `ψ/memory/ai-memory-systems-claims-ledger.md` — confirmed/refuted claim ledger from #1648.
- `ψ/memory/ai-memory-product-patterns-2026.md` — product-by-product memory pattern filing.
- `ψ/memory/ai-agent-memory-recommendations-1648.md` — implementation-ready recommendations.

## Executive summary

ARRA Oracle V3 should treat memory as a layered system, not a single feature. The strongest pattern for coding assistants is:

1. **Ground truth in files**: durable markdown/rules/design artifacts remain human-reviewable and git-friendly.
2. **SQLite as index/state**: relational metadata, validation status, tenants, access logs, and lifecycle state.
3. **Vector + FTS retrieval as working memory**: query-time retrieval over chunks, hybrid scoring, and citations.
4. **MCP as interoperability surface**: expose the memory/search capability to agents without making MCP the storage engine.
5. **CLI as operational surface**: import/export, repair, reindex, inspect, migrate, and review memory outside chat.

Recommendation: keep ARRA's vector/FTS search core, add stronger memory lifecycle metadata, expose a narrower MCP memory API, and provide CLI-first admin workflows. Do not clone the official MCP memory server as the backend; its official implementation is a local JSONL knowledge graph with substring search only.

## Comparison: MCP vs CLI vs Vector memory

| Surface | Best role | Strengths | Weaknesses | ARRA recommendation |
| --- | --- | --- | --- | --- |
| MCP memory | Agent-facing protocol | Portable across MCP clients; low-friction tool calls; can expose typed operations like search, write, link, validate | Official server-memory is basic substring search; protocol does not solve ranking, trust, tenant isolation, or lifecycle by itself | Use MCP as the external API over ARRA's stronger store, not as the canonical backend |
| CLI memory | Human/operator surface | Scriptable, reviewable, CI-friendly; good for import/export, migrations, audits, compaction, repair, and reproducible workflows | Poor interactive retrieval UX unless paired with search; can become opaque if commands mutate too much silently | Make CLI the durable operations layer: `memory import/export/search/validate/reindex` |
| Vector memory | Retrieval/ranking engine | Semantic recall, hybrid FTS + embeddings, scalable chunk retrieval, citations, multi-model fanout | Needs chunking, embedding cost, stale-data handling, dimensional migrations, and query-time trust scoring | Keep as core working memory; add validation/citation/time-decay metadata and tenant scoping |
| Static rules/files | Instruction memory | Transparent, version-controlled, portable across tools, resistant to auto-memory poisoning | Token tax if always injected; no semantic recall; can drift from indexed DB | Keep as source of truth for principles, conventions, and design decisions |
| Auto-extracted memories | Convenience layer | Captures user preferences and repeated patterns without manual filing | Opaque, stale, injection-prone, hard to audit; evidence in #1648 shows many marketing claims are weak | Avoid silent writes by default; require review/approval before promotion into durable memory |

## What the research says

## 2026-06-16 verification pass

The existing doc covered the issue findings and ARRA recommendations. This pass
verified the claims against primary/upstream sources and filled two gaps:
explicit source URLs, and a boundary for when graph/tiered memory should be
considered.

Verified sources:

- Official MCP memory server source:
  <https://github.com/modelcontextprotocol/servers/blob/main/src/memory/index.ts>
  confirms a local knowledge-graph server with basic substring-style node search,
  so ARRA should expose its stronger store through MCP instead of cloning that
  backend.
- MCP memory package page:
  <https://www.npmjs.com/package/@modelcontextprotocol/server-memory> confirms
  the official package is intentionally a basic persistent-memory implementation.
- Agent memory survey:
  <https://arxiv.org/abs/2603.07670> frames agent memory as a write-manage-read
  loop and surveys retrieval stores, compression, reflection, hierarchical
  context, and learned management through early 2026.
- LangMem upstream docs:
  <https://langchain-ai.github.io/langmem/> and
  <https://langchain-ai.github.io/langmem/background_quickstart/> confirm the
  open-source SDK and background extraction/consolidation pattern.
- Memex MCP docs:
  <https://mcpservers.org/servers/stifler7/memex> support query-time confidence
  as a useful pattern, but the evidence remains supplemental because it is not a
  broad production benchmark.
- A-Mem paper page:
  <https://openreview.net/forum?id=FiM0M8gcct> supports graph-like dynamic
  indexing as a promising advanced direction, not a prerequisite baseline.

Completeness verdict: the document is complete enough for ARRA planning if it
keeps retrieval-first memory as the default, treats LangMem/A-Mem-style systems
as later interoperability or graph layers, and avoids adopting vendor marketing
claims without independent benchmarks.


### Official MCP memory is not enough

Issue #1648 confirms the official `@modelcontextprotocol/server-memory` stores entities, relations, and atomic observations in a local JSONL knowledge graph. Its search is substring matching, not embeddings or hybrid retrieval. That makes it useful as a protocol example, but not as a storage/search architecture for ARRA.

ARRA is already ahead on retrieval quality because it has vector similarity, multiple embedding models, and FTS5 hybrid search. The right move is to expose ARRA memory through MCP, not replace ARRA memory with the official MCP memory implementation.

### Static files remain the dominant coding-assistant memory

The issue comments show convergence around file-based rules: Cursor `.cursor/rules`, Copilot instructions, Zed `AGENTS.md`/`CLAUDE.md`/other rule files, Continue rules, Aider conventions, and Windsurf rules. Files win because they are explicit, portable, auditable, and source-controlled.

For ARRA, this supports the existing design principle: ground truth = files, database = rebuildable index. Important memories should be promotable into markdown under `ψ/memory/`, repo docs, or rules files.

### Context + retrieval store is the practical baseline

The confirmed finding calls "retrieve relevant chunks, inject into context" the production workhorse. It is simpler and more reliable than building a full autonomous memory graph first. ARRA should improve this baseline before adding complex episodic/semantic/procedural taxonomies.

Signals that ARRA may need more than Pattern B later:

- repeated stale retrievals from moved/deleted files;
- no way to distinguish validated facts from speculative notes;
- cross-session memories conflict without provenance;
- tenant/org boundaries require separate trust and retention rules;
- tool clients need graph traversal instead of ranked text chunks.

### Query-time confidence beats stored static confidence

The issue notes a useful pattern: compute confidence at query time from base confidence, validation status, time decay, and access count. For ARRA, confidence should be a derived retrieval field, not a permanent claim that silently ages.

Recommended metadata:

- `source_path` / `source_url`;
- `source_sha` or content hash;
- `created_at`, `updated_at`, `last_validated_at`, `last_accessed_at`;
- `validation_status`: `unvalidated`, `validated`, `stale`, `contradicted`;
- `tenant_id` / project scope;
- `memory_kind`: `rule`, `decision`, `fact`, `preference`, `episode`, `procedure`;
- `promotion_status`: `candidate`, `approved`, `archived`.

### Citation validation is a high-value pattern

GitHub Copilot Memory's notable pattern is citation validation: before applying a memory, check that the cited code still exists. ARRA can adopt this directly because it controls indexing and file metadata.

For local files, validate by path + hash + optional symbol anchor. For remote sources, validate by URL + fetched timestamp + excerpt hash where available. If validation fails, the memory can still be returned, but it should be marked stale and ranked lower.

### Auto-extraction should be review-gated

ChatGPT and Windsurf demonstrate auto-created memories, but the issue highlights risks: opacity, stale facts, unsupported inferences, and memory poisoning. ARRA should not silently persist agent-generated memories as trusted facts.

Safer ARRA flow:

1. Agent proposes a memory candidate.
2. Candidate is stored as `unvalidated` with full provenance.
3. CLI/UI review promotes it to durable markdown or validated DB memory.
4. Retrieval ranks approved/validated memory above unreviewed candidates.

## Recommended ARRA architecture

```text
Human/agent input
  -> CLI / HTTP / MCP write surface
  -> candidate memory queue
  -> review/promotion step
  -> markdown source of truth + SQLite metadata
  -> chunker/indexer
  -> FTS5 + vector indexes
  -> MCP/HTTP/CLI search
  -> context injection with citations + confidence
```

### Storage model

- **Markdown files** in `ψ/memory/` and project docs for durable knowledge.
- **SQLite/Drizzle** for metadata, lifecycle, validation, tenant scope, and access stats.
- **Vector stores** for embeddings, scoped by tenant/project and collection.
- **FTS5** as the lexical fallback and precision anchor.

### MCP surface

Expose high-level tools rather than raw storage:

- `memory_search(query, filters)` returns cited chunks, confidence, and validation status.
- `memory_propose(observation, source)` creates a reviewable candidate.
- `memory_get(id)` returns full provenance and current validation state.
- `memory_validate(id)` checks source existence/hash and updates derived status.

Keep destructive writes and migrations out of MCP unless explicitly admin-scoped.

### CLI surface

The CLI should own operational workflows:

- `memory import <path>`;
- `memory export --format markdown|jsonl`;
- `memory search <query> --tenant <id>`;
- `memory validate --stale-after 30d`;
- `memory promote <candidate-id> --to ψ/memory/...`;
- `memory reindex --tenant <id>`;
- `memory doctor` for drift, orphaned vectors, and broken citations.

### Vector retrieval surface

Keep the current vector strategy, but make memory retrieval trust-aware:

1. Candidate generation: hybrid vector + FTS.
2. Scope filter: tenant/project/tool surface.
3. Validation boost: validated citations rank above unvalidated notes.
4. Freshness adjustment: stale/contradicted facts rank lower or require explicit opt-in.
5. Citation packaging: return source path, excerpt, timestamp, and confidence explanation.

## Multi-tenant implications

Memory must follow the same isolation strategy as HTTP data:

- derive tenant from authenticated request context, not arbitrary client input;
- include `tenant_id` in SQLite metadata;
- isolate vector collections by tenant prefix or tenant directory;
- keep global/system memory read-only or explicitly shared;
- include tenant scope in MCP tools so an agent cannot cross-query another org by accident.

Recommended tenant tiers:

1. **System memory**: ARRA defaults and public docs, read-only.
2. **Org memory**: shared team decisions and docs, tenant-scoped.
3. **Project memory**: repo/workspace-specific facts.
4. **User/session memory**: optional preferences, most restrictive and easiest to delete.

## Implementation roadmap

### Phase 1: Documented memory contract

- Define memory kinds, lifecycle states, and confidence formula.
- Document MCP/CLI/HTTP responsibilities.
- Require provenance for every durable memory.

### Phase 2: Metadata + validation

- Add Drizzle-managed memory metadata tables.
- Store source hashes, validation status, tenant scope, and access stats.
- Add citation validation for local files.

### Phase 3: Review-gated memory writes

- Add candidate queue for proposed memories.
- Add CLI/UI promotion and archive flows.
- Keep auto-extraction disabled or review-only by default.

### Phase 4: MCP memory facade

- Wrap ARRA search as typed MCP tools.
- Return citations, confidence, validation state, and tenant scope.
- Add admin-only validation/reindex tools later.

### Phase 5: Advanced graph/tiered memory only if needed

Do not start with a complex graph memory system. Add entity/relation extraction only after retrieval logs show that ranked chunks and citations cannot answer common agent questions.

## Bottom line

ARRA Oracle V3 should be a retrieval-first, file-grounded memory system with MCP interoperability and CLI-grade operations. MCP is the protocol, CLI is the operator control plane, SQLite is the metadata ledger, and vector + FTS is the recall engine.

The safest product stance is: **no silent permanent memory**. Let agents propose; let humans or trusted workflows promote; let retrieval explain confidence with citations.
