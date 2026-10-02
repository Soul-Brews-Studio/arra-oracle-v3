#!/usr/bin/env bun
/**
 * Backfill orphan arra_learn rows (#868)
 *
 * An "orphan" learning is a row in oracle_documents (type='learning') whose
 * source_file doesn't resolve from REPO_ROOT. Recovery strategy per row:
 *   1. Find a file with the same basename anywhere under $(ghq root) → copy to
 *      the expected REPO_ROOT path.
 *   2. Else regenerate the markdown from the FTS5 content column (arra_learn
 *      writes the full frontmatter into FTS content, so we can reconstruct it
 *      verbatim) using the same layout src/tools/learn.ts produces.
 *   3. Else (no basename match and no FTS content): flag as unrecoverable.
 *      With --purge-unrecoverable, delete the DB+FTS rows; otherwise leave
 *      them and list ids at the end.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createDatabase } from '../src/db/index.ts';
import { REPO_ROOT } from '../src/config.ts';

type Args = {
  dryRun: boolean;
  fix: boolean;
  purgeUnrecoverable: boolean;
  limit: number | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: true, fix: false, purgeUnrecoverable: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--fix') { args.fix = true; args.dryRun = false; }
    else if (a === '--purge-unrecoverable') args.purgeUnrecoverable = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.split('=')[1], 10);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`Unknown flag: ${a}`); printHelp(); process.exit(2); }
  }
  return args;
}

function printHelp(): void {
  console.log(`backfill-orphans.ts — recover orphan arra_learn rows

Usage: bun run scripts/backfill-orphans.ts [flags]

Flags:
  --dry-run               Report only (default)
  --fix                   Actually copy/regenerate files
  --purge-unrecoverable   With --fix, delete DB rows that can't be recovered
  --limit N               Cap number of rows processed
  -h, --help              Show this help
`);
}

function getGhqRoot(): string {
  try {
    return execSync('ghq root', { encoding: 'utf-8' }).trim();
  } catch {
    return path.join(process.env.HOME || '', 'Code');
  }
}

function buildBasenameIndex(ghqRoot: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  if (!fs.existsSync(ghqRoot)) return index;

  const stack: string[] = [ghqRoot];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        const list = index.get(e.name);
        if (list) list.push(full); else index.set(e.name, [full]);
      }
    }
  }
  return index;
}

function renderFromFtsContent(content: string): string {
  // arra_learn writes the full frontmatter block into FTS. Trailing newline
  // may be stripped by the FTS tokenizer — normalize to match learn.ts output.
  return content.endsWith('\n') ? content : content + '\n';
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const ghqRoot = getGhqRoot();

  console.log(`REPO_ROOT: ${REPO_ROOT}`);
  console.log(`ghq root:  ${ghqRoot}`);
  console.log(`mode:      ${args.fix ? 'FIX' : 'DRY-RUN'}${args.purgeUnrecoverable ? ' +purge' : ''}${args.limit ? ` (limit ${args.limit})` : ''}`);
  console.log('');

  const { sqlite } = createDatabase();

  const rows = sqlite.prepare(
    `SELECT id, source_file FROM oracle_documents WHERE type = 'learning'`
  ).all() as { id: string; source_file: string }[];

  const orphans: { id: string; source_file: string }[] = [];
  for (const r of rows) {
    const p = path.isAbsolute(r.source_file) ? r.source_file : path.join(REPO_ROOT, r.source_file);
    if (!fs.existsSync(p)) orphans.push(r);
  }

  const cap = args.limit ? Math.min(args.limit, orphans.length) : orphans.length;
  const work = orphans.slice(0, cap);

  console.log(`Total learnings:   ${rows.length}`);
  console.log(`Orphans detected:  ${orphans.length}`);
  if (args.limit) console.log(`Processing (limit): ${work.length}`);
  console.log('');

  if (work.length === 0) {
    console.log('No orphans to process.');
    sqlite.close();
    return;
  }

  console.log('Indexing ghq root by basename…');
  const basenameIndex = buildBasenameIndex(ghqRoot);
  console.log(`Indexed ${basenameIndex.size} unique .md basenames.\n`);

  const getFtsContent = sqlite.prepare(`SELECT content FROM oracle_content WHERE id = ?`);
  const deleteDocument = sqlite.prepare(`DELETE FROM oracle_documents WHERE id = ?`);
  const deleteFts = sqlite.prepare(`DELETE FROM oracle_fts WHERE id = ?`);

  const summary = {
    total_orphans: orphans.length,
    processed: work.length,
    fixed_by_copy: 0,
    fixed_by_regen: 0,
    purged: 0,
    unrecoverable: 0,
    errors: 0,
  };
  const unrecoverableIds: string[] = [];

  for (const row of work) {
    const expectedPath = path.isAbsolute(row.source_file)
      ? row.source_file
      : path.join(REPO_ROOT, row.source_file);
    const basename = path.basename(row.source_file);

    try {
      const candidates = basenameIndex.get(basename);
      if (candidates && candidates.length > 0) {
        const src = candidates[0];
        if (args.fix) {
          fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
          fs.copyFileSync(src, expectedPath);
        }
        summary.fixed_by_copy++;
        console.log(`[copy${candidates.length > 1 ? `×${candidates.length}` : ''}] ${row.id}`);
        console.log(`         from: ${src}`);
        console.log(`         to:   ${expectedPath}`);
        continue;
      }

      const ftsRow = getFtsContent.get(row.id) as { content: string } | undefined;
      if (ftsRow?.content && ftsRow.content.trim()) {
        if (args.fix) {
          fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
          fs.writeFileSync(expectedPath, renderFromFtsContent(ftsRow.content), 'utf-8');
        }
        summary.fixed_by_regen++;
        console.log(`[regen] ${row.id} → ${expectedPath}`);
        continue;
      }

      summary.unrecoverable++;
      unrecoverableIds.push(row.id);
      if (args.fix && args.purgeUnrecoverable) {
        deleteDocument.run(row.id);
        deleteFts.run(row.id);
        summary.purged++;
        console.log(`[purge] ${row.id} (${row.source_file})`);
      } else {
        console.log(`[orphan] ${row.id} (${row.source_file})`);
      }
    } catch (err) {
      summary.errors++;
      console.error(`[error] ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  if (!args.purgeUnrecoverable && unrecoverableIds.length > 0) {
    console.log('\nUnrecoverable ids (no basename match, no FTS content):');
    for (const id of unrecoverableIds) console.log(`  - ${id}`);
    console.log('\nRe-run with --fix --purge-unrecoverable to delete these rows.');
  }

  if (args.dryRun) {
    console.log('\n(dry-run: no files written, no DB rows modified)');
  }

  sqlite.close();
}

main();
