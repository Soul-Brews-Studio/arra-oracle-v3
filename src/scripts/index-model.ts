#!/usr/bin/env bun
/** Queue reconciliation command. The daemon is the only LanceDB writer. */

import { EMBEDDING_MODELS } from '../vector/factory.ts';
import { createDatabase } from '../db/index.ts';
import { DB_PATH } from '../config.ts';
import { enqueueCanonicalVectorJobs } from '../indexer/reindex-state.ts';
import { loadCanonicalVectorDocuments } from '../indexer/vector-source.ts';

const args = process.argv.slice(2);
const modelKey = args.find((arg) => !arg.startsWith('--'));
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
if (!modelKey || !EMBEDDING_MODELS[modelKey] || flags.has('--help')) {
  console.error('Usage: bun src/scripts/index-model.ts <model> [--dry-run] [--repair]');
  process.exit(flags.has('--help') ? 0 : 1);
}
if ([...flags].some((flag) => flag !== '--dry-run' && flag !== '--repair')) {
  console.error(`Unknown flag: ${[...flags].find((flag) => flag !== '--dry-run' && flag !== '--repair')}`);
  process.exit(1);
}

const preset = EMBEDDING_MODELS[modelKey];
const { db, sqlite } = createDatabase(DB_PATH);
try {
  const docs = loadCanonicalVectorDocuments(sqlite);
  if (flags.has('--dry-run')) {
    console.log(JSON.stringify({ model: modelKey, chunks: docs.length, dry_run: true, writer: 'daemon' }, null, 2));
  } else {
    const repair = flags.has('--repair');
    const stats = enqueueCanonicalVectorJobs(
      db,
      docs.map((doc) => doc.id),
      { [modelKey]: { collection: preset.collection } },
      { force: repair },
    );
    console.log(JSON.stringify({ model: modelKey, chunks: docs.length, ...stats, repair, writer: 'daemon' }, null, 2));
  }
} finally {
  sqlite.close();
}
