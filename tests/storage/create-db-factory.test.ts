import { expect, test } from 'bun:test';
import {
  createDb,
  detectDbRuntime,
  type D1DatabaseBinding,
} from '../../src/db/factory.ts';

function fakeD1(): D1DatabaseBinding {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: [] }),
        raw: async () => [],
        run: async () => ({ success: true }),
      }),
    }),
    batch: async () => [],
  };
}

test('detectDbRuntime uses std-env to detect Bun by default', () => {
  expect(detectDbRuntime()).toBe('bun');
});

test('createDb opens the Bun sqlite Drizzle backend', async () => {
  const connection = await createDb({}, { runtime: 'bun', dbPath: ':memory:' });
  try {
    expect(connection.runtime).toBe('bun');
    expect(connection.db).toBeDefined();
    expect(connection.sqlite).toBeDefined();
    expect(connection.storage.name).toBe('drizzle-sqlite');
  } finally {
    connection.close();
  }
});

test('createDb wraps a Cloudflare D1 binding for workerd', async () => {
  const d1 = fakeD1();
  const connection = await createDb({ DB: d1 }, { runtime: 'workerd' });

  expect(connection.runtime).toBe('workerd');
  expect(connection.d1).toBe(d1);
  expect(connection.db).toBeDefined();
  expect(connection.db.$client).toBe(d1);
});

test('createDb accepts the wrangler ORACLE_DB binding name', async () => {
  const d1 = fakeD1();
  const connection = await createDb({ ORACLE_DB: d1 }, { runtime: 'workerd' });

  expect(connection.runtime).toBe('workerd');
  expect(connection.d1).toBe(d1);
});

test('createDb requires the D1 binding in workerd runtime', async () => {
  await expect(createDb({}, { runtime: 'workerd' }))
    .rejects.toThrow('env.DB or env.ORACLE_DB is required');
});
