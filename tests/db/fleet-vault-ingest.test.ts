import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { createDatabase, type DatabaseConnection } from '../../src/db/index.ts';
import { fleetIngestCursor, fleetMessages } from '../../src/db/schema.ts';
import { ingestVaultInbox, parseVaultMessage, vaultThreadKey } from '../../src/fleet-log/vault-ingest.ts';

let tempDir = '';
let connection: DatabaseConnection | undefined;

afterEach(() => {
  connection?.storage.close();
  connection = undefined;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function freshHarness() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-fleet-vault-'));
  const repoRoot = path.join(tempDir, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'ψ', 'inbox'), { recursive: true });
  connection = createDatabase(path.join(tempDir, 'oracle.db'));
  return { repoRoot, connection };
}

function writeInbox(repoRoot: string, name: string, body: string, mtime: Date): void {
  const file = path.join(repoRoot, 'ψ', 'inbox', name);
  fs.writeFileSync(file, body);
  fs.utimesSync(file, mtime, mtime);
}

test('vault inbox ingestion upserts frontmatter messages and cursor state', () => {
  const { repoRoot, connection } = freshHarness();
  const first = `---\nfrom: m5:digger\nto: digger\ntimestamp: 2026-07-01T00:05:00.000Z\nread: false\n---\n[m5:digger] first\n`;
  const second = `---\nfrom: digger\nto: m5:digger\ntimestamp: 2026-07-01T00:10:00.000Z\nread: true\n---\nreply\n`;
  writeInbox(repoRoot, '2026-07-01_00-05_m5-digger_first.md', first, new Date('2026-07-01T00:06:00Z'));
  writeInbox(repoRoot, '2026-07-01_00-10_digger_reply.md', second, new Date('2026-07-01T00:11:00Z'));

  const summary = ingestVaultInbox({ repoRoot, connection, now: () => 111 });
  expect(summary).toMatchObject({ scanned: 2, skipped: 0, processed: 2, rowCount: 2 });

  const rows = connection.db.select().from(fleetMessages).all();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    channel: 'vault',
    source: 'arra-oracle-v3',
    direction: 'inbound',
    fromId: 'm5:digger',
    toId: 'digger',
    rawPath: 'ψ/inbox/2026-07-01_00-05_m5-digger_first.md',
    text: '[m5:digger] first\n',
  });
  expect(rows[0].threadKey).toBe(rows[1].threadKey);

  const cursor = connection.db.select().from(fleetIngestCursor)
    .where(eq(fleetIngestCursor.id, 'vault:arra-oracle-v3')).get();
  expect(cursor?.status).toBe('idle');
  expect(Number(cursor?.lastCursor)).toBeGreaterThan(0);

  const rerun = ingestVaultInbox({ repoRoot, connection, now: () => 222 });
  expect(rerun).toMatchObject({ scanned: 2, skipped: 2, processed: 0, rowCount: 2 });
});

test('thread keys are participant-sorted 30-minute buckets', () => {
  const ts = Date.parse('2026-07-01T00:29:00.000Z');
  expect(vaultThreadKey('z', 'a', ts)).toBe(`vault:a|z:${Date.parse('2026-07-01T00:00:00.000Z')}`);
});

test('legacy inbox notes without YAML frontmatter still parse from header', () => {
  const raw = '# Fix Guide\n\n**To**: maw-rs · **From**: arra-oracle-v3 · 2026-07-05\n\nbody';
  const parsed = parseVaultMessage(raw, '2026-07-05_maw-rs-guide.md');
  expect(parsed.meta).toMatchObject({ from: 'arra-oracle-v3', to: 'maw-rs' });
  expect(parsed.ts).toBe(Date.parse('2026-07-05T00:00:00.000Z'));
});
