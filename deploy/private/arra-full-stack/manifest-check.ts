import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

export type ManifestEntry = { source: string; relativePath: string; sha256: string; bytes: number };
export type ManifestRow = { source: string; relativePath: string };
export type CorpusRoots = Record<string, string>;

const DENIED_NAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
const DENIED_PARTS = new Set(['.git', 'node_modules', '.local', 'backups', 'screenshots']);
const SECRET_WORD = /(token|secret|credential|password|private[-_]?key|certificate|\.env)/i;
const SECRET_CONTENT = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY-----/,
  /\b(?:OPENAI_API_KEY|HERMES_API_KEY|CODEX_BRIDGE_KEY|ARRA_API_TOKEN|ORACLE_MCP_HTTP_TOKEN)\s*[:=]\s*[^\s#]{16,}/i,
  /\b(?:token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{24,}/i,
];
const ALLOWED_EXTENSIONS = new Set(['.md', '.mdx']);

export function parseManifest(raw: string): ManifestRow[] {
  return raw.split(/\r?\n/).map((line, index) => {
    const text = line.trim();
    if (!text || text.startsWith('#')) return null;
    const separator = text.indexOf('|');
    if (separator < 1) throw new Error(`manifest line ${index + 1} must be source|relative-path`);
    const source = text.slice(0, separator).trim();
    const relativePath = normalizeRelative(text.slice(separator + 1).trim());
    if (!relativePath) throw new Error(`manifest line ${index + 1} has an empty path`);
    return { source, relativePath };
  }).filter((row): row is ManifestRow => Boolean(row));
}

export function buildManifest(rows: ManifestRow[], roots: CorpusRoots): ManifestEntry[] {
  const found = new Map<string, ManifestEntry>();
  for (const row of rows) {
    const root = roots[row.source];
    if (!root) throw new Error(`manifest root is not configured: ${row.source}`);
    const rootPath = resolve(root);
    const target = resolve(rootPath, row.relativePath);
    assertInside(rootPath, target, row.relativePath);
    assertCanonicalInside(rootPath, target, row.relativePath);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`symlink is not allowed: ${row.source}|${row.relativePath}`);
    if (stat.isDirectory()) walk(rootPath, target, row.source, found);
    else addFile(rootPath, target, row.source, found);
  }
  return [...found.values()].sort((a, b) => {
    const left = `${a.source}|${a.relativePath}`.toLowerCase(), right = `${b.source}|${b.relativePath}`.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function walk(root: string, dir: string, source: string, found: Map<string, ManifestEntry>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (DENIED_PARTS.has(entry.name) || SECRET_WORD.test(entry.name)) continue;
    const target = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed: ${source}|${relative(root, target)}`);
    if (entry.isDirectory()) walk(root, target, source, found);
    else if (entry.isFile() && ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) addFile(root, target, source, found);
  }
}

function addFile(root: string, target: string, source: string, found: Map<string, ManifestEntry>): void {
  const path = normalizeRelative(relative(root, target));
  assertAllowed(path);
  const key = `${source}|${path}`;
  const bytes = readFileSync(target);
  const text = bytes.toString('utf8').replace(/<[^>\n]{1,100}>/g, '<placeholder>').replace(/\$\{[^}\n]+\}/g, '${placeholder}');
  if (SECRET_CONTENT.some((pattern) => pattern.test(text))) throw new Error(`secret-like content is not allowed: ${source}|${path}`);
  found.set(key, { source, relativePath: path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength });
}

function assertCanonicalInside(root: string, target: string, display: string): void {
  if (lstatSync(root).isSymbolicLink()) throw new Error(`symlink root is not allowed: ${root}`);
  let lexical = root;
  const lexicalTarget = relative(root, target);
  for (const part of lexicalTarget.split('/').filter(Boolean)) {
    lexical = join(lexical, part);
    if (lstatSync(lexical).isSymbolicLink()) throw new Error(`symlink is not allowed: ${display}`);
  }
  const canonicalRoot = realpathSync(root);
  const canonicalTarget = realpathSync(target);
  const prefix = canonicalRoot.endsWith('/') ? canonicalRoot : `${canonicalRoot}/`;
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(prefix)) {
    throw new Error(`manifest path escapes root through a symlink: ${display}`);
  }
}

function assertAllowed(path: string): void {
  const name = basename(path);
  if (DENIED_NAMES.has(name) || SECRET_WORD.test(name) || path.split('/').some((part) => DENIED_PARTS.has(part))) throw new Error(`excluded corpus path: ${path}`);
  if (!ALLOWED_EXTENSIONS.has(extname(name).toLowerCase())) throw new Error(`only Markdown corpus files are allowed: ${path}`);
}
function assertInside(root: string, target: string, display: string): void {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (target !== root && !target.startsWith(prefix)) throw new Error(`manifest path escapes root: ${display}`);
}
function normalizeRelative(value: string): string { return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, ''); }

function cliArgs(argv: string[]): { manifest: string; output: string; roots: CorpusRoots } {
  let manifest = 'corpus.manifest', output = 'corpus.manifest.json';
  const roots: CorpusRoots = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') manifest = argv[++index] ?? manifest;
    else if (arg === '--output') output = argv[++index] ?? output;
    else if (arg === '--root') { const pair = argv[++index] ?? ''; const split = pair.indexOf('='); if (split < 1) throw new Error('--root expects name=path'); roots[pair.slice(0, split)] = pair.slice(split + 1); }
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { manifest, output, roots };
}

if (import.meta.main) {
  const options = cliArgs(process.argv.slice(2));
  const entries = buildManifest(parseManifest(readFileSync(options.manifest, 'utf8')), options.roots);
  writeFileSync(options.output, `${JSON.stringify({ entries }, null, 2)}\n`, { mode: 0o600 });
  console.log(`curated corpus manifest: ${entries.length} files -> ${options.output}`);
}
