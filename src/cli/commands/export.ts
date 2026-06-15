import { writeFile } from "fs/promises";
import { createDatabase, oracleDocuments, type DatabaseConnection } from "../../db/index.ts";

export interface DataExportOptions {
  format: "json";
  outFile?: string;
}

type OracleDocumentRow = typeof oracleDocuments.$inferSelect;

export interface VaultJsonExport {
  format: "json";
  version: 1;
  exportedAt: string;
  tables: {
    oracleDocuments: OracleDocumentRow[];
  };
}

function printHelp(): void {
  console.log("arra-cli export --format json [--out file]\n");
  console.log("Exports vault data as JSON to stdout, or to --out when provided.");
  console.log("\nFlags:");
  console.log("  --format json       output format (required value: json)");
  console.log("  --out <file>        write export JSON to a file instead of stdout");
  console.log("  --help, -h          show this help");
}

function readValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  const prefix = `${flag}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function parseExportOptions(args: string[]): DataExportOptions {
  const format = readValue(args, "--format") ?? "json";
  if (format !== "json") throw new Error(`unsupported format: ${format}`);
  const outFile = readValue(args, "--out");
  return outFile ? { format, outFile } : { format };
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

export async function exportCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  let connection: DatabaseConnection | undefined;
  try {
    const options = parseExportOptions(args);
    connection = createDatabase();
    const payload = JSON.stringify(buildVaultJsonExport(connection), null, 2) + "\n";
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
