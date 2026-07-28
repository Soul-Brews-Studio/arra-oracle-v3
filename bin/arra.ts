#!/usr/bin/env bun
const args = process.argv.slice(2);
const command = args[0];

function showHelp(): void {
  console.log(`arra-oracle — Arra Oracle HTTP/MCP server

Usage:
  arra-oracle [serve] [options]
  arra-oracle mcp [--read-only]

Commands:
  serve        Run the HTTP server (default)
  mcp          Run the stdio MCP server

Serve options:
  --port <n>    Port to listen on (default: 47778, env: ORACLE_PORT)
  -h, --help    Show this help

Legacy aliases kept working: arra-oracle-v3, arra-oracle-v2.
Once running, open the UI with: bunx oracle-studio`);
}

if (args.includes("--help") || args.includes("-h")) {
  showHelp();
  process.exit(0);
}

if (command === "mcp") {
  process.env.ORACLE_LOG_TARGET ??= "stderr";
  console.log = (...data: unknown[]) => console.error(...data);
  await import("../src/index.ts");
} else {
  const serveArgs = command === "serve" ? args.slice(1) : args;
  const portIdx = serveArgs.indexOf("--port");
  if (portIdx !== -1) {
    const val = serveArgs[portIdx + 1];
    if (!val || !/^\d+$/.test(val)) {
      console.error("Error: --port requires a numeric value");
      process.exit(1);
    }
    process.env.ORACLE_PORT = val;
  }

  // Load server module (registers routes + plugins via Elysia setup).
  // Bun's `export default { port, fetch }` auto-server pattern only fires when
  // the file is the entry script. When bin/arra.ts wraps server.ts via
  // `await import()`, the export becomes plain data and no listener is bound.
  // Call Bun.serve() explicitly so the wrapper actually starts a server.
  const { default: appSpec } = await import("../src/server.ts");
  const server = Bun.serve(appSpec);
  console.log(`🔮 Arra Oracle HTTP server → http://localhost:${server.port}`);
}
