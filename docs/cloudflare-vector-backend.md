# Cloudflare Workers vector backend

Issue #2167 needs a Workers-compatible vector path because local SQLite and
`sqlite-vec` are not an edge runtime storage strategy. The vector factory can
now build the existing `cloudflare-vectorize` adapter from Workers bindings:

```ts
createVectorStore({
  type: 'cloudflare-vectorize',
  collectionName: 'oracle_knowledge_bge_m3',
  cfAi: env.AI,
  cfD1: env.DB,
  cfVectorize: env.VECTORIZE,
});
```

## Runtime shape

- `env.VECTORIZE` stores vectors and handles nearest-neighbor queries.
- `env.AI` embeds text with Workers AI, defaulting to `@cf/baai/bge-m3`.
- `env.DB` stores document text and metadata for query hydration, stats, and
  collection deletes.
- No Cloudflare REST account token is required when all three bindings are
  supplied. The REST adapter remains available for Bun/CLI usage.

## D1 table contract

The adapter does not create tables at runtime. Provision this table via the
Worker deploy/migration path:

```sql
CREATE TABLE IF NOT EXISTS oracle_vector_documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  document TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (collection, id)
);
```

`ensureCollection()` fails fast with a migration-oriented error when the table is
missing, so Worker health checks can surface the deployment gap clearly.
