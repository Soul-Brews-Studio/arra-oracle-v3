import { mkdir, writeFile as nodeWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildMarkdownExportPayload,
  buildVaultJsonExport,
  buildVectorExportPayload,
  exportCommand as legacyExportCommand,
} from "./export-legacy.ts";

export { buildMarkdownExportPayload, buildVaultJsonExport, buildVectorExportPayload };

const RUN_PATH = "/api/v1/export/app/run";
const FORMATS = new Set(["markdown", "json", "jsonl"]);

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type FilePayload = string | Uint8Array;

export interface RemoteExportOptions {
  url?: string;
  collection?: string;
  format?: string;
  output?: string;
  help: boolean;
}

export interface RemoteExportDeps {
  fetch?: Fetcher;
  mkdir?: typeof mkdir;
  writeFile?: (path: string, data: FilePayload) => Promise<void>;
  env?: Record<string, string | undefined>;
}

function printHelp(): void {
  console.log([
    "bun run export -- --url <oracle-v2-url> --collection <name> --format markdown|json|jsonl --output <path>",
    "",
    "Exports one collection through the Oracle v2 export-app engine.",
    "",
    "Flags:",
    "  --url <url>          Oracle v2 base URL, e.g. http://localhost:47778",
    "  --collection <name>  export collection name, e.g. oracle_documents",
    "  --format <format>    markdown, json, or jsonl",
    "  --output <path>      destination file path",
    "  --help, -h           show this help",
    "",
  ].join("\n"));
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
    help: args.includes("--help") || args.includes("-h"),
  };
}

function requireRemoteOptions(options: RemoteExportOptions): asserts options is Required<RemoteExportOptions> {
  if (!options.url) throw new Error("export requires --url <oracle-v2-url>");
  if (!options.collection) throw new Error("export requires --collection <name>");
  if (!options.format) throw new Error("export requires --format markdown|json|jsonl");
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

async function resultPayload(response: Response, base: string, fetcher: Fetcher): Promise<FilePayload> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return new Uint8Array(await response.arrayBuffer());

  const data = await response.json() as Record<string, unknown>;
  const inline = inlinePayload(data);
  if (inline !== undefined) return inline;

  const url = downloadUrl(data);
  if (!url) throw new Error("export response did not include a download URL or content");
  const download = await fetcher(apiUrl(base, url));
  await ensureOk(download, `GET ${url}`);
  return new Uint8Array(await download.arrayBuffer());
}

export async function runRemoteExportCommand(args: string[], deps: RemoteExportDeps = {}): Promise<string> {
  const options = parseRemoteExportOptions(args);
  if (options.help) return "";
  requireRemoteOptions(options);

  const env = deps.env ?? process.env;
  const fetcher = deps.fetch ?? fetch;
  const response = await fetcher(apiUrl(options.url, RUN_PATH), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(env) },
    body: JSON.stringify({ collection: options.collection, format: options.format }),
  });
  await ensureOk(response, `POST ${RUN_PATH}`);

  const payload = await resultPayload(response, options.url, fetcher);
  await (deps.mkdir ?? mkdir)(dirname(options.output), { recursive: true });
  await (deps.writeFile ?? nodeWriteFile)(options.output, payload);
  return `exported ${options.collection} (${options.format}) -> ${options.output}`;
}

export async function exportCommand(args: string[]): Promise<number> {
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
