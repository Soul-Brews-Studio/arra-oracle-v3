/**
 * Interface the HTTP server binds to.
 *
 * The API has no authentication, so the default is loopback. Before this, `Bun.serve` got no
 * `hostname` and listened on every interface, which let anyone on the same Wi-Fi read the vault
 * through `/api/v1/search`. Containers and deliberate remote setups opt in with ORACLE_HOST.
 */
export function resolveServerHostname(env: Record<string, string | undefined> = process.env): string {
  return env.ORACLE_HOST?.trim() || '127.0.0.1';
}
