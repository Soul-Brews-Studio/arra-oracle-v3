# Memory Systems for AI Agents — Research Findings (#1648)

Status: research deliverable filed 2026-06-17 for issue #1648.

Purpose: make the current memory-systems research indexable by ARRA so future
agents can recover the design rules without rereading the whole issue thread.

## Direct recommendation

ARRA should remain a **provenance-first hybrid memory system**:

1. Keep durable truth in markdown/rule files that humans can review.
2. Use SQLite/Drizzle as the lifecycle ledger: tenant, provenance, validation,
   access, supersede, and retention metadata.
3. Use FTS5 + vector retrieval for working recall, always returning citations
   and query-time confidence explanations.
4. Expose memory through MCP/HTTP/CLI facades; do not treat MCP itself as the
   storage architecture.
5. Let agents propose memory, but require validation or review before a memory
   becomes trusted durable knowledge.

## Evidence used

Primary/upstream sources checked in this pass:

- MCP memory server source:
  <https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/memory/index.ts>
- MCP memory package page:
  <https://www.npmjs.com/package/@modelcontextprotocol/server-memory>
- Agent memory survey:
  <https://arxiv.org/abs/2603.07670>
- LangMem memory API:
  <https://langchain-ai.github.io/langmem/reference/memory/>
- LangMem background extraction guide:
  <https://langchain-ai.github.io/langmem/background_quickstart/>
- GitHub Copilot Memory docs:
  <https://docs.github.com/en/copilot/concepts/agents/copilot-memory>
- VS Code agent memory docs:
  <https://code.visualstudio.com/docs/agents/memory>
- GitHub Copilot memory architecture blog:
  <https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/>
- A-Mem paper page:
  <https://openreview.net/forum?id=FiM0M8gcct>

## Findings

### 1. MCP memory is a useful facade pattern, not enough backend

The official MCP memory server is a local JSONL knowledge graph with entities,
relations, observations, and a basic `search_nodes` tool. The source uses simple
case-insensitive substring matching over entity names, types, and observations.

ARRA consequence: keep ARRA's stronger hybrid retrieval as the backend and wrap
it with MCP tools. Do not downgrade to official server-memory semantics.

### 2. Production memory is a write-manage-read loop

The 2026 survey frames agent memory as write, manage, and read operations across
mechanisms such as context compression, retrieval stores, reflection,
hierarchical context, and learned management.

ARRA consequence: design every memory feature with all three paths:

- write: capture/propose/import;
- manage: validate/promote/archive/reindex/expire;
- read: scoped retrieval with citations and confidence.

### 3. Retrieval plus context injection remains the baseline

For coding agents, ranked retrieval into context is the practical first layer.
Graph and tiered memory can help later, but only after logs show relation misses
or repeated stale retrieval that chunks cannot solve.

ARRA consequence: improve citation quality, tenant filters, confidence, and
validation before adding graph schema complexity.

### 4. Scopes and expiry are product requirements, not UI extras

VS Code distinguishes user, repository, and session memory. Copilot Memory is
repository-scoped, cross-agent, verified before use, and expired automatically.
GitHub docs also distinguish repository facts from user preferences.

ARRA consequence: use explicit scopes:

- system: read-only ARRA defaults and docs;
- tenant/org: shared team decisions;
- project/repo: codebase facts;
- user/session: preferences and temporary working state.

Every scope needs retention and deletion rules.

### 5. Background extraction must be review-gated

LangMem supports both hot-path memory updates and background extraction with
`create_memory_store_manager`. This is useful for candidate generation, but it
also amplifies stale or inferred facts if writes become trusted automatically.

ARRA consequence: store extracted memories as `candidate` with source excerpts,
then require `validate` or `promote` before ranking them as trusted.

### 6. Dynamic graph memory is advanced, not first-phase

A-Mem proposes dynamic note attributes and links inspired by Zettelkasten. That
is promising for relation traversal and memory evolution, but it assumes the
basic storage, provenance, and validation loops already work.

ARRA consequence: add links only after search logs prove repeated failures that
hybrid retrieval cannot answer.

## ARRA implementation rules

1. **Files first**: durable learnings live under `ψ/learn/`, `ψ/memory/`, docs,
   or project rule files.
2. **Ledger second**: SQLite stores provenance, lifecycle, validation, scope,
   source hash, access stats, and supersede state.
3. **Derived confidence**: compute confidence at read time from match quality,
   validation status, recency, tenant scope, and contradiction state.
4. **Cited recall**: every memory result should include source path or URL,
   excerpt, timestamp, tenant scope, and confidence rationale.
5. **Review-gated capture**: MCP/HTTP may propose; CLI/UI should promote,
   archive, repair, and run destructive operations.
6. **Tenant before ranking**: filter by tenant/project before scoring or graph
   expansion so cross-tenant facts never leak through semantic similarity.

## Suggested next code hooks

- `memory_propose`: create candidate memory with source excerpt and tenant.
- `memory_validate`: verify local path/hash or remote excerpt and mark stale.
- `memory_promote`: write approved candidates into `ψ/learn/` or `ψ/memory/`.
- `memory_search`: return results with citations, confidence, and scope.
- `memory_doctor`: report orphaned vectors, stale hashes, and uncited memories.

## Non-goals

- Do not adopt marketing metrics such as token-reduction percentages without
  independent benchmarks.
- Do not require episodic/semantic/procedural taxonomy as a storage mandate.
- Do not let background extraction create silent permanent memory.
- Do not make graph traversal a prerequisite for basic agent recall.

## Bottom line

ARRA's advantage is already the combination of reviewable files, SQLite-backed
metadata, FTS5, vectors, and MCP surfaces. The safest path is to make that stack
more trustworthy: scoped writes, validated citations, derived confidence, and
operator-controlled promotion.
