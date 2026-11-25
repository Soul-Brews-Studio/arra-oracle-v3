#!/usr/bin/env bun
/**
 * psi-ane-index — scan a ψ vault, import it into its own arra database, and embed it on the ANE.
 *
 *   bun scripts/psi-ane-index.ts <ψ dir | repo with ψ/> [--dry-run] [--ane URL] [--model TAG] [--data-dir DIR]
 *
 * 1. SCAN    count the markdown arra's indexer reads (resonance, learnings, retrospectives,
 *            distillations, learn) and what it leaves out (inbox, writing, lab, ...).
 * 2. CHECK   the ANE embed pool (ane-oracle's Swift Core ML app, Ollama-shaped API on :11445;
 *            tools/ane-embed/serve_embed.py serves the same API on :11435): /health, the model
 *            tag, one probe embedding and its dimension.
 * 3. IMPORT  run arra's own indexer (src/indexer/cli.ts) into a SEPARATE data dir, embedding
 *            through the ANE. A separate dir keeps 768-d ANE vectors out of any existing index:
 *            vectors from different models must never share one store.
 * 4. REPORT  documents and vectors written, and the command to serve the result.
 *
 * Read-only on the vault. Nothing is deleted. Defaults: ANE pool http://127.0.0.1:11445,
 * model embeddinggemma:ane-w8a16, data dir ~/.arra-ane/<repo name>.
 * EmbeddingGemma's task prompts ("task: search result | query:" / "title: none | text:") are added
 * by arra's embedder once PR #3108 lands; before that, vectors are made without them.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Database } from 'bun:sqlite';

const INDEXED = ['memory/resonance', 'memory/learnings', 'memory/retrospectives', 'memory/distillations', 'learn'];
const ROOT = path.resolve(import.meta.dir, '..');

interface Args { target?: string; dryRun: boolean; ane: string; model: string; dataDir?: string; help: boolean }

export function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, ane: 'http://127.0.0.1:11445', model: 'embeddinggemma:ane-w8a16', help: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run' || v === '-n') a.dryRun = true;
    else if (v === '--help' || v === '-h') a.help = true;
    else if (v === '--ane') a.ane = argv[++i].replace(/\/+$/, '');
    else if (v === '--model') a.model = argv[++i];
    else if (v === '--data-dir') a.dataDir = argv[++i];
    else if (!v.startsWith('-') && !a.target) a.target = v;
    else throw new Error(`unknown argument: ${v}`);
  }
  return a;
}

/** Accept the ψ dir itself or a repo that has one; follow symlinks (ψ is often a link to another vault). */
export function resolveVault(target: string): { repo: string; psi: string } {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`no such path: ${abs}`);
  const isPsi = path.basename(abs) === 'ψ' || path.basename(abs) === 'psi';
  const psiLink = isPsi ? abs : path.join(abs, 'ψ');
  if (!fs.existsSync(psiLink)) throw new Error(`no ψ/ in ${abs}`);
  const psi = fs.realpathSync(psiLink);
  return { repo: path.dirname(psi), psi };
}

/** Count .md the way arra's indexer walks (src/indexer/collectors.ts getAllMarkdownFiles): follows links, skips nothing. */
function countMd(dir: string, viaOrigin = { n: 0 }, inOrigin = false): number {
  let items: string[];
  try { items = fs.readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const name of items) {
    const p = path.join(dir, name);
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { continue; }
    const origin = inOrigin || (name === 'origin' && fs.lstatSync(p).isSymbolicLink());
    if (st.isDirectory()) n += countMd(p, viaOrigin, origin);
    else if (name.endsWith('.md')) { n += 1; if (origin) viaOrigin.n += 1; }
  }
  return n;
}

export function scan(psi: string): { indexed: Record<string, number>; skipped: Record<string, number>; total: number; viaOrigin: number } {
  const indexed: Record<string, number> = {};
  const viaOrigin = { n: 0 };
  for (const rel of INDEXED) indexed[rel] = countMd(path.join(psi, rel), viaOrigin);
  const skipped: Record<string, number> = {};
  const top = fs.readdirSync(psi, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  for (const e of top) {
    if (e.name === 'learn') continue;
    if (e.name === 'memory') {
      for (const m of fs.readdirSync(path.join(psi, 'memory'), { withFileTypes: true })) {
        if (m.isDirectory() && !INDEXED.includes(`memory/${m.name}`)) skipped[`memory/${m.name}`] = countMd(path.join(psi, 'memory', m.name));
      }
      continue;
    }
    skipped[e.name] = countMd(path.join(psi, e.name));
  }
  const total = Object.values(indexed).reduce((s, n) => s + n, 0);
  return { indexed, skipped, total, viaOrigin: viaOrigin.n };
}

async function checkAne(base: string, model: string): Promise<{ ok: true; dims: number } | { ok: false; why: string }> {
  try {
    // The ANE service has /health; plain Ollama does not (404). The probe embedding below is the real test.
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok && health.status !== 404) return { ok: false, why: `${base}/health answered ${health.status}` };
    const tags = await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })).json() as { models?: Array<{ name?: string; model?: string }> };
    const names = (tags.models ?? []).map((m) => m.name ?? m.model ?? '');
    if (names.length && !names.includes(model)) return { ok: false, why: `model ${model} not served; ${base} has: ${names.join(', ')}` };
    const r = await fetch(`${base}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: ['title: none | text: probe'] }), signal: AbortSignal.timeout(60_000) });
    const body = await r.json() as { embeddings?: number[][]; error?: string };
    const dims = body.embeddings?.[0]?.length ?? 0;
    return dims ? { ok: true, dims } : { ok: false, why: body.error ?? `probe returned no vector (HTTP ${r.status})` };
  } catch (error) {
    return { ok: false, why: `${base} unreachable: ${(error as Error).message}` };
  }
}

function report(dataDir: string): string {
  const dbPath = path.join(dataDir, 'oracle.db');
  if (!fs.existsSync(dbPath)) return `no database at ${dbPath}`;
  const db = new Database(dbPath, { readonly: true });
  const docs = (db.query('SELECT count(*) AS n FROM oracle_documents').get() as { n: number }).n;
  const byType = db.query('SELECT type, count(*) AS n FROM oracle_documents GROUP BY type ORDER BY n DESC').all() as Array<{ type: string; n: number }>;
  db.close();
  return `${docs} documents (${byType.map((t) => `${t.type} ${t.n}`).join(', ')})`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target) { console.log(fs.readFileSync(import.meta.path, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, '')); return args.target ? 0 : 1; }
  const { repo, psi } = resolveVault(args.target);
  const dataDir = path.resolve(args.dataDir ?? path.join(os.homedir(), '.arra-ane', path.basename(repo)));

  console.log(`1 SCAN    ${psi}`);
  const s = scan(psi);
  for (const [rel, n] of Object.entries(s.indexed)) console.log(`          ${String(n).padStart(6)}  ψ/${rel}`);
  console.log(`          ${String(s.total).padStart(6)}  markdown files arra will import`);
  if (s.viaOrigin) console.log(`          (!) ${s.viaOrigin} of them come through ψ/learn/**/origin links into cloned source repos (node_modules included)`);
  const left = Object.entries(s.skipped).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`);
  if (left.length) console.log(`          not read by arra's indexer: ${left.join(' · ')}`);

  console.log(`2 CHECK   ANE ${args.ane}  model ${args.model}`);
  const ane = await checkAne(args.ane, args.model);
  if (!ane.ok) {
    console.error(`          FAIL ${ane.why}`);
    console.error('          start the ANE pool (ane-oracle: open its ANE Embed app, :11445), or point --ane at');
    console.error('          tools/ane-embed/serve_embed.py --gemma-root "$GEMMA" --gemma-only --port 11435');
    return 2;
  }
  console.log(`          OK, ${ane.dims}-d vectors`);
  if (args.dryRun) { console.log(`          dry run: would import into ${dataDir}`); return 0; }

  console.log(`3 IMPORT  into ${dataDir}`);
  fs.mkdirSync(dataDir, { recursive: true });
  const env = { ...process.env, ORACLE_DATA_DIR: dataDir, ORACLE_DB_PATH: path.join(dataDir, 'oracle.db'), ORACLE_REPO_ROOT: repo, ORACLE_EMBEDDER: 'ollama', OLLAMA_BASE_URL: args.ane, ORACLE_EMBEDDING_MODEL: args.model, ORACLE_FILE_WATCHER: '0' };
  delete (env as Record<string, string | undefined>).DATABASE_URL;
  const t0 = Date.now();
  const proc = Bun.spawn(['bun', path.join(ROOT, 'src/indexer/cli.ts'), '--repo-root', repo], { cwd: ROOT, env, stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code !== 0) { console.error(`          indexer exited ${code}`); return code; }

  console.log(`4 REPORT  ${report(dataDir)} in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`          serve it: ORACLE_DATA_DIR=${dataDir} ORACLE_EMBEDDER=ollama OLLAMA_BASE_URL=${args.ane} ORACLE_EMBEDDING_MODEL=${args.model} bun run server`);
  return 0;
}

if (import.meta.main) process.exit(await main());
