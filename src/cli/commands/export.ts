import { writeFile } from "fs/promises";
import { createDatabase, oracleDocuments, type DatabaseConnection } from "../../db/index.ts";
import { getExportFormat, streamMarkdown } from "../../vector/export-formats.ts";
import {
  createVectorStoreForModel,
  getEmbeddingModels,
  getVectorStoreByModel,
} from "../../vector/factory.ts";
import { buildCollectionName, coerceRecordsForExport } from "./export-markdown.ts";

const DEFAULT_COLLECTION = "bge-m3";

export interface DataExportOptions {
  format: string;
  outFile?: string;
  source: "vault" | "vector";
  collection: string;
}

type OracleDocumentRow = typeof oracleDocuments.$inferSelect;

type MarkdownSection = string;

type MarkdownCollectionDump = Array<Record<string, unknown>>;

export interface VaultJsonExport {
  format: "json";
  version: 1;
  exportedAt: string;
  tables: {
    oracleDocuments: OracleDocumentRow[];
  };
}

function printHelp(): void {
  console.log("arra-cli export --format <format> [--out file] [--source vault|vector] [--collection <name>]\\n");
  console.log("Exports vault data as JSON (default) or vector embeddings via shared export formatters.");
  console.log("\nFlags:");
  console.log("  --format <format>     output format (default: json)");
  console.log("  --source <source>     export source: vault or vector (default: vault)");
  console.log("  --collection <name>   vector collection/model key (default: bge-m3)");
  console.log("  --out <file>         write export to a file instead of stdout");
  console.log("  --help, -h           show this help");
}

function readValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  const prefix = `${flag}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function parseExportOptions(args: string[]): DataExportOptions {
  const format = readValue(args, "--format") ?? "json";
  const source = readValue(args, "--source") as DataExportOptions["source"] | undefined;
  const outFile = readValue(args, "--out");
  const collection = readValue(args, "--collection") || DEFAULT_COLLECTION;

  if (source && source !== "vault" && source !== "vector") {
    throw new Error(`unsupported source: ${source}`);
  }

  if (source === "vault" && format !== "json") {
    throw new Error(`vault export does not support format: ${format}`);
  }

  if ((source ?? format) !== "json" && !getExportFormat(format)) {
    throw new Error(`unsupported format: ${format}`);
  }

  return {
    format,
    outFile,
    source: source ?? (format === "json" ? "vault" : "vector"),
    collection,
  };
}

export function buildVaultJsonExport(connection: DatabaseConnection): VaultJsonExport {
  return {
    format: "json",
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {
      oracleDocuments: connection.db.select().from(oracleDocuments).all(),
    },
  };
}

async function readStreamAsText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function sectionHeader(name: string): string {
  return `# Collection: ${name}\n\n`;
}

export async function buildAllVectorMarkdownPayload(): Promise<MarkdownSection> {
  const models = getEmbeddingModels();
  const seenCollections = new Set<string>();
  const sections: MarkdownSection[] = [];

  for (const preset of Object.values(models)) {
    if (preset.adapter && preset.adapter !== "lancedb") continue;
    if (seenCollections.has(preset.collection)) continue;
    seenCollections.add(preset.collection);

    const store = createVectorStoreForModel(preset);
    const collectionName = buildCollectionName(preset.collection, "vector");
    let emittedHeader = false;

    try {
      await store.connect();
      await store.ensureCollection();
      sections.push(sectionHeader(collectionName));
      emittedHeader = true;
      
      if (!store.getAllEmbeddings) {
        sections.push(`Not supported for adapter ${store.name}\n\n`);
        continue;
      }

      const stats = await store.getStats().catch(() => ({ count: 0 }));
      const limit = stats.count > 0 ? stats.count : 50_000;
      const dump = await store.getAllEmbeddings(limit);
      sections.push(await readStreamAsText(streamMarkdown(dump)));
      sections.push("\n\n");
    } catch (err) {
      if (!emittedHeader) sections.push(sectionHeader(collectionName));
      sections.push(`Error: ${err instanceof Error ? err.message : String(err)}\n\n`);
    } finally {
      await store.close().catch(() => {});
    }
  }

  return sections.join("");
}

export function buildOracleDocumentsMarkdownTableRows(connection: DatabaseConnection): MarkdownCollectionDump {
  const rows = connection.db.select().from(oracleDocuments).all() as MarkdownCollectionDump;
  return coerceRecordsForExport(rows);
}

export async function buildMarkdownExportPayload(connection: DatabaseConnection): Promise<string> {
  const vectorPayload = await buildAllVectorMarkdownPayload();
  const sqliteRows = buildOracleDocumentsMarkdownTableRows(connection);
  return `${vectorPayload}${sectionHeader(buildCollectionName("oracle_documents", "sqlite"))}`
    + `${JSON.stringify(sqliteRows, null, 2)}\n\n`;
}

export async function buildVectorExportPayload(collection: string, format: string): Promise<string> {
  const store = getVectorStoreByModel(collection);
  try {
    await store.connect();
    await store.ensureCollection();
    if (!store.getAllEmbeddings) {
      throw new Error("Vector collection export is not supported by this adapter");
    }
    const stats = await store.getStats().catch(() => ({ count: 0 }));
    const limit = stats.count > 0 ? stats.count : 50_000;
    const dump = await store.getAllEmbeddings(limit);
    const formatter = getExportFormat(format);
    if (!formatter) throw new Error(`unsupported format: ${format}`);
    return await new Response(formatter(dump)).text();
  } finally {
    await store.close().catch(() => {});
  }
}

export async function exportCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  let connection: DatabaseConnection | undefined;
  try {
    const options = parseExportOptions(args);
    let payload: string;

    if (options.format === "markdown") {
      connection = createDatabase();
      payload = await buildMarkdownExportPayload(connection);
    } else if (options.source === "vector") {
      payload = await buildVectorExportPayload(options.collection, options.format);
    } else {
      connection = createDatabase();
      payload = JSON.stringify(buildVaultJsonExport(connection), null, 2) + "\n";
    }

    if (options.outFile) await writeFile(options.outFile, payload, "utf8");
    else process.stdout.write(payload);

    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    connection?.storage.close();
  }
}
