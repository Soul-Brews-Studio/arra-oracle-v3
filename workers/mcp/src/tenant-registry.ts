type D1Value = string | number | null;
type D1Result<T> = { results?: T[] };

export interface D1TenantStatement {
  bind(...values: D1Value[]): D1TenantStatement;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
}

export interface D1TenantDatabase {
  prepare(sql: string): D1TenantStatement;
  batch?(statements: D1TenantStatement[]): Promise<unknown[]>;
}

export interface TenantRecord {
  id: string;
  name: string | null;
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number;
}

export interface TenantRegistryEnv {
  ORACLE_DB?: D1TenantDatabase;
  ORACLE_TENANTS_TABLE?: string;
}

export interface TenantScopedSelect {
  table: string;
  tenantId: unknown;
  columns?: string[];
  filters?: Record<string, D1Value>;
  limit?: number;
  offset?: number;
}

const DEFAULT_TENANT_ID = 'default';
const TENANT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function normalizeTenantId(value: unknown, fallback = DEFAULT_TENANT_ID): string {
  const requested = typeof value === 'string' ? value.trim() : '';
  const tenantId = requested || fallback;
  if (!TENANT_PATTERN.test(tenantId)) throw new Error('invalid tenant id');
  return tenantId;
}

export function tenantRegistryTable(env?: TenantRegistryEnv): string {
  return quoteIdentifier(env?.ORACLE_TENANTS_TABLE?.trim() || 'tenants');
}

export async function ensureTenantRegistry(db: D1TenantDatabase, table = tenantRegistryTable()): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS ${indexName(table)} ON ${table} (status)`).run();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO ${table} (id, name, status, created_at, updated_at)
     VALUES (?, ?, 'active', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(DEFAULT_TENANT_ID, 'Default tenant', now, now).run();
}

export async function createTenant(
  db: D1TenantDatabase,
  input: { id: unknown; name?: unknown; status?: unknown },
  env?: TenantRegistryEnv,
): Promise<TenantRecord> {
  const table = tenantRegistryTable(env);
  await ensureTenantRegistry(db, table);
  const id = normalizeTenantId(input.id);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : id;
  const status = input.status === 'disabled' ? 'disabled' : 'active';
  const now = Date.now();
  await db.prepare(
    `INSERT INTO ${table} (id, name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, updated_at = excluded.updated_at`,
  ).bind(id, name, status, now, now).run();
  const tenant = await getTenant(db, id, env);
  if (!tenant) throw new Error(`Failed to read tenant after create: ${id}`);
  return tenant;
}

export async function listTenants(
  db: D1TenantDatabase,
  options: { status?: 'active' | 'disabled' } = {},
  env?: TenantRegistryEnv,
): Promise<TenantRecord[]> {
  const table = tenantRegistryTable(env);
  await ensureTenantRegistry(db, table);
  const where = options.status ? ' WHERE status = ?' : '';
  const statement = db.prepare(
    `SELECT id, name, status, created_at AS createdAt, updated_at AS updatedAt
     FROM ${table}${where} ORDER BY id`,
  );
  const result = await (options.status ? statement.bind(options.status) : statement).all<TenantRecord>();
  return (result.results ?? []).map(normalizeTenantRecord);
}

export async function getTenant(db: D1TenantDatabase, id: unknown, env?: TenantRegistryEnv): Promise<TenantRecord | null> {
  const table = tenantRegistryTable(env);
  await ensureTenantRegistry(db, table);
  const row = await db.prepare(
    `SELECT id, name, status, created_at AS createdAt, updated_at AS updatedAt FROM ${table} WHERE id = ? LIMIT 1`,
  ).bind(normalizeTenantId(id)).first<TenantRecord>();
  return row ? normalizeTenantRecord(row) : null;
}

export async function requireActiveTenant(env: TenantRegistryEnv, requested?: unknown): Promise<string | undefined> {
  if (!env.ORACLE_DB) return typeof requested === 'string' && requested.trim() ? normalizeTenantId(requested) : undefined;
  const tenantId = normalizeTenantId(requested);
  const tenant = await getTenant(env.ORACLE_DB, tenantId, env);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  if (tenant.status !== 'active') throw new Error(`Tenant is disabled: ${tenantId}`);
  return tenant.id;
}

export async function tenantScopedAll<T>(db: D1TenantDatabase, query: TenantScopedSelect): Promise<T[]> {
  const table = quoteIdentifier(query.table);
  const columns = (query.columns?.length ? query.columns : ['*']).map(quoteColumn).join(', ');
  const tenantId = normalizeTenantId(query.tenantId);
  const filters = Object.entries(query.filters ?? {});
  const filterSql = filters.map(([key]) => ` AND ${quoteIdentifier(key)} = ?`).join('');
  const limit = boundedInteger(query.limit, 50, 1, 100);
  const offset = boundedInteger(query.offset, 0, 0, 10_000);
  const result = await db.prepare(
    `SELECT ${columns} FROM ${table} WHERE tenant_id = ?${filterSql} LIMIT ? OFFSET ?`,
  ).bind(tenantId, ...filters.map(([, value]) => value), limit, offset).all<T>();
  return result.results ?? [];
}

function quoteColumn(value: string): string {
  return value === '*' ? '*' : quoteIdentifier(value);
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error(`Invalid D1 identifier: ${value}`);
  return `"${value}"`;
}

function indexName(table: string): string {
  return quoteIdentifier(`${stripQuotes(table)}_status_idx`);
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '');
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value!)));
}

function normalizeTenantRecord(row: TenantRecord): TenantRecord {
  return {
    id: row.id,
    name: row.name ?? null,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}
