import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase, oracleDocuments } from '../../src/db/index.ts';
import type { DatabaseConnection } from '../../src/db/create.ts';
import { runSupersede } from '../../src/tools/supersede.ts';

const roots: string[] = [];
const connections: DatabaseConnection[] = [];
function tempDb(): DatabaseConnection {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-knowledge-super-'));
  roots.push(root);
  const connection = createDatabase(path.join(root, 'oracle.db'));
  connections.push(connection);
  return connection;
}

afterEach(() => {
  for (const connection of connections.splice(0)) connection.storage.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function insertDocs(connection: DatabaseConnection, ids: string[]) {
  const now = Date.now();
  connection.db.insert(oracleDocuments).values(ids.map((id) => ({
    id,
    type: 'learning',
    sourceFile: `ψ/memory/${id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }))).run();
}

describe('knowledge supersede chain hardening', () => {
  test('marks supersede once and preserves append-only old document rows', () => {
    const connection = tempDb();
    insertDocs(connection, ['old', 'new', 'newer']);

    const first = runSupersede(connection.db, { oldId: 'old', newId: 'new', reason: 'updated' });
    const second = runSupersede(connection.db, { oldId: 'old', newId: 'newer', reason: 'overwrite' });
    const old = connection.db.select().from(oracleDocuments).where(eq(oracleDocuments.id, 'old')).get();

    expect(first.payload).toMatchObject({ success: true, old_id: 'old', new_id: 'new' });
    expect(second.isError).toBe(true);
    expect(String(second.payload.error)).toContain('already superseded by');
    expect(old?.supersededBy).toBe('new');
    expect(old?.supersededReason).toBe('updated');
  });

  test('rejects malformed payloads and supersede cycles', () => {
    const connection = tempDb();
    insertDocs(connection, ['a', 'b', 'c']);
    runSupersede(connection.db, { oldId: 'b', newId: 'c' });

    const malformed = runSupersede(connection.db, { oldId: ' ', newId: 'b' } as never);
    const cycle = runSupersede(connection.db, { oldId: 'c', newId: 'b' });

    expect(malformed.isError).toBe(true);
    expect(malformed.payload.error).toContain("field 'oldId'");
    expect(cycle.isError).toBe(true);
    expect(cycle.payload.error).toBe('arra_supersede would create a supersede cycle.');
  });
});
