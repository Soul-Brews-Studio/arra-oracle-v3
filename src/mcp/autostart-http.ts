/**
 * Start the Oracle HTTP daemon while the MCP client is still shaking hands.
 *
 * `ensureProxyTarget()` only ever ran on the FIRST TOOL CALL, and only in HTTP-proxy mode. The
 * registration Claude Code actually uses — this repo's `.mcp.json`, whose `env` was empty —
 * resolves no ORACLE_HTTP_URL (`http-proxy.ts:35-41`), so it runs EMBEDDED: the
 * `if (this.oracleApiBase)` guard in the CallTool handler is false and nothing on the MCP path
 * has ever started :47778. The MCP tools work regardless — they read the database in-process —
 * but the web UIs the daemon serves stay dark until somebody runs `bun run server` by hand.
 *
 * Two modes, two policies, one env var (ORACLE_MCP_AUTOSTART_HTTP):
 *
 *  - HTTP-proxy mode, unset or truthy → warm. `isLocalDaemonTarget()` already refuses anything
 *    but our own localhost port, so this can only ever start the daemon the client is about to
 *    proxy into. Default-on because a proxy-mode client is broken without it.
 *
 *  - Embedded mode, truthy ONLY. Embedded MCP does not need a daemon for its own tools; starting
 *    one is a side effect for the web UI's benefit, and defaulting it on is actively dangerous.
 *    The suite spawns `src/index.ts` in embedded mode with a temp ORACLE_DATA_DIR and the REAL
 *    default port (src/tools/__tests__/mcp-proxy-fallback.test.ts, tests/bin/mcp-bridge-*.test.ts);
 *    `spawnDaemon` inherits that env wholesale (process-manager/daemon.ts:34) and detaches
 *    (`:38-47`), and the temp dir is deleted in afterEach. Default-on would therefore leave a
 *    detached daemon holding :47778 and serving a database that no longer exists — the real
 *    Oracle replaced by an empty one, silently. Opt-in keeps the failure mode impossible.
 *
 *  - '0' / 'false' / 'off' / 'no' → both off, including the lazy first-tool-call path. A kill
 *    switch that leaves half the behaviour running is not a kill switch.
 */
import { PORT } from '../config.ts';
import { ensureProxyTarget } from './ensure-proxy-target.ts';

const OFF = new Set(['0', 'false', 'off', 'no']);
const ON = new Set(['1', 'true', 'on', 'yes']);

type Env = Record<string, string | undefined>;

export interface AutostartDeps {
  env?: Env;
  /** Injected in tests so nothing can spawn a real daemon on the real port. */
  ensureLocal?: () => Promise<unknown>;
  ensureProxy?: (apiBase: string) => Promise<void>;
}

const flag = (env: Env) => (env.ORACLE_MCP_AUTOSTART_HTTP ?? '').trim().toLowerCase();

/** Embedded mode starts a daemon only when told to. */
export function embeddedAutostartEnabled(env: Env = process.env): boolean {
  return ON.has(flag(env));
}

/** Proxy mode warms by default; the flag only ever turns it off. */
export function proxyAutostartEnabled(env: Env = process.env): boolean {
  return !OFF.has(flag(env));
}

async function startLocalDaemon(): Promise<unknown> {
  const { ensureServerRunning } = await import('../ensure-server.ts');
  return ensureServerRunning({ verbose: false, timeout: 15000 });
}

/**
 * Never throws and never rejects. An auto-start failure must not take the MCP server down:
 * embedded tools keep answering out of the local database either way, and in proxy mode the
 * tool call proceeds and surfaces the real transport error.
 */
export async function ensureHttpDaemon(apiBase: string | null, deps: AutostartDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  if (apiBase) {
    if (proxyAutostartEnabled(env)) await (deps.ensureProxy ?? ensureProxyTarget)(apiBase);
    return;
  }
  if (!embeddedAutostartEnabled(env)) return;
  try {
    await (deps.ensureLocal ?? startLocalDaemon)();
  } catch (error) {
    // stderr only — stdout is the JSON-RPC stream.
    console.error(
      `[Oracle] auto-start of the HTTP daemon on :${PORT} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
