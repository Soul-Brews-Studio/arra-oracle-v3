type MaybePromise<T> = T | Promise<T>;
const TENANT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export interface AtomicBatchDb<TBatchItem = unknown> {
  batch(statements: TBatchItem[]): Promise<unknown[]>;
}

export interface AtomicTransactionDb<TTx = unknown> {
  transaction<TResult>(callback: (tx: TTx) => TResult): TResult;
}

export interface RunnableAtomicStatement<TResult = unknown> {
  run(): MaybePromise<TResult>;
}

export interface PairedAtomicOperation<TTx = unknown, TBatchItem = unknown, TResult = unknown> {
  tx: (tx: TTx) => TResult;
  batch: TBatchItem;
}

export interface TenantAtomicScope<TTx = unknown> {
  tx: TTx;
  tenantId: string;
}

export interface TenantBatchScope {
  tenantId: string;
}

export interface PairedTenantAtomicOperation<TTx = unknown, TBatchItem = unknown, TResult = unknown> {
  tx: (scope: TenantAtomicScope<TTx>) => TResult;
  batch: (scope: TenantBatchScope) => TBatchItem;
}

export type AtomicOperation<TTx = unknown, TBatchItem = unknown, TResult = unknown> =
  | ((tx: TTx) => TResult)
  | RunnableAtomicStatement<TResult>
  | PairedAtomicOperation<TTx, TBatchItem, TResult>;

export type TenantAtomicOperation<TTx = unknown, TBatchItem = unknown, TResult = unknown> =
  | ((scope: TenantAtomicScope<TTx>) => TResult)
  | PairedTenantAtomicOperation<TTx, TBatchItem, TResult>;

export function atomicOp<TTx, TBatchItem, TResult>(
  tx: (tx: TTx) => TResult,
  batch: TBatchItem,
): PairedAtomicOperation<TTx, TBatchItem, TResult> {
  return { tx, batch };
}

export function tenantAtomicOp<TTx, TBatchItem, TResult>(
  tx: (scope: TenantAtomicScope<TTx>) => TResult,
  batch: (scope: TenantBatchScope) => TBatchItem,
): PairedTenantAtomicOperation<TTx, TBatchItem, TResult> {
  return { tx, batch };
}

export async function atomicOps<TTx = unknown, TBatchItem = unknown, TResult = unknown>(
  db: AtomicBatchDb<TBatchItem> | AtomicTransactionDb<TTx>,
  operations: readonly AtomicOperation<TTx, TBatchItem, TResult>[],
): Promise<unknown[]> {
  if (operations.length === 0) return [];
  if (hasTransaction<TTx>(db)) {
    return db.transaction((tx) => operations.map((operation) => runInTransaction(tx, operation)));
  }
  if (hasBatch<TBatchItem>(db)) {
    return db.batch(operations.map((operation) => batchItem(operation)));
  }
  throw new Error('atomicOps requires a database with transaction() or batch()');
}

export async function tenantAtomicOps<TTx = unknown, TBatchItem = unknown, TResult = unknown>(
  db: AtomicBatchDb<TBatchItem> | AtomicTransactionDb<TTx>,
  tenantId: string,
  operations: readonly TenantAtomicOperation<TTx, TBatchItem, TResult>[],
): Promise<unknown[]> {
  const scopedTenantId = normalizeAtomicTenantId(tenantId);
  if (operations.length === 0) return [];
  if (hasTransaction<TTx>(db)) {
    return db.transaction((tx) => operations.map((operation) => runTenantInTransaction(tx, scopedTenantId, operation)));
  }
  if (hasBatch<TBatchItem>(db)) {
    return db.batch(operations.map((operation) => tenantBatchItem(scopedTenantId, operation)));
  }
  throw new Error('tenantAtomicOps requires a database with transaction() or batch()');
}

function hasTransaction<TTx>(db: unknown): db is AtomicTransactionDb<TTx> {
  return !!db && typeof (db as { transaction?: unknown }).transaction === 'function';
}

function hasBatch<TBatchItem>(db: unknown): db is AtomicBatchDb<TBatchItem> {
  return !!db && typeof (db as { batch?: unknown }).batch === 'function';
}

function isPairedOperation<TTx, TBatchItem, TResult>(
  operation: AtomicOperation<TTx, TBatchItem, TResult>,
): operation is PairedAtomicOperation<TTx, TBatchItem, TResult> {
  return typeof operation === 'object' && operation !== null && 'tx' in operation && 'batch' in operation;
}

function isTenantPairedOperation<TTx, TBatchItem, TResult>(
  operation: TenantAtomicOperation<TTx, TBatchItem, TResult>,
): operation is PairedTenantAtomicOperation<TTx, TBatchItem, TResult> {
  return typeof operation === 'object' && operation !== null && 'tx' in operation && 'batch' in operation;
}

function runInTransaction<TTx, TBatchItem, TResult>(
  tx: TTx,
  operation: AtomicOperation<TTx, TBatchItem, TResult>,
): MaybePromise<TResult> {
  if (typeof operation === 'function') return operation(tx);
  if (isPairedOperation(operation)) return operation.tx(tx);
  return operation.run();
}

function batchItem<TTx, TBatchItem, TResult>(
  operation: AtomicOperation<TTx, TBatchItem, TResult>,
): TBatchItem {
  if (isPairedOperation(operation)) return operation.batch;
  if (typeof operation === 'function') throw new Error('atomicOps D1 batch operations require batch statements');
  return operation as TBatchItem;
}

function runTenantInTransaction<TTx, TBatchItem, TResult>(
  tx: TTx,
  tenantId: string,
  operation: TenantAtomicOperation<TTx, TBatchItem, TResult>,
): MaybePromise<TResult> {
  if (isTenantPairedOperation(operation)) return operation.tx({ tx, tenantId });
  return operation({ tx, tenantId });
}

function tenantBatchItem<TTx, TBatchItem, TResult>(
  tenantId: string,
  operation: TenantAtomicOperation<TTx, TBatchItem, TResult>,
): TBatchItem {
  if (isTenantPairedOperation(operation)) return operation.batch({ tenantId });
  throw new Error('tenantAtomicOps D1 batch operations require scoped batch statements');
}

function normalizeAtomicTenantId(tenantId: string): string {
  const normalized = typeof tenantId === 'string' ? tenantId.trim() : '';
  if (!normalized) throw new Error('tenantAtomicOps requires tenantId');
  if (!TENANT_PATTERN.test(normalized)) throw new Error('invalid tenant id');
  return normalized;
}
