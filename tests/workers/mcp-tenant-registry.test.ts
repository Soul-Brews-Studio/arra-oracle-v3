import { describe, expect, test } from 'bun:test';
import { oracleProxyTool } from '../../workers/mcp/src/proxy.ts';
import {
  createTenant,
  ensureTenantRegistry,
  listTenants,
  requireActiveTenant,
  tenantScopedAll,
  type D1TenantDatabase,
  type D1TenantStatement,
} from '../../workers/mcp/src/tenant-registry.ts';

type D1Value = string | number | null;
type TenantRow = {
  id: string;
  name: string | null;
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number;
};
type State = { tenants: Map<string, TenantRow>; docs: Array<Record<string, D1Value>> };

class MockD1 implements D1TenantDatabase {
  state: State = { tenants: new Map(), docs: [] };

  prepare(sql: string): D1TenantStatement {
    return new MockStatement(sql, this.state);
  }
}

class MockStatement implements D1TenantStatement {
  private values: D1Value[] = [];

  constructor(private readonly sql: string, private readonly state: State) {}

  bind(...values: D1Value[]): D1TenantStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<{ results: unknown[] }> {
    if (this.normalized.includes('INSERT INTO "tenants"')) this.upsertTenant();
    return { results: [] };
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    if (this.normalized.includes('FROM "tenants"')) return { results: this.selectTenants() as T[] };
    if (this.normalized.includes('FROM "oracle_documents"')) return { results: this.selectDocs() as T[] };
    return { results: [] };
  }

  async first<T = unknown>(): Promise<T | null> {
    const { results } = await this.all<T>();
    return results[0] ?? null;
  }

  private get normalized(): string {
    return this.sql.replace(/\s+/g, ' ');
  }

  private upsertTenant(): void {
    const [rawId, rawName, rawStatusOrCreated, rawCreated, rawUpdated] = this.values;
    const id = String(rawId);
    const existing = this.state.tenants.get(id);
    const defaultInsert = this.values.length === 4;
    if (defaultInsert && existing) return;
    const status = defaultInsert || rawStatusOrCreated !== 'disabled' ? 'active' : 'disabled';
    const createdAt = Number(defaultInsert ? rawStatusOrCreated : rawCreated);
    const updatedAt = Number(defaultInsert ? rawCreated : rawUpdated);
    this.state.tenants.set(id, {
      id,
      name: typeof rawName === 'string' ? rawName : null,
      status,
      createdAt: existing?.createdAt ?? createdAt,
      updatedAt,
    });
  }

  private selectTenants(): TenantRow[] {
    let rows = [...this.state.tenants.values()];
    if (this.normalized.includes('WHERE status = ?')) rows = rows.filter((row) => row.status === this.values[0]);
    if (this.normalized.includes('WHERE id = ?')) rows = rows.filter((row) => row.id === this.values[0]);
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  private selectDocs(): Array<Record<string, D1Value>> {
    let valueIndex = 0;
    const tenantId = this.values[valueIndex++];
    let rows = this.state.docs.filter((row) => row.tenant_id === tenantId);
    if (this.normalized.includes('"type" = ?')) {
      const type = this.values[valueIndex++];
      rows = rows.filter((row) => row.type === type);
    }
    const limit = Number(this.values.at(-2) ?? rows.length);
    const offset = Number(this.values.at(-1) ?? 0);
    return rows.slice(offset, offset + limit);
  }
}

function d1(): MockD1 {
  return new MockD1();
}

describe('D1 tenant registry', () => {
  test('creates and lists active and disabled tenants', async () => {
    const db = d1();

    await ensureTenantRegistry(db);
    await createTenant(db, { id: 'school-a', name: 'School A' });
    await createTenant(db, { id: 'school-b', name: 'School B', status: 'disabled' });

    expect((await listTenants(db)).map((tenant) => tenant.id)).toEqual(['default', 'school-a', 'school-b']);
    expect((await listTenants(db, { status: 'active' })).map((tenant) => tenant.id)).toEqual(['default', 'school-a']);
  });

  test('requires active D1 tenants while preserving optional local tenants', async () => {
    const db = d1();
    await createTenant(db, { id: 'school-a' });
    await createTenant(db, { id: 'school-b', status: 'disabled' });

    await expect(requireActiveTenant({ ORACLE_DB: db }, 'school-a')).resolves.toBe('school-a');
    await expect(requireActiveTenant({ ORACLE_DB: db }, undefined)).resolves.toBe('default');
    await expect(requireActiveTenant({ ORACLE_DB: db }, 'school-b')).rejects.toThrow('Tenant is disabled: school-b');
    await expect(requireActiveTenant({ ORACLE_DB: db }, 'school-c')).rejects.toThrow('Tenant not found: school-c');
    await expect(requireActiveTenant({}, undefined)).resolves.toBeUndefined();
  });

  test('scopes D1 rows by tenant id and optional filters', async () => {
    const db = d1();
    db.state.docs.push(
      { id: 'a-learn', tenant_id: 'school-a', type: 'learning' },
      { id: 'a-note', tenant_id: 'school-a', type: 'note' },
      { id: 'b-learn', tenant_id: 'school-b', type: 'learning' },
    );

    const tenantA = await tenantScopedAll(db, {
      table: 'oracle_documents',
      tenantId: 'school-a',
      columns: ['id', 'tenant_id', 'type'],
      filters: { type: 'learning' },
      limit: 10,
    });
    const tenantB = await tenantScopedAll(db, { table: 'oracle_documents', tenantId: 'school-b' });

    expect(tenantA.map((row) => row.id)).toEqual(['a-learn']);
    expect(tenantB.map((row) => row.id)).toEqual(['b-learn']);
    await expect(tenantScopedAll(db, { table: 'bad-table', tenantId: 'school-a' })).rejects.toThrow(
      'Invalid D1 identifier',
    );
  });

  test('validates registry tenants before forwarding MCP proxy requests', async () => {
    const db = d1();
    await createTenant(db, { id: 'school-a' });
    await createTenant(db, { id: 'school-b', status: 'disabled' });
    const captured: Array<{ url: string; headers: Headers }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json({ ok: true });
    }) as typeof fetch;

    const active = await oracleProxyTool({ ORACLE_DB: db, ORACLE_URL: 'https://oracle.example.test' }, {
      path: '/api/stats',
      tenantId: 'school-a',
    }, fetcher);
    const disabled = await oracleProxyTool({ ORACLE_DB: db, ORACLE_URL: 'https://oracle.example.test' }, {
      path: '/api/stats',
      tenantId: 'school-b',
    }, fetcher);

    expect(active.isError).toBeUndefined();
    expect(disabled.isError).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://oracle.example.test/api/stats');
    expect(captured[0].headers.get('x-tenant-id')).toBe('school-a');
    expect(disabled.content[0].text).toContain('Tenant is disabled: school-b');
  });
});
