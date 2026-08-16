/**
 * Auto-start the daemon that HTTP-proxy mode proxies *to*.
 *
 * `OracleMCPServer` resolves `ORACLE_HTTP_URL`, logs "Running in HTTP-proxy mode", and then
 * proxies every tool call to it — but it never called `ensureServerRunning()`. The only callers
 * were `src/cli/commands/serve.ts` and `ensure-server.ts`'s own main, so nothing on the MCP path
 * ever restarted a dead daemon. Observed 2026-08-16 on m5: `oracle-http.pid` held PID 53395 from
 * `2026-08-14T11:43:30Z`, that process was long gone, nothing listened on :47778, and four live
 * `bin/mcp.ts` processes proxied into the hole. Every `oracle_search` failed with "Cannot reach
 * ARRA Oracle" while 7,127 documents sat healthy in the database underneath.
 *
 * The stale PID file was never the bug — `cleanupStalePidFile()` handles it correctly. It just
 * never ran, because nothing called the function that calls it.
 */
import { PORT } from '../config.ts';

/**
 * Only a *local* daemon on *our* port may be auto-started.
 *
 * `resolveOracleApiBase()` accepts `ORACLE_HTTP_URL` / `ORACLE_API` / `NEO_ARRA_API`, any of
 * which can legitimately point at another machine (a shared fleet Oracle, a cloud deployment).
 * Spawning a local server because a *remote* one is unreachable would be worse than the outage:
 * the local daemon opens a different database, comes up healthy, and answers with the wrong
 * corpus. A remote target that is down must stay down and surface its own error.
 */
export function isLocalDaemonTarget(apiBase: string): boolean {
  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return false;
  // An explicit port must match ours; a bare host:// with no port is not this daemon.
  return url.port !== '' && Number(url.port) === PORT;
}

/**
 * Idempotent and safe to race: `ensureServerRunning()` health-checks first, cleans a stale PID
 * file, and takes a start lock, so the four concurrent `bin/mcp.ts` processes on one machine
 * converge on a single daemon rather than spawning four.
 *
 * Never throws. If the daemon cannot be started, the proxied call proceeds and fails with the
 * real transport error — an auto-start failure must not turn a degraded Oracle into a dead one.
 */
export async function ensureProxyTarget(apiBase: string): Promise<void> {
  if (!isLocalDaemonTarget(apiBase)) return;
  try {
    const { ensureServerRunning } = await import('../ensure-server.ts');
    await ensureServerRunning({ verbose: false, timeout: 15000 });
  } catch (error) {
    console.error(
      `[Oracle] proxy target ${apiBase} is down and auto-start failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
