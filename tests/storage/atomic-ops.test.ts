import { describe, expect, test } from 'bun:test';
import {
  atomicOp,
  atomicOps,
  tenantAtomicOp,
  tenantAtomicOps,
  type RunnableAtomicStatement,
} from '../../src/db/atomic-ops.ts';

class BatchStatement implements RunnableAtomicStatement<string> {
  constructor(private label: string, private calls: string[]) {}
  run() {
    this.calls.push(`batch:${this.label}`);
    return this.label;
  }
}

describe('atomicOps dual database adapter wrapper', () => {
  test('uses transaction() for Bun-style databases', async () => {
    const calls: string[] = [];
    const db = {
      transaction<T>(callback: (tx: { run(label: string): string }) => T): T {
        calls.push('begin');
        const result = callback({ run: (label) => { calls.push(`tx:${label}`); return label; } });
        calls.push('commit');
        return result;
      },
    };

    const result = await atomicOps(db, [
      (tx) => tx.run('one'),
      atomicOp((tx: { run(label: string): string }) => tx.run('two'), new BatchStatement('unused', calls)),
    ]);

    expect(result).toEqual(['one', 'two']);
    expect(calls).toEqual(['begin', 'tx:one', 'tx:two', 'commit']);
  });

  test('prefers transaction() when both adapter APIs are present', async () => {
    const calls: string[] = [];
    const db = {
      transaction<T>(callback: (tx: { value: string }) => T): T {
        calls.push('transaction');
        return callback({ value: 'tx' });
      },
      batch: async () => {
        calls.push('batch');
        return ['batch'];
      },
    };

    const result = await atomicOps(db, [(tx) => tx.value]);

    expect(result).toEqual(['tx']);
    expect(calls).toEqual(['transaction']);
  });

  test('uses batch() for D1-style databases', async () => {
    const calls: string[] = [];
    const db = {
      batch: async (statements: BatchStatement[]) => Promise.all(statements.map((statement) => statement.run())),
    };

    const result = await atomicOps(db, [
      new BatchStatement('one', calls),
      atomicOp(() => 'unused', new BatchStatement('two', calls)),
    ]);

    expect(result).toEqual(['one', 'two']);
    expect(calls).toEqual(['batch:one', 'batch:two']);
  });

  test('rejects function-only D1 operations because batch statements are required', async () => {
    const db = { batch: async () => [] };

    await expect(atomicOps(db, [() => 'not-batchable']))
      .rejects.toThrow('D1 batch operations require batch statements');
  });

  test('tenantAtomicOps scopes Bun transaction operations with a tenant id', async () => {
    const calls: string[] = [];
    const db = {
      transaction<T>(callback: (tx: { insert(tenantId: string, label: string): string }) => T): T {
        calls.push('begin');
        const result = callback({
          insert: (tenantId, label) => {
            calls.push(`${tenantId}:${label}`);
            return `${tenantId}/${label}`;
          },
        });
        calls.push('commit');
        return result;
      },
    };

    const result = await tenantAtomicOps(db, ' tenant-a ', [
      ({ tx, tenantId }) => tx.insert(tenantId, 'one'),
      tenantAtomicOp(
        ({ tx, tenantId }) => tx.insert(tenantId, 'two'),
        ({ tenantId }) => {
          calls.push('batch-build');
          return new BatchStatement(`${tenantId}:unused`, calls);
        },
      ),
    ]);

    expect(result).toEqual(['tenant-a/one', 'tenant-a/two']);
    expect(calls).toEqual(['begin', 'tenant-a:one', 'tenant-a:two', 'commit']);
  });

  test('tenantAtomicOps scopes D1 batch statements with the same tenant id', async () => {
    const calls: string[] = [];
    const db = {
      batch: async (statements: BatchStatement[]) => Promise.all(statements.map((statement) => statement.run())),
    };

    const result = await tenantAtomicOps(db, 'school-1', [
      tenantAtomicOp(
        () => 'unused',
        ({ tenantId }) => new BatchStatement(`${tenantId}:one`, calls),
      ),
      tenantAtomicOp(
        () => 'unused',
        ({ tenantId }) => new BatchStatement(`${tenantId}:two`, calls),
      ),
    ]);

    expect(result).toEqual(['school-1:one', 'school-1:two']);
    expect(calls).toEqual(['batch:school-1:one', 'batch:school-1:two']);
  });

  test('tenantAtomicOps rejects transaction-only tenant operations on D1', async () => {
    const db = { batch: async () => [] };

    await expect(tenantAtomicOps(db, 'tenant-a', [
      ({ tenantId }) => tenantId,
    ])).rejects.toThrow('scoped batch statements');
  });

  test('tenantAtomicOps rejects missing or malformed tenant ids before running queries', async () => {
    const calls: string[] = [];
    const db = { batch: async () => { calls.push('batch'); return []; } };

    await expect(tenantAtomicOps(db, ' ', [
      tenantAtomicOp(() => 'unused', ({ tenantId }) => new BatchStatement(tenantId, calls)),
    ])).rejects.toThrow('requires tenantId');
    await expect(tenantAtomicOps(db, '../bad', [
      tenantAtomicOp(() => 'unused', ({ tenantId }) => new BatchStatement(tenantId, calls)),
    ])).rejects.toThrow('invalid tenant id');
    expect(calls).toEqual([]);
  });
});
