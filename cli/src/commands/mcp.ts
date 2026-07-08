#!/usr/bin/env bun

export function printMcpHelp(): void {
  console.log("Usage: arra mcp [--read-only]");
  console.log("");
  console.log("Flags:");
  console.log("  --read-only    disable write-capable MCP tools");
  console.log("  --help, -h     show this help");
}

function parseBadFlag(args: string[]): string | undefined {
  return args.find(arg => arg !== "--read-only" && arg !== "--help" && arg !== "-h");
}

export async function mcpCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printMcpHelp();
    return 0;
  }

  const bad = parseBadFlag(args);
  if (bad) {
    console.error(`unknown mcp option: ${bad}`);
    printMcpHelp();
    return 1;
  }

  const originalLog = console.log;
  process.env.ORACLE_LOG_TARGET ??= "stderr";
  console.log = (...parts: unknown[]) => console.error(...parts);

  try {
    const { main } = await import("../../../src/index.ts");
    await main();
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    console.log = originalLog;
  }
}
