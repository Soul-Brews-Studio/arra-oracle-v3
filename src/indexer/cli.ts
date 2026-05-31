/**
 * CLI entrypoint for running the Oracle indexer.
 */

import { runOracleReindex } from './runner.ts';

runOracleReindex()
  .then(() => {
    console.log('Indexing complete!');
  })
  .catch(err => {
    console.error('Indexing failed:', err);
    process.exit(1);
  });
