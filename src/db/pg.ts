/**
 * Shared Postgres connection (fleet-pg / oracle_kb).
 *
 * One long-lived pool for the whole process — the MCP + HTTP server and every
 * vector-store adapter share it (do NOT open/close a connection per request).
 * Both the relational layer (Part A) and PgVectorAdapter (Part B) use this.
 *
 * DO Managed Postgres TLS: the connection string's `sslmode=require` makes
 * pg-connection-string verify against the SYSTEM root store, which rejects a
 * managed CA ("self signed certificate in chain"). So when we have a CA (or SSL
 * is otherwise wanted) we STRIP sslmode from the URL and pass `ssl: { ca }`
 * ourselves — same lesson as te-kb. We never disable certificate verification.
 */
import pg from 'pg';

let pool: pg.Pool | null = null;

/** Remove the sslmode query param so our explicit `ssl` option governs TLS. */
function stripSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url
      .replace(/([?&])sslmode=[^&]*/i, (_m, p1: string) => (p1 === '?' ? '?' : ''))
      .replace(/[?&]$/, '');
  }
}

export interface PgPoolOptions {
  connectionString?: string;
  caCert?: string;
  max?: number;
}

/**
 * Get the shared process-wide pool, creating it on first use. Resolves the
 * connection string from ORACLE_DATABASE_URL (or DATABASE_URL) and the CA from
 * DATABASE_CA_CERT unless overridden via opts.
 */
export function getPgPool(opts: PgPoolOptions = {}): pg.Pool {
  if (pool) return pool;
  const url = opts.connectionString || process.env.ORACLE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('[pg] ORACLE_DATABASE_URL (or DATABASE_URL) is not set');
  }
  const caCert = opts.caCert ?? process.env.DATABASE_CA_CERT ?? '';
  const wantsSsl =
    /sslmode=(require|prefer|verify-ca|verify-full)/.test(url) ||
    /\.db\.ondigitalocean\.com/.test(url);
  const ssl = caCert ? { ca: caCert } : wantsSsl ? true : undefined;
  const connectionString = ssl ? stripSslMode(url) : url;
  pool = new pg.Pool({ connectionString, max: opts.max ?? 10, ssl });
  return pool;
}

/** True once the shared pool has been created. */
export function hasPgPool(): boolean {
  return pool !== null;
}

/** Close the shared pool (shutdown / tests). */
export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
