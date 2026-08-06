/**
 * ARRA Oracle HTTP API helper for arra-cli plugins.
 *
 * Resolves ORACLE_API, --at, project/global ARRA config, then legacy NEO_ARRA_API
 * (default http://localhost:47778).
 * Note: issue #770 spec listed 3457 — real oracle default is 47778 (ORACLE_DEFAULT_PORT).
 * Override: ORACLE_API=http://localhost:47778 arra-cli <cmd>
 */

import { oracleApiBase } from "./config.ts";

export { oracleApiBase };

export async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const baseUrl = oracleApiBase();
  const url = `${baseUrl}${path}`;
  try {
    return await fetch(url, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach ARRA Oracle at ${baseUrl}\n` +
      `  → Is the server running? Try: bun run server  (in arra-oracle-v3 repo)\n` +
      `  → Override with ORACLE_API=http://localhost:<port> or arra --at <target> <command>\n` +
      `  Original: ${msg}`
    );
  }
}
