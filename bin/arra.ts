#!/usr/bin/env bun
const args = process.argv.slice(2);
const command = args[0];

function showHelp(): void {
  console.log(`arra-oracle — Arra Oracle HTTP/MCP server

Usage:
  arra-oracle [serve] [options]
  arra-oracle mcp [--read-only]
  arra-oracle mine <dir> [--watch]
  arra-oracle okf export [--out <dir>] [--source <vault-root>]

Commands:
  serve        Run the HTTP server (default)
  mcp          Run the stdio MCP server
  mine         Ingest a folder into Oracle memory
  okf          Export ψ vault as an OKF v0.1 bundle

Serve options:
  --port <n>    Port to listen on (default: 47778, env: ORACLE_PORT)
  -h, --help    Show this help

Legacy aliases kept working: arra-oracle-v3, arra-oracle-v2.
Once running, open the UI with: bunx oracle-studio`);
}

if (command === "mine") {
  const { mineCommand } = await import("../src/cli/mine.ts");
  process.exit(await mineCommand(args.slice(1)));
}

if (command === "okf") {
  const { okfCommand } = await import("../src/cli/okf/index.ts");
  process.exit(await okfCommand(args.slice(1)));
}

if (args.includes("--help") || args.includes("-h")) {
  showHelp();
  process.exit(0);
}

if (command === "mcp") {
  const bad = args.slice(1).find((arg) => arg !== "--read-only");
  if (bad) {
    console.error(`Error: unknown mcp option: ${bad}`);
    showHelp();
    process.exit(1);
  }
  process.env.ORACLE_LOG_TARGET ??= "stderr";
  console.log = (...data: unknown[]) => console.error(...data);
  const { main } = await import("../src/index.ts");
  await main();
} else {
  const serveArgs = command === "serve" ? args.slice(1) : args;
  for (let i = 0; i < serveArgs.length; i++) {
    const arg = serveArgs[i];
    if (arg === "--port") {
      i++;
      continue;
    }
    if (arg?.startsWith("-")) {
      console.error(`Error: unknown serve option: ${arg}`);
      showHelp();
      process.exit(1);
    }
  }
  const portIdx = serveArgs.indexOf("--port");
  if (portIdx !== -1) {
    const val = serveArgs[portIdx + 1];
    if (!val || !/^\d+$/.test(val)) {
      console.error("Error: --port requires a numeric value");
      process.exit(1);
    }
    process.env.ORACLE_PORT = val;
  }

  const { startServer } = await import("../src/server.ts");
  const server = await startServer();
  console.log(`🔮 Arra Oracle HTTP server → http://localhost:${server.port}`);
}
