import { mkdir, writeFile as nodeWriteFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { authHeaders, flag, parseArgs, resolveApiBase } from './http.ts';

const COLLECTIONS_PATH = '/api/v1/export/app/collections';
const RUN_PATH = '/api/v1/export/app/run';
const FORMATS = new Set(['json', 'csv', 'md', 'jsonl']);

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type FilePayload = string | Uint8Array;

export interface ExportCommandDeps {
  apiBase?: string;
  fetch?: Fetcher;
  mkdir?: typeof mkdir;
  writeFile?: (path: string, data: FilePayload) => Promise<void>;
  env?: Record<string, string | undefined>;
}

interface ExportOptions {
  collection?: string;
  format?: string;
  output?: string;
  help: boolean;
}

export const command = {
  name: 'export',
  description: 'Export ARRA app collections through the local Oracle API.',
};

function normalizeArgs(args: string[]): string[] {
  return args[0] === 'export' ? args.slice(1) : args;
}

function readShortOutput(args: string[]): string | undefined {
  const equals = args.find((arg) => arg.startsWith('-o='));
  if (equals) return equals.slice(3);
  const index = args.indexOf('-o');
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseExportArgs(args: string[]): ExportOptions {
  const clean = normalizeArgs(args);
  const parsed = parseArgs(clean);
  return {
    collection: flag(parsed, 'collection') || parsed.positionals[0],
    format: flag(parsed, 'format') || parsed.positionals[1],
    output: flag(parsed, 'output') || flag(parsed, 'out') || readShortOutput(clean),
    help: clean.includes('--help') || clean.includes('-h'),
  };
}

function usage(): string {
  return [
    'maw arra export',
    'maw arra export --collection NAME --format json|csv|md|jsonl --output PATH',
    'Aliases: --out PATH or -o PATH',
    '',
    'Without export flags, lists available export collections.',
  ].join('\n');
}

function apiUrl(base: string, pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const normalizedBase = base.replace(/\/+$/, '');
  return `${normalizedBase}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.statusText;
  try {
    const data = JSON.parse(text);
    return data?.error ?? data?.message ?? text;
  } catch {
    return text;
  }
}

async function ensureOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${action} failed: HTTP ${response.status} ${await errorText(response)}`);
}

function collectionRows(data: unknown): Array<{ name: string; docs?: unknown; formats?: unknown }> {
  const source = Array.isArray(data)
    ? data
    : Array.isArray((data as { collections?: unknown[] })?.collections)
      ? (data as { collections: unknown[] }).collections
      : [];
  return source.map((item) => {
    if (typeof item === 'string') return { name: item };
    const row = item as Record<string, unknown>;
    return {
      name: String(row.name ?? row.collection ?? row.key ?? row.id ?? 'unknown'),
      docs: row.docs ?? row.count ?? row.total,
      formats: row.formats,
    };
  });
}

function formatCollections(data: unknown): string {
  const rows = collectionRows(data);
  if (!rows.length) return 'No export collections available.';
  return [
    'Collection | Docs | Formats',
    ...rows.map((row) => {
      const formats = Array.isArray(row.formats) ? row.formats.join(',') : row.formats ?? '-';
      return `${row.name} | ${row.docs ?? '-'} | ${formats}`;
    }),
  ].join('\n');
}

function downloadUrl(data: Record<string, unknown>): string | undefined {
  for (const key of ['downloadUrl', 'download_url', 'resultUrl', 'result_url', 'url', 'href', 'file', 'path']) {
    const value = data[key];
    if (typeof value === 'string' && value) return value;
  }
}

function inlinePayload(data: Record<string, unknown>): FilePayload | undefined {
  for (const key of ['content', 'result', 'data']) {
    const value = data[key];
    if (typeof value === 'string') return value;
    if (value !== undefined && value !== null) return `${JSON.stringify(value, null, 2)}\n`;
  }
}

async function resultPayload(response: Response, base: string, fetcher: Fetcher): Promise<FilePayload> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const data = await response.json() as Record<string, unknown>;
  const inline = inlinePayload(data);
  if (inline !== undefined) return inline;
  const url = downloadUrl(data);
  if (!url) throw new Error('export run response did not include a download URL or content');

  const download = await fetcher(apiUrl(base, url));
  await ensureOk(download, `GET ${url}`);
  return new Uint8Array(await download.arrayBuffer());
}

function fullDeps(deps: ExportCommandDeps): Required<ExportCommandDeps> {
  const env = deps.env ?? process.env;
  return {
    apiBase: deps.apiBase ?? resolveApiBase(env),
    fetch: deps.fetch ?? fetch,
    mkdir: deps.mkdir ?? mkdir,
    writeFile: deps.writeFile ?? nodeWriteFile,
    env,
  };
}

async function listCollections(deps: Required<ExportCommandDeps>): Promise<string> {
  const response = await deps.fetch(apiUrl(deps.apiBase, COLLECTIONS_PATH));
  await ensureOk(response, `GET ${COLLECTIONS_PATH}`);
  return formatCollections(await response.json());
}

function validateRun(options: ExportOptions): asserts options is ExportOptions & { collection: string; format: string; output: string } {
  if (!options.collection || !options.format || !options.output) {
    throw new Error('export requires --collection NAME --format json|csv|md|jsonl --output PATH');
  }
  if (!FORMATS.has(options.format)) throw new Error(`unsupported format: ${options.format}`);
}

async function runExport(options: ExportOptions, deps: Required<ExportCommandDeps>): Promise<string> {
  validateRun(options);
  const response = await deps.fetch(apiUrl(deps.apiBase, RUN_PATH), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(deps.env) },
    body: JSON.stringify({ collection: options.collection, format: options.format }),
  });
  await ensureOk(response, `POST ${RUN_PATH}`);

  const payload = await resultPayload(response, deps.apiBase, deps.fetch);
  await deps.mkdir(dirname(options.output), { recursive: true });
  await deps.writeFile(options.output, payload);
  return `exported ${options.collection} (${options.format}) -> ${options.output}`;
}

export async function runExportCommand(args: string[], deps: ExportCommandDeps = {}): Promise<string> {
  const options = parseExportArgs(args);
  if (options.help) return usage();
  const resolvedDeps = fullDeps(deps);
  return options.collection || options.format || options.output
    ? runExport(options, resolvedDeps)
    : listCollections(resolvedDeps);
}

export async function exportCommand(args: string[], deps: ExportCommandDeps = {}): Promise<number> {
  try {
    process.stdout.write(`${await runExportCommand(args, deps)}\n`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export default runExportCommand;

if (import.meta.main) {
  process.exit(await exportCommand(Bun.argv.slice(2)));
}
