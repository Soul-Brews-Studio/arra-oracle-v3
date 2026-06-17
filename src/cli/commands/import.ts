import { readFile } from "fs/promises";
import { createDatabase, oracleDocuments, type DatabaseConnection } from "../../db/index.ts";

export interface DataImportOptions {
  format: "json";
  inFile?: string;
}

type OracleDocumentInsert = typeof oracleDocuments.$inferInsert;
type OracleDocumentRow = typeof oracleDocuments.$inferSelect;

function printHelp(): void {
  console.log("arra-cli import --format json [--in file]\n");
  console.log("Imports vault data as JSON from stdin, or from --in when provided.");
  console.log("\nFlags:");
  console.log("  --format json       input format (required value: json)");
  console.log("  --in <file>         read import JSON from a file instead of stdin");
  console.log("  --help, -h          show this help");
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

function consumeFlag(args: string[], flag: string, consumed: Set<number>): void {
  const index = args.indexOf(flag);
  if (index >= 0) {
    consumed.add(index);
    consumed.add(index + 1);
  }
  const prefix = `${flag}=`;
  const inline = args.findIndex((arg) => arg.startsWith(prefix));
  if (inline >= 0) consumed.add(inline);
}

export function parseImportOptions(args: string[]): DataImportOptions {
  const consumed = new Set<number>();
  const format = readValue(args, "--format") ?? "json";
  consumeFlag(args, "--format", consumed);
  if (format !== "json") throw new Error(`unsupported format: ${format}`);
  const inFile = readValue(args, "--in");
  consumeFlag(args, "--in", consumed);
  const unknown = args.find((_, index) => !consumed.has(index));
  if (unknown) throw new Error(`unknown import option: ${unknown}`);
  return inFile ? { format, inFile } : { format };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== "string") throw new Error(`document.${key} must be string`);
  return row[key];
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  if (typeof row[key] !== "number") throw new Error(`document.${key} must be number`);
  return row[key];
}

function optionalString(row: Record<string, unknown>, key: string): string | null {
  if (row[key] == null) return null;
  if (typeof row[key] !== "string") throw new Error(`document.${key} must be string or null`);
  return row[key];
}

function optionalNumber(row: Record<string, unknown>, key: string): number | null {
  if (row[key] == null) return null;
  if (typeof row[key] !== "number") throw new Error(`document.${key} must be number or null`);
  return row[key];
}

function parseDocument(value: unknown): OracleDocumentInsert {
  const row = asRecord(value, "document");
  return {
    id: requiredString(row, "id"),
    tenantId: optionalString(row, "tenantId") ?? "default",
    type: requiredString(row, "type"),
    sourceFile: requiredString(row, "sourceFile"),
    concepts: requiredString(row, "concepts"),
    createdAt: requiredNumber(row, "createdAt"),
    updatedAt: requiredNumber(row, "updatedAt"),
    indexedAt: requiredNumber(row, "indexedAt"),
    supersededBy: optionalString(row, "supersededBy"),
    supersededAt: optionalNumber(row, "supersededAt"),
    supersededReason: optionalString(row, "supersededReason"),
    origin: optionalString(row, "origin"),
    project: optionalString(row, "project"),
    createdBy: optionalString(row, "createdBy"),
    usageCount: optionalNumber(row, "usageCount") ?? 0,
    lastAccessedAt: optionalNumber(row, "lastAccessedAt"),
  };
}

export function parseVaultJsonExport(input: string): OracleDocumentInsert[] {
  const payload = asRecord(JSON.parse(input), "export payload");
  if (payload.format !== "json" || payload.version !== 1) throw new Error("unsupported export payload");
  const tables = asRecord(payload.tables, "export tables");
  if (!Array.isArray(tables.oracleDocuments)) throw new Error("missing oracleDocuments table");
  return tables.oracleDocuments.map(parseDocument);
}

function updateSet(row: OracleDocumentInsert): Omit<OracleDocumentRow, "id"> {
  return {
    tenantId: row.tenantId ?? "default",
    type: row.type,
    sourceFile: row.sourceFile,
    concepts: row.concepts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    indexedAt: row.indexedAt,
    supersededBy: row.supersededBy ?? null,
    supersededAt: row.supersededAt ?? null,
    supersededReason: row.supersededReason ?? null,
    origin: row.origin ?? null,
    project: row.project ?? null,
    createdBy: row.createdBy ?? null,
    usageCount: row.usageCount ?? 0,
    lastAccessedAt: row.lastAccessedAt ?? null,
  };
}

export function importVaultDocuments(connection: DatabaseConnection, rows: OracleDocumentInsert[]): number {
  for (const row of rows) {
    connection.db.insert(oracleDocuments)
      .values(row)
      .onConflictDoUpdate({ target: oracleDocuments.id, set: updateSet(row) })
      .run();
  }
  return rows.length;
}

async function readInput(inFile?: string): Promise<string> {
  if (inFile) return await readFile(inFile, "utf8");
  return await new Response(Bun.stdin.stream()).text();
}

export async function importCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  let connection: DatabaseConnection | undefined;
  try {
    const options = parseImportOptions(args);
    const rows = parseVaultJsonExport(await readInput(options.inFile));
    connection = createDatabase();
    const imported = importVaultDocuments(connection, rows);
    process.stdout.write(JSON.stringify({ imported }, null, 2) + "\n");
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    connection?.storage.close();
  }
}
