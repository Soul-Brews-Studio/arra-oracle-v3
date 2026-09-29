import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';

type SnapshotEntry = { source: string; relativePath: string; sha256: string; bytes: number };
type CoverageFile = { sourceFile: string; source: string; relativePath: string; sha256: string; bytes: number };
type CoverageDocument = { id: string; sourceFile: string; contentSha256: string; contentBytes: number };

function arg(name: string, args: string[]): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`${name} is required`);
  return args[index + 1];
}

function normalize(value: string): string {
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`absolute database source path is not allowed: ${value}`);
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.split('/').includes('..')) throw new Error(`unsafe database source path: ${value}`);
  return normalized;
}

function manifestRelativeCandidates(sourceFile: string): string[] {
  const normalized = normalize(sourceFile);
  // `arra mine <dir>` deliberately namespaces sources as mine/<dir>/<path>.
  // The curated snapshot stores source and path separately, so try the full
  // remainder and then remove the destination/source namespace segments.
  if (!normalized.startsWith('mine/')) return [normalized];
  const candidates = [normalized.slice('mine/'.length)];
  while (candidates[candidates.length - 1].includes('/')) {
    candidates.push(candidates[candidates.length - 1].slice(candidates[candidates.length - 1].indexOf('/') + 1));
  }
  return candidates;
}

export function verifyCorpusCoverage(dbPath: string, snapshotPath: string): { files: CoverageFile[]; documents: CoverageDocument[]; uncovered: string[] } {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { entries?: SnapshotEntry[] };
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const byRelative = new Map<string, SnapshotEntry[]>();
  for (const entry of entries) {
    const key = normalize(entry.relativePath);
    const matches = byRelative.get(key) ?? [];
    matches.push(entry);
    byRelative.set(key, matches);
  }
  const db = new Database(dbPath, { readonly: true });
  let rows: Array<{ id: string; source_file: string; content: string | null }>;
  try {
    rows = db.query("SELECT d.id, d.source_file, f.content FROM oracle_documents d LEFT JOIN oracle_fts f ON f.id = d.id WHERE d.source_file IS NOT NULL AND TRIM(d.source_file) <> ''").all() as Array<{ id: string; source_file: string; content: string | null }>;
  } finally { db.close(); }
  const files: CoverageFile[] = [], documents: CoverageDocument[] = [], uncovered: string[] = [];
  const seenFiles = new Set<string>();
  for (const row of rows) {
    const sourceFile = normalize(String(row.source_file));
    const matches = manifestRelativeCandidates(sourceFile)
      .map((candidate) => byRelative.get(candidate) ?? [])
      .find((candidateMatches) => candidateMatches.length > 0) ?? [];
    if (matches.length !== 1) {
      uncovered.push(sourceFile);
      continue;
    }
    const entry = matches[0];
    if (!seenFiles.has(sourceFile)) {
      files.push({ sourceFile, source: entry.source, relativePath: entry.relativePath, sha256: entry.sha256, bytes: entry.bytes });
      seenFiles.add(sourceFile);
    }
    if (typeof row.content !== 'string') throw new Error(`database FTS content is missing for ${row.id}`);
    const content = Buffer.from(row.content, 'utf8');
    documents.push({ id: String(row.id), sourceFile, contentSha256: createHash('sha256').update(content).digest('hex'), contentBytes: content.byteLength });
  }
  return { files: files.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile)), documents: documents.sort((a, b) => a.id.localeCompare(b.id)), uncovered: [...new Set(uncovered)].sort() };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dbPath = arg('--db', args), snapshotPath = arg('--snapshot', args), output = arg('--output', args);
  const coverage = verifyCorpusCoverage(dbPath, snapshotPath);
  if (coverage.uncovered.length) {
    console.error(`curated corpus does not cover ${coverage.uncovered.length} database source file(s): ${coverage.uncovered.join(', ')}`);
    process.exit(1);
  }
  writeFileSync(output, `${JSON.stringify({ covered: true, files: coverage.files, documents: coverage.documents, uncovered: [] }, null, 2)}\n`, { mode: 0o600 });
  console.log(`curated source coverage verified: ${coverage.files.length} files, ${coverage.documents.length} database document(s)`);
}

export { normalize };
