# Oracle Storage Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow equal display IDs from different projects to coexist and prevent stale/cross-project vectors from affecting RRF ranking.

**Architecture:** Persist a deterministic project-namespaced storage ID while retaining the original display ID. Store full-content digests in SQLite and vector metadata, filter project/universal records inside the production LanceDB query, and reject the entire vector channel before RRF when returned metadata does not match SQLite. Cut over to a new vector collection and preserve the old collection for rollback.

**Tech Stack:** Bun, TypeScript, bun:sqlite, Drizzle ORM, SQLite FTS5, LanceDB, Node `crypto` standard library.

## Global Constraints

- Universal records use the exact sentinel `__universal__` for identity and vector metadata; SQLite `project` remains `NULL` for compatibility.
- `storage_id = "doc:" + sha256(canonicalProject + "\0" + displayId)`.
- Canonicalization uses an explicit alias registry. The verified alias `my second brain v2` maps to `github.com/mengazaa/my-second-brain-v2`; similar spellings are distinct and never fuzzy-mapped.
- No new dependency.
- Pure vector metadata must match SQLite `project`, `display_id`, and `content_digest` before RRF.
- Any returned vector metadata mismatch disables the vector channel for that query and falls back to FTS.
- Use worktree-local tests/runners before merge; `arra search` imports absolute paths from the main checkout and is only a valid live acceptance after merge.
- Preserve the old `oracle_knowledge_qwen3` collection for rollback; write the new index to `oracle_knowledge_qwen3_v2`.

---

### Task 1: Document Identity and Persistent Migration

**Files:**
- Create: `src/document-identity.ts`
- Create: `src/db/document-identity-migration.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`
- Create: `src/db/migrations/0007_document_identity.sql`
- Test: `src/document-identity.test.ts`

**Interfaces:**
- Produces: `UNIVERSAL_PROJECT`, `canonicalProject(project)`, `documentStorageId(project, displayId)`, and `contentDigest(content)`.
- Produces: idempotent `migrateDocumentIdentity(sqlite)` called after Drizzle migrations and FTS initialization.

- [ ] **Step 1: Add failing identity tests**

Test that the same display ID yields different `doc:` IDs across projects, the same inputs are stable, universal uses `__universal__`, the verified legacy alias and canonical vault project yield the same ID, an unregistered similar spelling remains distinct, and content digest changes with content.

- [ ] **Step 2: Implement identity helpers with `node:crypto`**

Use SHA-256 directly and a small explicit alias map; do not add an identity class, fuzzy matching, or dependency.

- [ ] **Step 3: Add schema columns and migration SQL**

Add nullable `display_id` and `content_digest` columns plus a unique `(project, display_id)` index. Nullable migration columns allow existing rows to be transformed by the runtime migration.

- [ ] **Step 4: Implement idempotent rekey migration**

Inside one SQLite transaction, read every legacy row and its latest FTS content, compute canonical project/storage ID/digest, rewrite `oracle_documents`, collapse its FTS rows to one row under the storage ID, and remap `superseded_by` within the same project. A row with populated `display_id` and a correct storage ID is unchanged.

- [ ] **Step 5: Run targeted identity and migration tests**

Run `bun test src/document-identity.test.ts src/drizzle-migration.test.ts`. Expected: all new tests pass; no existing migration test regresses.

- [ ] **Step 6: Commit**

Commit message: `feat: namespace oracle document identities`.

### Task 2: Namespace Every Write Path

**Files:**
- Modify: `src/indexer/storage.ts`
- Modify: `src/tools/learn.ts`
- Modify: `src/indexer/index.ts`
- Test: `src/indexer-preservation.test.ts`
- Test: `src/tools/__tests__/learn.test.ts`

**Interfaces:**
- Consumes: identity helpers from Task 1.
- Produces: SQLite/FTS/vector writes keyed by storage ID while preserving `display_id`.

- [ ] **Step 1: Add collision regression**

Store two documents with the same parser ID under two projects. Assert two SQLite rows, two FTS rows, distinct storage IDs, equal display IDs, and intact content.

- [ ] **Step 2: Update `storeDocuments`**

Compute canonical project, storage ID, and content digest once per document. Use storage ID for existing-row detection, SQLite, FTS, vector update detection, deletion, and vector writes. Include `project`, `display_id`, and `content_digest` in vector metadata.

- [ ] **Step 3: Update indexer deletion bookkeeping**

Compare incoming namespaced IDs to stored IDs so smart deletion cannot remove another project with the same display ID.

- [ ] **Step 4: Update `handleLearn`**

Use the same helper and columns; return both internal `id` and `display_id` in the response.

- [ ] **Step 5: Run write-path tests**

Run `bun test src/indexer-preservation.test.ts src/tools/__tests__/learn.test.ts`. Expected: collision and preservation tests pass.

- [ ] **Step 6: Commit**

Commit message: `feat: namespace oracle write paths`.

### Task 3: Versioned Vector Collection and Native LanceDB Filtering

**Files:**
- Modify: `src/vector/factory.ts`
- Modify: `src/vector/adapters/lancedb.ts`
- Modify: `src/scripts/index-qwen3.ts`
- Modify: `src/vector/__tests__/adapters.test.ts`

**Interfaces:**
- Consumes: vector metadata `project`, `display_id`, `content_digest`.
- Produces: `oracle_knowledge_qwen3_v2` and LanceDB native equality filters applied before `.limit()`.

- [ ] **Step 1: Add LanceDB filter regression**

Index equal display IDs for project A, project B, and universal. Query with `{ project: projectA }` and assert project B is never returned before application slicing.

- [ ] **Step 2: Add filterable LanceDB columns**

Store `type`, `project`, and `content_digest` as top-level LanceDB columns as well as metadata. Build escaped equality predicates from `where` and apply `.where(predicate)` before `.limit(limit)`.

- [ ] **Step 3: Switch qwen3 to v2 collection**

Update factory and reindex script to the exact collection name `oracle_knowledge_qwen3_v2`; keep the old table untouched.

- [ ] **Step 4: Include complete metadata during reindex**

Read `display_id` and `content_digest` from SQLite and include them with canonical project/sentinel in every vector row.

- [ ] **Step 5: Run adapter tests**

Run the targeted LanceDB adapter test. Expected: project filtering occurs before limit and collision fixtures coexist.

- [ ] **Step 6: Commit**

Commit message: `feat: add project-bound vector collection`.

### Task 4: Validate Vectors Before Fusion

**Files:**
- Modify: `src/tools/search.ts`
- Modify: `src/tools/read.ts`
- Modify: `src/tools/types.ts`
- Test: `src/tools/__tests__/search.test.ts`

**Interfaces:**
- Consumes: namespaced IDs and vector metadata from Tasks 1–3.
- Produces: search results containing internal `id` plus `display_id`; only DB-validated vectors reach `combineResults`.

- [ ] **Step 1: Add pure-vector and hybrid ranking regressions**

Cover valid same-project vector, cross-project same-display-ID vector, stale digest vector, and an FTS row sharing a stale vector ID. Assert stale/cross vectors never enter RRF and never add a hybrid `vecRank` boost.

- [ ] **Step 2: Apply project filters in `vectorSearch`**

For scoped search, query canonical project and `__universal__` separately with native filters, merge by distance, deduplicate by storage ID, and slice to the requested vector limit.

- [ ] **Step 3: Batch-validate vector metadata**

Lookup all returned storage IDs in SQLite and require exact project, display ID, and digest matches. If any returned candidate mismatches or is absent, set vector results to empty and emit an FTS-fallback warning before normalization and `combineResults`.

- [ ] **Step 4: Return display IDs and preserve internal reads**

Expose `display_id` in search/read output while keeping internal storage ID as `id` for unambiguous reads.

- [ ] **Step 5: Run search regressions through a worktree-local runner**

Run `bun test src/tools/__tests__/search.test.ts` and a worktree-local invocation importing `./src/tools/search.ts`. Do not use `arra search` before merge because its runner imports the main checkout.

- [ ] **Step 6: Commit**

Commit message: `fix: reject stale vectors before oracle fusion`.

### Task 5: Migrate, Reindex, Merge, and Live Acceptance

**Files:**
- Modify only if tests expose a contract defect in Tasks 1–4.

**Interfaces:**
- Consumes: completed storage/search implementation.
- Produces: migrated production SQLite/FTS and populated qwen3 v2 collection.

- [ ] **Step 1: Run targeted worktree suite**

Run identity, migration, preservation, learn, search, and LanceDB filter tests. Existing unrelated TypeScript errors in `server-legacy.ts` and `contradictions.ts` remain outside scope and must be reported, not relabeled.

- [ ] **Step 2: Exercise an isolated database migration twice**

Seed equal display IDs in two projects plus a universal row, run migration twice, and assert idempotency, three distinct storage IDs, preserved FTS content, and remapped supersession.

- [ ] **Step 3: Merge the verified branch into main**

Merge only after targeted tests pass. The main checkout already contains checkpoint commits `423b5e1` and `b30bf5e`.

- [ ] **Step 4: Back up and migrate production data**

Use the existing database backup path before opening the migrated runtime. Record pre/post document counts and project distribution; do not claim recovery for a source file that no longer exists.

- [ ] **Step 5: Reindex the v2 vector collection**

Run the main-checkout qwen3 reindex script, confirm vector count equals the SQLite/FTS source set, and leave `oracle_knowledge_qwen3` untouched.

- [ ] **Step 6: Restart and run live acceptance**

Restart Oracle HTTP/runtime, then use `arra search` from main. Verify same-display-ID project isolation, universal inclusion, stale pure-vector rejection, stale hybrid rejection, and grounded `/api/read` by internal ID.

- [ ] **Step 7: Update `/brain` and AC-5 evidence**

Replace the temporary v7.14 synthesis workaround with the verified engine contract and record observed migration/reindex/live-search evidence only.
