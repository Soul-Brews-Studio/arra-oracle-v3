/**
 * ARRA Oracle HTTP API helper for arra-cli plugins.
 *
 * Resolves in priority order:
 * ORACLE_API env → --at <target> → project .arra config → global
 * ~/.config/arra config → localhost default.
 * Note: issue #770 spec listed 3457 — real oracle default is 47778.
 */

import { resolveOracleApi } from "./config.ts";

export function oracleApiBase(): string {
  return resolveOracleApi().baseUrl;
}

export const BASE_URL = oracleApiBase();

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
      `  → Override with ORACLE_API=http://localhost:<port>\n` +
      `  Original: ${msg}`
    );
  }
}
