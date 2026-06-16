# AI Agent Memory Recommendations — #1648

Status: 2026-06-16 research filing for arra-oracle-v3. This brief turns the
#1648 research thread into implementation guidance.

## Source base

Primary/upstream sources checked for this filing:

- MCP memory server source: https://github.com/modelcontextprotocol/servers/blob/main/src/memory/index.ts
- Agent memory survey: https://arxiv.org/abs/2603.07670
- LangMem docs: https://langchain-ai.github.io/langmem/
- GitHub Copilot Memory docs: https://docs.github.com/en/copilot/concepts/agents/copilot-memory
- Claude Projects RAG docs: https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects
- A-Mem paper page: https://openreview.net/forum?id=FiM0M8gcct

## Findings

1. **MCP is a protocol, not a sufficient memory backend.** The official memory
   server stores entities, relations, and observations in JSONL and its node
   search is basic substring matching. ARRA should expose its stronger hybrid
   store through MCP instead of replacing it with the official server.
2. **The reliable baseline is retrieval plus context injection.** The 2026
   survey frames agent memory as write-manage-read, with retrieval stores as one
   practical mechanism family among compression, reflection, hierarchy, and
   learned management.
3. **Coding-agent memory converges on files.** Rules and project docs remain the
   portable layer because humans can review them, version them, diff them, and
   rebuild indexes from them.
4. **Managed memory needs provenance.** Copilot-style citation validation is a
   better fit for code repositories than opaque auto-memory because stale file
   facts can be checked before they influence ranking.
5. **Graph memory is an advanced layer.** A-Mem-style dynamic linking is useful
   once retrieval logs show repeated misses, but it should not precede validated
   chunk retrieval, tenant scope, and lifecycle metadata.
6. **Auto-extraction should be review-gated.** LangMem shows a clean background
   extraction pattern, but ARRA should store extracted memories as candidates
   until a human or trusted policy promotes them.

## Pattern matrix

| Pattern | Use in ARRA | Avoid |
| --- | --- | --- |
| Static files | Durable decisions, rules, design notes, source of truth | Treating files as ranked semantic search by themselves |
| SQLite metadata | Tenant, provenance, validation, access stats, lifecycle | Raw SQL migrations outside Drizzle |
| FTS + vectors | Working-memory retrieval with citations | Trusting similarity without source validation |
| MCP tools | Agent-facing search/propose/get/validate facade | Making MCP the canonical storage engine |
| CLI ops | Import/export/reindex/doctor/promote workflows | Silent destructive memory mutation |
| Graph links | Later relation traversal over validated memories | Mandatory first-phase taxonomy or schema bloat |
| Auto extraction | Candidate generation and summarization | Direct promotion to trusted memory |

## Recommendations

### Product contract

- Keep **ground truth in files** under `ψ/memory/`, docs, and rule files.
- Keep **SQLite as the memory ledger** for metadata, not as the sole truth.
- Keep **hybrid FTS/vector retrieval** as the default recall mechanism.
- Return **citations, validation state, tenant scope, and confidence rationale**
  with every memory result.
- Separate write surfaces: MCP can propose; CLI/UI should review and promote.

### Memory lifecycle

Use these states before adding complex graph behavior:

1. `candidate`: captured from agent/user input, not trusted.
2. `validated`: source path/URL/hash still matches.
3. `promoted`: durable memory written to file or approved store.
4. `stale`: source moved, hash changed, or validation expired.
5. `contradicted`: newer validated memory conflicts with the claim.
6. `archived`: retained for audit, excluded from default retrieval.

### Query-time ranking

Compute trust when reading, not once when writing:

```text
score = retrieval_score
  + validation_boost
  + citation_strength
  + tenant_scope_match
  + recency_or_access_signal
  - stale_or_contradicted_penalty
```

This lets old memories decay without rewriting their historical record.

### Near-term implementation order

1. Define Drizzle metadata for source path/URL/hash, tenant, lifecycle state,
   validation timestamps, and access stats.
2. Add `memory_validate` for local file hash/path checks and URL excerpt hashes.
3. Add `memory_propose` to store untrusted candidates with full provenance.
4. Add CLI/UI `memory promote/archive/reindex/doctor` flows.
5. Add MCP `memory_search` as a read-first facade over ARRA hybrid retrieval.
6. Consider graph links only after retrieval logs show repeated relation misses.

## Decision

ARRA should be a **provenance-first hybrid memory system**: files for durable
truth, SQLite for lifecycle, vector+FTS for recall, MCP for interoperability, and
CLI/UI for safe operations. Do not adopt opaque auto-memory or marketing metric
claims as architecture requirements.
