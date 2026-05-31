/**
 * ARRA Oracle HTTP API helper for arra-cli plugins.
 *
 * Reads ORACLE_API env, then legacy NEO_ARRA_API
 * (default http://localhost:47778).
 * Note: issue #770 spec listed 3457 — real oracle default is 47778 (ORACLE_DEFAULT_PORT).
 * Override: ORACLE_API=http://localhost:47778 arra-cli <cmd>
 */

export function oracleApiBase(): string {
  return (process.env.ORACLE_API ?? process.env.NEO_ARRA_API ?? "http://localhost:47778").replace(/\/$/, "");
}

export const BASE_URL = oracleApiBase();

export async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  try {
    return await fetch(url, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach ARRA Oracle at ${BASE_URL}\n` +
      `  → Is the server running? Try: bun run server  (in arra-oracle-v3 repo)\n` +
      `  → Override with ORACLE_API=http://localhost:<port>\n` +
      `  Original: ${msg}`
    );
  }
}
