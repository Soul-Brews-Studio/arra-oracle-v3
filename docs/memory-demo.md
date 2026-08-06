# Memory demo walkthrough (#2251)

This guide is a runnable, local walkthrough for the memory-layer pieces tracked
in [#2251](https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/2251):
provenance, query-time confidence, retrieval heat, valid-time reads, and
supersede-only consolidation. For design context, see
[architecture/memory-layer.md](./architecture/memory-layer.md) and
[architecture/memory-pipeline.md](./architecture/memory-pipeline.md).

The walkthrough uses a throwaway SQLite database so it is safe to repeat.

## 0. Start an isolated server

Terminal A:

```bash
export ORACLE_DATA_DIR="$(mktemp -d)"
export ORACLE_DB_PATH="$ORACLE_DATA_DIR/oracle-demo.db"
unset ARRA_API_TOKEN ARRA_API_KEY
PORT=47778 bun src/server.ts
```

Terminal B:

```bash
export BASE="http://localhost:47778/api/v1"
json() { python3 -m json.tool; }
curl_json() { curl -fsS -H 'content-type: application/json' "$@"; }
```

If you run against a protected server instead, set the same bearer token expected
by that server and add `-H "authorization: Bearer $TOKEN"` to `curl_json`.

## 1. Save memories with provenance and valid time

`source`, `title`, and `tags` are provenance signals. `validFrom` / `validTo`
are world-valid time, not “when Oracle learned this.”

```bash
curl_json -X POST "$BASE/memory/save" -d '{
  "title": "Demo policy v1",
  "content": "Stormforge demo policy says use the blue rollout path.",
  "tags": ["demo", "provenance", "confidence"],
  "source": "docs/memory-demo.md#v1",
  "validFrom": "2024-01-01T00:00:00.000Z",
  "validTo": "2025-01-01T00:00:00.000Z"
}' | json

curl_json -X POST "$BASE/memory/save" -d '{
  "title": "Demo policy v2",
  "content": "Stormforge demo policy says use the green rollout path.",
  "tags": ["demo", "provenance", "confidence"],
  "source": "docs/memory-demo.md#v2",
  "validFrom": "2025-01-01T00:00:00.000Z"
}' | json
```

Expected shape: each response has `success: true`, a `memory` object with
`source`, `tags`, `validFrom`, `validTo`, and a `vector` indexing receipt.

## 2. Read confidence receipts

Recall computes confidence at read time; there is no stored confidence column.

```bash
curl_json "$BASE/memory/recall?q=Stormforge%20demo%20policy&limit=5" | json
```

Look at `items[0].confidence` and `items[0].ranking`:

- `confidence.score` and `confidence.label` summarize trust for this query.
- `confidence.components.match` is the keyword/semantic match signal.
- `confidence.components.freshness` decays with age.
- `confidence.components.provenance` rises when source, tags, and title are present.
- `ranking.strategy` is `valid_time_confidence_heat_match`.
- `ranking.components.heat` and `ranking.components.validTime` show the extra rank signals.
- `warnings` shows missing source/tags or stale unvalidated memories.

For vector-backed stores, use semantic confidence:

```bash
curl_json "$BASE/memory/search?q=green%20rollout&limit=5" | json
curl_json "$BASE/memory/fanout?q=green%20rollout&limit=5" | json
```

`/memory/fanout` returns `ranking.confidenceWeight` and per-result
`rankingScore`, which blends RRF with confidence.

## 3. Query valid-time history

Ask “what was valid then?” by adding `asOf`.

```bash
curl_json "$BASE/memory/recall?q=Stormforge%20demo%20policy&asOf=2024-06-01T00:00:00.000Z" | json
curl_json "$BASE/memory/recall?q=Stormforge%20demo%20policy&asOf=2025-06-01T00:00:00.000Z" | json
```

The first call should return the blue path memory; the second should return the
green path memory. This is valid-time filtering over `oracle_memories`.
Canonical indexed documents use the same idea through `/api/v1/search?asOf=...`.

## 4. Seed canonical documents for heat and consolidation

The HTTP memory routes above write `oracle_memories`. Retrieval heat and the
async consolidation worker operate on indexed `oracle_documents`, so seed a tiny
canonical fixture in the same throwaway database:

```bash
bun --eval '
import { sqlite } from "./src/db/index.ts";
const now = Date.parse("2026-06-17T00:00:00.000Z");
const old = Date.parse("2024-01-01T00:00:00.000Z");
const replacement = Date.parse("2025-01-01T00:00:00.000Z");
sqlite.prepare("INSERT OR IGNORE INTO tenants (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)")
  .run("default", "Default", "active", now, now);
const put = sqlite.prepare(`INSERT OR REPLACE INTO oracle_documents
(id,tenant_id,type,source_file,concepts,created_at,updated_at,indexed_at,valid_time,superseded_by,superseded_at,superseded_reason,project,created_by)
VALUES (?,"default",?,?,?,?,?,?,?,?,?,?,?,?)`);
const fts = sqlite.prepare("INSERT INTO oracle_fts (id,content,concepts) VALUES (?,?,?)");
function doc(id, content, source, validTime, supersededBy = null) {
  put.run(id, "learning", source, JSON.stringify(["demo", "heat"]), validTime, validTime, now,
    validTime, supersededBy, supersededBy ? now : null, supersededBy ? "demo correction" : null, "memory-demo", "docs");
  sqlite.prepare("DELETE FROM oracle_fts WHERE id = ?").run(id);
  fts.run(id, content, "demo heat");
}
doc("demo-valid-old", "demoheatunique validuniqueterm blue rollout path", "docs/demo-old.md", old, "demo-valid-new");
doc("demo-valid-new", "demoheatunique validuniqueterm green rollout path", "docs/demo-new.md", replacement);
doc("demo-dupe-old", "duplicate consolidation evidence keeps same tokens for oracle memory cleanup", "docs/dupe-old.md", old);
doc("demo-dupe-new", "duplicate consolidation evidence keeps same tokens for oracle memory cleanup", "docs/dupe-new.md", now);
console.log("seeded demo docs");
'
```

## 5. Watch retrieval heat increase

Search returns log document access and bump `usage_count` / `last_accessed_at`.

```bash
curl_json "$BASE/search?q=demoheatunique&mode=fts&limit=5" | json
curl_json "$BASE/search?q=demoheatunique&mode=fts&limit=5" | json

bun --eval '
import { sqlite } from "./src/db/index.ts";
const rows = sqlite.query(`SELECT id, usage_count, last_accessed_at
  FROM oracle_documents WHERE id LIKE "demo-valid-%" ORDER BY id`).all();
console.log(JSON.stringify(rows, null, 2));
'
```

Expected shape: returned rows have `usage_count` greater than zero and a recent
`last_accessed_at`. Confidence uses heat as a bounded reinforcement signal; it
can lift useful old docs without hiding stale/provenance warnings.

## 6. Search canonical valid-time windows

```bash
curl_json "$BASE/search?q=validuniqueterm&mode=fts&asOf=2024-06-01T00:00:00.000Z" | json
curl_json "$BASE/search?q=validuniqueterm&mode=fts&asOf=2025-06-01T00:00:00.000Z" | json
```

Expected shape:

- 2024 query returns `demo-valid-old` with `valid_until` set to the replacement's
  `valid_time`.
- 2025 query returns `demo-valid-new` with `valid_until: null`.
- Supersede fields remain visible; the old row is not deleted.

## 7. Run consolidation as a dry run

Consolidation is off the request path and defaults to dry-run behavior. It scans
active `oracle_documents`, plans `SUPERSEDE` actions, and reports `deleted: 0`.
The production defaults are stricter; this tiny fixture lowers thresholds so the
short duplicate pair is easy to see.

```bash
bun --eval '
import { db, sqlite } from "./src/db/index.ts";
import { runConsolidationWorker } from "./src/workers/consolidation.ts";
const result = await runConsolidationWorker(db, sqlite, {
  dryRun: true,
  limit: 20,
  minCosine: 0.8,
  minFtsOverlap: 0.8,
  now: Date.parse("2026-06-17T00:00:00.000Z"),
  logger: { log() {}, warn: console.warn, error: console.error }
});
console.log(JSON.stringify(result, null, 2));
'
```

Expected shape: `dryRun: true`, `deleted: 0`, and at least one plan like
`demo-dupe-old -> demo-dupe-new` when the duplicate fixture is present.
To apply reviewed plans, run the worker with `dryRun: false`; application still
uses `runSupersede()` and preserves both rows.

## Cleanup

Stop the server in Terminal A and remove the temporary directory printed in
`ORACLE_DATA_DIR` if you want to delete the demo database.

## What this proves

- Provenance is explicit in memory payloads (`source`, `title`, `tags`).
- Confidence is query-time and explainable, not a drifting stored score.
- Heat is retrieval reinforcement through `usage_count` and `last_accessed_at`.
- Valid-time reads answer historical questions without erasing replacements.
- Consolidation proposes/applies supersede edges and never hard-deletes memory.
