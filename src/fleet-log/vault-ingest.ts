import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { createDatabase, type DatabaseConnection } from '../db/index.ts';
import { fleetIngestCursor, fleetMessages } from '../db/schema.ts';

const SOURCE = 'arra-oracle-v3';
const CHANNEL = 'vault';
const CURSOR_ID = `vault:${SOURCE}`;
const THREAD_WINDOW_MS = 30 * 60 * 1000;

type Meta = { from: string; to: string; timestamp: string; read?: string };

type FileEntry = { path: string; relativePath: string; mtimeMs: number };

export type VaultIngestSummary = {
  source: string;
  cursorId: string;
  repoRoot: string;
  scanned: number;
  skipped: number;
  processed: number;
  rowCount: number;
  lastCursor: string;
};

export type ParsedVaultMessage = {
  meta: Meta;
  text: string;
  raw: string;
  ts: number;
};

export function parseVaultMessage(raw: string, fileName = ''): ParsedVaultMessage {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (frontmatter) {
    const meta = parseFrontmatter(frontmatter[1]);
    return { meta, text: raw.slice(frontmatter[0].length), raw, ts: parseTimestamp(meta.timestamp) };
  }
  const meta = parseLegacyHeader(raw, fileName);
  return { meta, text: raw, raw, ts: parseTimestamp(meta.timestamp) };
}

function parseFrontmatter(block: string): Meta {
  const fields = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  const from = fields.get('from');
  const to = fields.get('to');
  const timestamp = fields.get('timestamp');
  if (!from || !to || !timestamp) throw new Error('Missing vault frontmatter from/to/timestamp');
  return { from, to, timestamp, read: fields.get('read') };
}

function parseLegacyHeader(raw: string, fileName: string): Meta {
  const head = raw.slice(0, 600);
  const from = head.match(/\*\*From\*\*:\s*([^·\n]+)/i)?.[1].trim();
  const to = head.match(/\*\*To\*\*:\s*([^·\n]+)/i)?.[1].trim();
  const date = head.match(/(20\d{2}-\d{2}-\d{2})(?:T[\d:.]+Z)?/)?.[0]
    ?? fileName.match(/20\d{2}-\d{2}-\d{2}/)?.[0];
  if (!from || !to || !date) throw new Error('Missing vault legacy from/to/date');
  const timestamp = date.includes('T') ? date : `${date}T00:00:00.000Z`;
  return { from, to, timestamp, read: 'false' };
}

function parseTimestamp(value: string): number {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) throw new Error(`Invalid vault timestamp: ${value}`);
  return ts;
}

// Approximate only: vault messages have no real thread id, so the key groups
// sorted participants by 30-minute windows; it is not source-of-truth threading.
export function vaultThreadKey(fromId: string, toId: string, ts: number): string {
  const participants = [fromId, toId].sort().join('|');
  const bucket = Math.floor(ts / THREAD_WINDOW_MS) * THREAD_WINDOW_MS;
  return `${CHANNEL}:${participants}:${bucket}`;
}

export function listVaultInbox(repoRoot: string): FileEntry[] {
  const inbox = path.join(repoRoot, 'ψ', 'inbox');
  if (!fs.existsSync(inbox)) throw new Error(`Vault inbox not found: ${inbox}`);
  return fs.readdirSync(inbox, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const fullPath = path.join(inbox, entry.name);
      const relativePath = path.relative(repoRoot, fullPath).split(path.sep).join('/');
      return { path: fullPath, relativePath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.relativePath.localeCompare(b.relativePath));
}

export function ingestVaultInbox(options: {
  repoRoot?: string;
  dbPath?: string;
  connection?: DatabaseConnection;
  now?: () => number;
} = {}): VaultIngestSummary {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const now = options.now ?? Date.now;
  const owned = options.connection ? undefined : createDatabase(options.dbPath);
  const connection = options.connection ?? owned!;
  const startedAt = now();

  try {
    markCursor(connection, { status: 'running', lastRunAt: startedAt, error: null });
    const cursor = connection.db.select().from(fleetIngestCursor)
      .where(eq(fleetIngestCursor.id, CURSOR_ID)).get();
    const parsedCursor = Number(cursor?.lastCursor ?? 0);
    const lastSeen = Number.isFinite(parsedCursor) ? parsedCursor : 0;
    const files = listVaultInbox(repoRoot);
    const pending = files.filter((file) => !Number.isFinite(lastSeen) || file.mtimeMs > lastSeen);

    for (const file of pending) ingestFile(connection, repoRoot, file, now());

    const latest = pending.reduce((max, file) => Math.max(max, file.mtimeMs), lastSeen);
    markCursor(connection, { status: 'idle', lastRunAt: now(), lastCursor: String(latest), error: null });
    return {
      source: SOURCE,
      cursorId: CURSOR_ID,
      repoRoot,
      scanned: files.length,
      skipped: files.length - pending.length,
      processed: pending.length,
      rowCount: countVaultRows(connection),
      lastCursor: String(latest),
    };
  } catch (error) {
    markCursor(connection, { status: 'error', lastRunAt: now(), error: errorMessage(error) });
    throw error;
  } finally {
    owned?.storage.close();
  }
}

function ingestFile(connection: DatabaseConnection, repoRoot: string, file: FileEntry, ingestedAt: number): void {
  const raw = fs.readFileSync(file.path, 'utf8');
  const parsed = parseVaultMessage(raw, path.basename(file.path));
  connection.db.insert(fleetMessages).values({
    id: `${CHANNEL}:${SOURCE}:${file.relativePath}`,
    tenantId: 'default',
    channel: CHANNEL,
    source: SOURCE,
    direction: 'inbound',
    fromId: parsed.meta.from,
    toId: parsed.meta.to,
    threadKey: vaultThreadKey(parsed.meta.from, parsed.meta.to, parsed.ts),
    text: parsed.text,
    raw: parsed.raw,
    rawPath: path.relative(repoRoot, file.path).split(path.sep).join('/'),
    ts: parsed.ts,
    ingestedAt,
  }).onConflictDoUpdate({
    target: fleetMessages.id,
    set: {
      tenantId: 'default',
      channel: CHANNEL,
      source: SOURCE,
      direction: 'inbound',
      fromId: parsed.meta.from,
      toId: parsed.meta.to,
      threadKey: vaultThreadKey(parsed.meta.from, parsed.meta.to, parsed.ts),
      text: parsed.text,
      raw: parsed.raw,
      rawPath: file.relativePath,
      ts: parsed.ts,
      ingestedAt,
    },
  }).run();
}

function markCursor(connection: DatabaseConnection, values: {
  status: string;
  lastRunAt: number;
  lastCursor?: string;
  error: string | null;
}): void {
  connection.db.insert(fleetIngestCursor).values({ id: CURSOR_ID, ...values })
    .onConflictDoUpdate({ target: fleetIngestCursor.id, set: values })
    .run();
}

function countVaultRows(connection: DatabaseConnection): number {
  const row = connection.sqlite.query<{ count: number }, []>(
    "SELECT COUNT(*) AS count FROM fleet_messages WHERE channel = 'vault' AND source = 'arra-oracle-v3'",
  ).get();
  return row?.count ?? 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
