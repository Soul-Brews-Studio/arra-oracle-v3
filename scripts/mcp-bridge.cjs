#!/usr/bin/env node
/**
 * A Node stdio shim in front of the Oracle MCP server — for WINDOWS HOSTS.
 *
 * On Windows some MCP clients hand a spawned server a stdin handle Bun does not
 * read from, so `bun bin/mcp.ts` starts, prints its banner, and then sits there
 * forever having never seen the client's `initialize`. The client eventually
 * times out and reports the server as broken, which it is not.
 *
 * Node's `child_process.spawn` always creates an ordinary named pipe for the
 * child's stdin. Putting Node in front therefore normalises the handle: the
 * client talks to Node, Node talks to Bun over a pipe Bun is happy to read, and
 * this file copies bytes between the two without touching them — JSON-RPC
 * framing is byte-exact in both directions, and only stderr is passed through
 * for logging, so nothing here can corrupt the protocol stream.
 *
 * On macOS and Linux the bridge is a pure pass-through with an extra process in
 * it. Point those clients straight at `bun bin/mcp.ts` instead.
 *
 * Windows MCP client config:
 *   {
 *     "command": "node",
 *     "args": ["C:\\path\\to\\arra-oracle-v3\\scripts\\mcp-bridge.cjs"]
 *   }
 *
 * Set `ORACLE_BUN_BIN` if `bun` is not on the PATH the MCP client spawns with —
 * on Windows that PATH is often the one the desktop client inherited at login,
 * not the one your shell has. Every other environment variable is passed
 * through unchanged.
 *
 * `.cjs`, not `.js`: package.json declares `"type": "module"`.
 *
 * Salvaged from PR #2749 by @mdes-innova-th.
 */
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { constants } = require('node:os');
const path = require('node:path');

/** The repo root, from this file's own location. */
function resolveRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * `bin/mcp.ts`, the launcher CLAUDE.md documents — not `src/index.ts` directly.
 * The launcher validates the entrypoint and sets ORACLE_REPO_ROOT, so bridging
 * through it keeps Windows behaving like every other host, and keeps this shim
 * correct if the entrypoint moves.
 */
function resolveEntry(root = resolveRoot()) {
  return path.join(root, 'bin', 'mcp.ts');
}

function resolveBun() {
  return process.env.ORACLE_BUN_BIN || 'bun';
}

/** Shell convention for "died by signal", so a Bun crash is never reported as success. */
function exitCodeFor(code, signal) {
  if (signal) return 128 + (constants.signals[signal] || 0);
  return code === null || code === undefined ? 0 : code;
}

function bridge(args = process.argv.slice(2)) {
  const root = resolveRoot();
  const entry = resolveEntry(root);
  if (!existsSync(entry)) {
    console.error(`[mcp-bridge] MCP entrypoint not found: ${entry}`);
    process.exit(1);
  }

  const bun = resolveBun();
  const child = spawn(bun, [entry, ...args], {
    cwd: root,
    env: process.env,
    // stderr is inherited so the server's logs reach the client's log pane
    // without ever entering the stdout stream the protocol owns.
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });

  child.on('error', (error) => {
    console.error(`[mcp-bridge] could not start "${bun}": ${error.message}`);
    console.error('[mcp-bridge] set ORACLE_BUN_BIN to the full path of bun.exe');
    process.exit(127);
  });

  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);

  // Either half of a pipe can go away first — the client closing stdin while the
  // server is still writing, or the server dying mid-request. Both surface as an
  // EPIPE 'error' event, and an unhandled one would take the bridge down with a
  // Node stack trace on the stream the MCP client is trying to parse.
  child.stdin.on('error', () => {});
  child.stdout.on('error', () => {});
  process.stdin.on('error', () => {});

  for (const signal of ['SIGINT', 'SIGTERM']) {
    // Without this the client kills the bridge and leaves Bun running, holding
    // the vector store open until the machine is rebooted.
    process.on(signal, () => child.kill(signal));
  }

  // 'close' rather than 'exit': 'exit' fires as soon as the child is reaped,
  // which can be before its last stdout chunk has been copied to ours, and a
  // truncated final JSON-RPC frame is worse than a slow shutdown. Setting
  // exitCode instead of calling process.exit() lets that copy finish; the stdin
  // read handle has to be released by hand or it holds the loop open forever.
  child.on('close', (code, signal) => {
    process.exitCode = exitCodeFor(code, signal);
    process.stdin.destroy();
  });

  return child;
}

module.exports = { bridge, exitCodeFor, resolveBun, resolveEntry, resolveRoot };

if (require.main === module) bridge();
