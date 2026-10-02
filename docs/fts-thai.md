# Thai-aware FTS

`segmentThaiText` in `src/search/fts-text.ts` uses Bun's ICU-backed
`Intl.Segmenter('th', { granularity: 'word' })` on Thai script runs. It inserts
word boundaries without normalizing Thai vowels/tones. Other text and existing
whitespace are retained. Script transitions also form boundaries.

The indexer, incremental watcher, learning writers, session summaries and document
edits use this projection. All three MATCH builders share `ftsQueryTerms`.
A Thai run that becomes several words is one quoted phrase: `ภาษาไทย` becomes
`"ภาษา ไทย"`. English still uses the existing OR terms, limits, acronym expansion
where applicable, and Porter stemming. Thai SARA AM is excluded from query NFKC
normalization so its spelling agrees with the index.

## Original text and schema compatibility

Migration `0042_fts_original_content.sql` is additive and idempotent. It leaves
the existing three-column `oracle_fts` table and `porter unicode61` tokenizer
unchanged. No FTS table is dropped or rebuilt by the migration.

Preserving original chunk bytes requires separate storage: the previous schema
had only FTS content, which served both retrieval and display. The migration adds:

- `oracle_document_content(id PRIMARY KEY, content)`: original chunk text before
  segmentation or acronym enrichment.
- `oracle_content`: a read view with FTS rowid/id/concepts and the original text;
  legacy rows without saved originals fall back to their existing FTS content.
- A metadata-delete trigger that removes the corresponding saved original.

Shared writes update originals and FTS postings in one transaction. Search results,
snippets, list/read/reflect, pointer hydration, backups, consolidation, and vector
workers now read originals. The indexer's direct vector path also uses original
chunks. Acronym enrichment remains in the FTS search projection only.
There is no attempt to reconstruct original whitespace by removing inserted spaces.

Core HTTP handlers and MCP learning helpers were split by concern to keep changed
files within the repository's 250-line limit; their public exports are preserved.

## Applying to an existing index

Back up the database before opening it with the new code. Normal writable startup
applies migration 0042 via Drizzle. Reindex the source repository to populate the
Thai search projection and saved originals. Merely applying the migration or running
FTS5's SQL `rebuild` command cannot perform JavaScript word segmentation.

Use the same Bun/ICU version for indexing and queries; reindex after changing its
Thai segmentation rules. Preserved manual rows outside the indexed sources need to
be re-ingested/updated separately. Until then their displayed text stays intact,
but they retain old Thai recall. Read-only vector loaders and the drift benchmark
can still read older databases without applying migrations.

## Local verification

```sh
ORACLE_DATA_DIR="$HOME/.arra-oracle-v3-thai" ORACLE_DISABLE_LOCAL_VECTOR=1 \
  /usr/bin/time -p bun run index --repo-root "$HOME/hello-oracle"
bun scripts/check-thai-fts.ts "$HOME/.arra-oracle-v3-thai/oracle.db" \
  "$HOME/.arra-oracle-v3-rebuild/oracle.db" "$HOME/.arra-oracle-v2/oracle.db"
```

The count script uses the MCP query builder and `sqlite3 -readonly` for every DB.
LIKE checks use original text on the new DB. `matched_like` counts actual literal
occurrences recovered, because stemming, concepts and unicode61 mark handling can
produce additional FTS matches. Current corpora have different chunk counts; these
are operational acceptance checks, not a controlled relevance evaluation.

See `fts-thai-acceptance.md` for verbatim outputs and outstanding environment limits,
and `fts-thai-files.txt` for the complete changed-file inventory.
