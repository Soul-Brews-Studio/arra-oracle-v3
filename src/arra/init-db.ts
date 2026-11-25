/**
 * Child process of `arra init` for a folder without ψ/: open the DB once so the migrations
 * build the latest schema, then print the document count. ORACLE_DATA_DIR points at the new
 * `.arra/` (set by the parent), so this never opens the user's default DB.
 */

import { sqlite } from '../db/index.ts';

const row = sqlite.query('SELECT count(*) AS n FROM oracle_documents').get() as { n: number };
console.log(`schema ready · docs ${row.n}`);
