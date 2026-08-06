import fs from 'node:fs';
import path from 'node:path';
import { ORACLE_DATA_DIR, REPO_ROOT } from '../../config.ts';
import { stringifyMarkdown } from './frontmatter.ts';
import { generateIndexes } from './index-gen.ts';
import { rewriteWikilinks } from './links.ts';
import { mapToOkf, type OkfDocument, type SourceDocument } from './mapper.ts';

export interface OkfExportOptions {
  sourceDir?: string;
  outDir?: string;
}

export interface OkfExportResult {
  sourceDir: string;
  outDir: string;
  documents: number;
}

export function okfHelp(): string {
  return [
    'Usage: arra-oracle okf export [--out <dir>] [--source <vault-root>]',
    'Export a ψ vault as an Open Knowledge Format v0.1 bundle.',
    '',
    `Defaults: --source ${path.join(REPO_ROOT, 'ψ')}`,
    `          --out ${path.join(ORACLE_DATA_DIR, 'exports', 'okf')}`,
  ].join('\n');
}

export function parseOkfArgs(args: string[]): { help: boolean; export?: OkfExportOptions } {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  if (args[0] !== 'export') throw new Error('okf requires subcommand: export');
  const options: OkfExportOptions = {};
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--out' || arg === '--source') {
      const value = args[++i]?.trim();
      if (!value) throw new Error(`${arg} requires a path`);
      if (arg === '--out') options.outDir = value;
      else options.sourceDir = value;
    } else if (arg.startsWith('--out=')) options.outDir = requiredInline(arg, '--out=');
    else if (arg.startsWith('--source=')) options.sourceDir = requiredInline(arg, '--source=');
    else if (arg.startsWith('-')) throw new Error(`unknown okf option: ${arg}`);
    else throw new Error(`unexpected okf argument: ${arg}`);
  }
  return { help: false, export: options };
}

export async function okfCommand(args: string[]): Promise<number> {
  try {
    const parsed = parseOkfArgs(args);
    if (parsed.help) {
      console.log(okfHelp());
      return 0;
    }
    const result = exportOkfBundle(parsed.export ?? {});
    console.log(`Exported ${result.documents} OKF document${result.documents === 1 ? '' : 's'} to ${result.outDir}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(okfHelp());
    return 1;
  }
}

export function exportOkfBundle(options: OkfExportOptions = {}): OkfExportResult {
  const sourceDir = path.resolve(options.sourceDir ?? path.join(REPO_ROOT, 'ψ'));
  const outDir = path.resolve(options.outDir ?? path.join(ORACLE_DATA_DIR, 'exports', 'okf'));
  assertDirectory(sourceDir, 'source');
  assertOutIsOutsideSource(sourceDir, outDir);

  const sourceDocs = collectMarkdown(sourceDir);
  const docs = sourceDocs.map(mapToOkf);
  for (const doc of docs) doc.body = rewriteWikilinks(doc.body, docs);

  for (const doc of docs) writeDocument(outDir, doc);
  generateIndexes(outDir, docs);
  return { sourceDir, outDir, documents: docs.length };
}

function collectMarkdown(root: string): SourceDocument[] {
  const docs: SourceDocument[] = [];
  walk(root, (absPath) => {
    const name = path.basename(absPath).toLowerCase();
    if (!name.endsWith('.md') || name === 'index.md' || name === 'log.md') return;
    const stat = fs.statSync(absPath);
    docs.push({
      relPath: path.relative(root, absPath).split(path.sep).join('/'),
      content: fs.readFileSync(absPath, 'utf8'),
      mtimeMs: stat.mtimeMs,
    });
  });
  return docs.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function walk(dir: string, onFile: (absPath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absPath, onFile);
    else if (entry.isFile()) onFile(absPath);
  }
}

function writeDocument(outDir: string, doc: OkfDocument): void {
  const target = path.join(outDir, doc.relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, stringifyMarkdown(doc.frontmatter, doc.body), 'utf8');
}

function assertDirectory(dir: string, label: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`OKF ${label} directory not found: ${dir}`);
}

function assertOutIsOutsideSource(sourceDir: string, outDir: string): void {
  const relative = path.relative(sourceDir, outDir);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('OKF output directory must be outside the source vault');
  }
  fs.mkdirSync(outDir, { recursive: true });
}

function requiredInline(arg: string, prefix: string): string {
  const value = arg.slice(prefix.length).trim();
  if (!value) throw new Error(`${prefix.slice(0, -1)} requires a path`);
  return value;
}
