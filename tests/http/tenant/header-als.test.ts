import { expect, test } from 'bun:test';
import {
  createTenantFetch,
  currentTenantId,
  LEGACY_TENANT_HEADER,
  ORG_HEADER,
  runWithTenant,
  tenantIdFromHeaders,
  TENANT_API_KEY_HEADER,
  TENANT_HEADER,
} from '../../../src/middleware/tenant.ts';

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;

function withTenantKeys<T>(value: string | undefined, callback: () => T): T {
  const previous = process.env.ORACLE_TENANT_API_KEYS;
  if (value === undefined) delete process.env.ORACLE_TENANT_API_KEYS;
  else process.env.ORACLE_TENANT_API_KEYS = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.ORACLE_TENANT_API_KEYS;
    else process.env.ORACLE_TENANT_API_KEYS = previous;
  }
}

function jsonTenantFetch(delayMs = 0) {
  return createTenantFetch(async () => {
    const before = currentTenantId();
    if (delayMs) await Bun.sleep(delayMs);
    return Response.json({ before: before ?? null, after: currentTenantId() ?? null });
  });
}

test('tenant header resolution skips blank aliases and rejects conflicts', () => {
  expect(tenantIdFromHeaders(new Headers({
    [TENANT_HEADER]: ' ',
    [LEGACY_TENANT_HEADER]: tenantA,
  }))).toBe(tenantA);

  expect(tenantIdFromHeaders(new Headers({
    [TENANT_HEADER]: ` ${tenantA} `,
    [LEGACY_TENANT_HEADER]: tenantA,
    [ORG_HEADER]: tenantA,
  }))).toBe(tenantA);

  expect(() => tenantIdFromHeaders(new Headers({
    [TENANT_HEADER]: tenantA,
    [LEGACY_TENANT_HEADER]: tenantB,
  }))).toThrow('conflicting tenant headers');
});

test('tenant API key derivation cannot contradict explicit tenant headers', () => {
  withTenantKeys(`${tenantA}=key-a,${tenantB}=key-b`, () => {
    expect(tenantIdFromHeaders(new Headers({ [TENANT_API_KEY_HEADER]: 'key-a' }))).toBe(tenantA);
    expect(tenantIdFromHeaders(new Headers({
      [TENANT_HEADER]: tenantA,
      [TENANT_API_KEY_HEADER]: 'key-a',
    }))).toBe(tenantA);

    expect(() => tenantIdFromHeaders(new Headers({
      [TENANT_HEADER]: tenantB,
      [TENANT_API_KEY_HEADER]: 'key-a',
    }))).toThrow('conflicting tenant credentials');
  });
});

test('tenant fetch recomputes tenant when a reused Request has new headers', async () => {
  const fetch = jsonTenantFetch();
  const request = new Request('http://local/api/test', { headers: { [TENANT_HEADER]: tenantA } });

  expect(await (await fetch(request)).json()).toEqual({ before: tenantA, after: tenantA });
  request.headers.set(TENANT_HEADER, tenantB);
  expect(await (await fetch(request)).json()).toEqual({ before: tenantB, after: tenantB });
});

test('AsyncLocalStorage stays scoped across concurrent tenant fetches', async () => {
  const fetch = jsonTenantFetch(5);
  const [resA, resB] = await Promise.all([
    fetch(new Request('http://local/api/test', { headers: { [TENANT_HEADER]: tenantA } })),
    fetch(new Request('http://local/api/test', { headers: { [TENANT_HEADER]: tenantB } })),
  ]);

  expect(await resA.json()).toEqual({ before: tenantA, after: tenantA });
  expect(await resB.json()).toEqual({ before: tenantB, after: tenantB });
  expect(currentTenantId()).toBeUndefined();
});

test('tenant fetch clears ambient tenant context for unscoped requests', async () => {
  const fetch = jsonTenantFetch();
  const seen = await runWithTenant(tenantA, async () => {
    const res = await fetch(new Request('http://local/api/test'));
    return { body: await res.json(), after: currentTenantId() };
  });

  expect(seen).toEqual({ body: { before: null, after: null }, after: tenantA });
});
