/** Read-only acceptance counts. Usage: bun scripts/check-thai-fts.ts <new> <old> <live> */
import { sanitizeFtsQuery } from '../src/tools/search/helpers.ts';

const words = ['ภาษาไทย', 'บัญชี', 'ยิ้ม', 'โปรแกรม', 'deploy', 'memory', 'docker'];
const [newPath, oldPath, livePath] = process.argv.slice(2);
if (!newPath || !oldPath || !livePath) throw new Error('Expected new, old-control and live DB paths');
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
function read(dbPath: string, query: string): Record<string, any>[] {
  const run = Bun.spawnSync(['sqlite3', '-readonly', '-json', dbPath, query]);
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString() || '[]');
}

const measurements = new Map<string, Map<string, number>>();
for (const [label, dbPath, original] of [
  ['NEW', newPath, 'oracle_content'],
  ['OLD-CONTROL', oldPath, 'oracle_fts'],
  ['LIVE-READONLY', livePath, 'oracle_fts'],
]) {
  const counts = new Map<string, number>();
  measurements.set(label, counts);
  console.log(`${label} ${dbPath}`);
  console.log(`chunks=${read(dbPath, 'SELECT count(*) AS n FROM oracle_fts')[0].n}`);
  for (const word of words) {
    const query = sanitizeFtsQuery(word);
    const match = literal(query);
    const like = literal(`%${word}%`);
    const row = read(dbPath, `SELECT
      (SELECT count(*) FROM oracle_fts WHERE oracle_fts MATCH ${match}) AS fts,
      (SELECT count(*) FROM ${original} WHERE content LIKE ${like}) AS like_count,
      (SELECT count(*) FROM oracle_fts f WHERE oracle_fts MATCH ${match}
        AND (SELECT content FROM ${original} o WHERE o.rowid=f.rowid) LIKE ${like}) AS matched_like`)[0];
    counts.set(word, row.fts);
    const ratio = row.like_count ? row.fts / row.like_count : 0;
    console.log(`${word} MATCH=${query} FTS=${row.fts} LIKE=${row.like_count} ratio=${ratio.toFixed(4)} matched_like=${row.matched_like}`);
    if (label === 'NEW' && words.indexOf(word) < 4 && ratio < 0.8) process.exitCode = 1;
  }
}
for (const word of words.slice(4)) {
  const next = measurements.get('NEW')!.get(word)!;
  const live = measurements.get('LIVE-READONLY')!.get(word)!;
  console.log(`English ${word}: NEW=${next} LIVE=${live} ${next >= live ? 'PASS' : 'FAIL'}`);
  if (next < live) process.exitCode = 1;
}
