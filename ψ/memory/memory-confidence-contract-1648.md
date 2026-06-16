# Memory Confidence Contract — #1648

Status: 2026-06-17 implementation note for issue #1648. This file records the
small runtime contract added after the deep-research pass so future memory work
keeps confidence explainable instead of treating it as a stored truth column.

## Decision

Memory confidence is computed when a memory is read. It is not persisted on the
memory row and it does not rewrite historical records. This matches the #1648
research finding that confidence drifts as sources age, citations disappear,
tenant context changes, and retrieval quality changes.

## Current API shape

`/api/memory/recall` and `/api/memory/search` include a top-level strategy block:

```json
{
  "stored": false,
  "strategy": "query-time-confidence",
  "signals": ["match_score", "freshness_decay", "source", "tags", "title"]
}
```

Each result includes a `confidence` object:

```json
{
  "score": 0.87,
  "label": "high",
  "ageDays": 0,
  "freshness": 1,
  "components": {
    "match": 1,
    "freshness": 1,
    "provenance": 0.35
  },
  "warnings": ["missing_source"],
  "reasons": [
    "computed_at_query_time",
    "semantic_match",
    "source_missing",
    "tags_present",
    "freshness_half_life_139d"
  ]
}
```

## Scoring inputs

- `match`: keyword recall default or vector similarity score.
- `freshness`: exponential decay from `updatedAt` or `createdAt`.
- `provenance`: weighted source, tags, and title presence.
- anchored memories use the longer research-backed half-life; unanchored
  memories decay on the shorter unvalidated half-life.

The current score is intentionally simple:

```text
score = match * 0.5 + freshness * 0.3 + provenance * 0.2
```

This keeps confidence visible before it changes ranking behavior.

## Warning meanings

| Warning | Meaning | Operator response |
| --- | --- | --- |
| `missing_source` | No source path, URL, route, or capture origin was saved | Add a source before promoting durable memory |
| `missing_tags` | No tags were saved | Add lifecycle/topic tags so recall can explain scope |
| `unanchored_memory` | No source and no tags | Treat as a personal note, not canonical knowledge |
| `stale_unvalidated` | Unanchored memory passed the short half-life | Revalidate, promote with provenance, or archive |
| `low_match_score` | Semantic match is weak | Use as supporting context only |

## Guardrails

- Do not persist the confidence score in `oracle_memories`.
- Additive confidence fields are allowed; removing or renaming fields needs an
  API compatibility note.
- Warnings are guidance, not hard filters. Ranking changes should be measured
  separately against false-positive and false-negative recall examples.
- Keep tenant isolation before confidence: never raise confidence for a result
  that does not belong to the active tenant context.

## Next implementation slice

1. Add explicit lifecycle metadata (`candidate`, `validated`, `promoted`,
   `stale`, `contradicted`, `archived`) through Drizzle before changing ranking.
2. Add source hash/path validation and include validation status in the
   confidence components.
3. Promote MCP writes into candidate memories only; CLI/UI should own validation
   and durable promotion.
4. Use search logs to decide whether confidence should influence ordering.
