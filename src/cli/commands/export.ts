import { mkdir, writeFile as nodeWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildMarkdownExportPayload,
  buildVaultJsonExport,
  buildVectorExportPayload,
  exportCommand as legacyExportCommand,
} from "./export-legacy.ts";
import { CLI_VERSION } from "../help.ts";

export { buildMarkdownExportPayload, buildVaultJsonExport, buildVectorExportPayload };

const RUN_PATH = "/api/v1/export/app/run";
const FORMATS = new Set(["markdown", "json", "jsonl", "csv"]);
const DEFAULT_RETRY_DELAY_MS = 250;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type FilePayload = string | Uint8Array;
type RetryOptions = Pick<RemoteExportOptions, "retries" | "retryDelayMs">;

export interface RemoteExportOptions {
  url?: string;
  collection?: string;
  format?: string;
  output?: string;
  includeGraph: boolean;
  retries: number;
  retryDelayMs: number;
  help: boolean;
}

export interface RemoteExportDeps {
  fetch?: Fetcher;
  mkdir?: typeof mkdir;
  writeFile?: (path: string, data: FilePayload) => Promise<void>;
  env?: Record<string, string | undefined>;
}

export function renderRemoteExportHelp(): string {
  return [
    "bun run export -- --url <oracle-v2-url> --collection <name> --format markdown|json|jsonl|csv --output <path>",
    "",
    "Exports one collection through the Oracle v2 export-app engine.",
    "",
    "Flags:",
    "  --url <url>          Oracle v2 base URL, e.g. http://localhost:47778",
    "  --collection <name>  export collection name, e.g. oracle_documents",
    "  --format <format>    markdown, json, jsonl, or csv",
    "  --output <path>      destination file path",
    "  --include-graph      include relationship graph rows when supported",
    "  --graph              alias for --include-graph",
    "  --retries <count>    retry transient HTTP/network failures",
    "  --retry-delay-ms <n> delay between retry attempts (default 250)",
    "  --version, -v, -V    show export CLI version",
    "  --help, -h           show this help",
    "",
  ].join("\n");
}

export function renderRemoteExportVersion(): string {
  return `arra export v${CLI_VERSION}`;
}

function printHelp(): void {
  console.log(renderRemoteExportHelp());
}

function readValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    return value;
  }
  const prefix = `${flag}=`;
  const value = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (value === "") throw new Error(`missing value for ${flag}`);
  return value;
}

function readNonNegativeInt(args: string[], flag: string, fallback: number): number {
  const value = readValue(args, flag);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  return Number(value);
}

function hasNewExportFlag(args: string[]): boolean {
  return args.some((arg) => arg === "--url" || arg.startsWith("--url=")
    || arg === "--output" || arg.startsWith("--output="));
}

export function parseRemoteExportOptions(args: string[]): RemoteExportOptions {
  return {
    url: readValue(args, "--url"),
    collection: readValue(args, "--collection"),
    format: readValue(args, "--format"),
    output: readValue(args, "--output"),
    includeGraph: args.includes("--include-graph") || args.includes("--graph"),
    retries: readNonNegativeInt(args, "--retries", 0),
    retryDelayMs: readNonNegativeInt(args, "--retry-delay-ms", DEFAULT_RETRY_DELAY_MS),
    help: args.includes("--help") || args.includes("-h"),
  };
}

function requireRemoteOptions(options: RemoteExportOptions): asserts options is Required<RemoteExportOptions> {
  if (!options.url) throw new Error("export requires --url <oracle-v2-url>");
  if (!options.collection) throw new Error("export requires --collection <name>");
  if (!options.format) throw new Error("export requires --format markdown|json|jsonl|csv");
  if (!options.output) throw new Error("export requires --output <path>");
  if (!FORMATS.has(options.format)) throw new Error(`unsupported format: ${options.format}`);
}

function apiUrl(base: string, pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const normalizedBase = base.replace(/\/+$/, "");
  return `${normalizedBase}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

function authHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const token = env.ARRA_API_TOKEN?.trim() || env.ORACLE_API_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.statusText;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return String(data.error ?? data.message ?? text);
  } catch {
    return text;
  }
}

async function ensureOk(response: Response, action: string): Promise<void> {
  if (!response.ok) throw new Error(`${action} failed: HTTP ${response.status} ${await errorText(response)}`);
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithRetry(
  fetcher: Fetcher,
  input: string,
  init: RequestInit | undefined,
  options: RetryOptions,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetcher(input, init);
      if (attempt >= options.retries || !retryableStatus(response.status)) return response;
      try { await response.body?.cancel(); } catch {}
    } catch (error) {
      if (attempt >= options.retries) throw error;
    }
    if (options.retryDelayMs > 0) await Bun.sleep(options.retryDelayMs);
  }
}

function downloadUrl(data: Record<string, unknown>): string | undefined {
  for (const key of ["downloadUrl", "download_url", "resultUrl", "result_url", "url", "href", "path"]) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
}

function inlinePayload(data: Record<string, unknown>): FilePayload | undefined {
  for (const key of ["content", "result", "data"]) {
    const value = data[key];
    if (typeof value === "string") return value;
    if (value !== undefined && value !== null) return `${JSON.stringify(value, null, 2)}\n`;
  }
}

async function resultPayload(response: Response, base: string, fetcher: Fetcher, retry: RetryOptions): Promise<FilePayload> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return new Uint8Array(await response.arrayBuffer());

  const data = await response.json() as Record<string, unknown>;
  const inline = inlinePayload(data);
  if (inline !== undefined) return inline;

  const url = downloadUrl(data);
  if (!url) throw new Error("export response did not include a download URL or content");
  const download = await fetchWithRetry(fetcher, apiUrl(base, url), undefined, retry);
  await ensureOk(download, `GET ${url}`);
  return new Uint8Array(await download.arrayBuffer());
}

export async function runRemoteExportCommand(args: string[], deps: RemoteExportDeps = {}): Promise<string> {
  const options = parseRemoteExportOptions(args);
  if (options.help) return "";
  requireRemoteOptions(options);

  const env = deps.env ?? process.env;
  const fetcher = deps.fetch ?? fetch;
  const response = await fetchWithRetry(fetcher, apiUrl(options.url, RUN_PATH), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(env) },
    body: JSON.stringify({
      collection: options.collection,
      format: options.format,
      ...(options.includeGraph ? { includeGraph: true } : {}),
    }),
  }, options);
  await ensureOk(response, `POST ${RUN_PATH}`);

  const payload = await resultPayload(response, options.url, fetcher, options);
  await (deps.mkdir ?? mkdir)(dirname(options.output), { recursive: true });
  await (deps.writeFile ?? nodeWriteFile)(options.output, payload);
  return `exported ${options.collection} (${options.format}) -> ${options.output}`;
}

export async function exportCommand(args: string[]): Promise<number> {
  if (args.includes("--version") || args.includes("-v") || args.includes("-V")) {
    process.stdout.write(`${renderRemoteExportVersion()}\n`);
    return 0;
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }
  if (!hasNewExportFlag(args)) return legacyExportCommand(args);

  try {
    process.stdout.write(`${await runRemoteExportCommand(args)}\n`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

if (import.meta.main) process.exit(await exportCommand(Bun.argv.slice(2)));
