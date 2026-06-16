import { expect, test } from 'bun:test';
import { isDbLockError } from '../../src/db/index.ts';

test('db/index lock helper detects sqlite contention messages', () => {
  expect(isDbLockError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
  expect(isDbLockError(new Error('SQLITE_LOCKED: table is locked'))).toBe(true);
  expect(isDbLockError('disk I/O error')).toBe(true);
  expect(isDbLockError('Database Is Locked')).toBe(true);
  expect(isDbLockError(new Error('other failure'))).toBe(false);
});
