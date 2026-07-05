import { and, eq } from 'drizzle-orm';
import {
  createDatabase,
  learnLog,
  menuItems,
  oracleDocuments,
  type DatabaseConnection,
} from '../../db/index.ts';

type Writer = (message: string) => void;
type MenuInsert = typeof menuItems.$inferInsert;
type DocumentInsert = typeof oracleDocuments.$inferInsert;
type LearnLogInsert = typeof learnLog.$inferInsert;

interface SeedSample {
  document: Omit<DocumentInsert, 'createdAt' | 'updatedAt' | 'indexedAt'>;
  log: Omit<LearnLogInsert, 'createdAt'>;
}

export interface SeedRunResult {
  menu: { inserted: number; updated: number; skipped: number };
  learn: { documentsInserted: number; documentsUpdated: number; logsInserted: number; logsUpdated: number };
}

export interface SeedOptions {
  connection?: DatabaseConnection;
  now?: () => number;
  stdout?: Writer;
  stderr?: Writer;
}

export const SAMPLE_MENU_ITEMS: Array<Omit<MenuInsert, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    path: '/dev/vector-search',
    label: 'Vector Search Lab',
    groupKey: 'development',
    position: 910,
    enabled: true,
    access: 'public',
    source: 'seed',
    icon: 'search',
    scope: 'main',
  },
  {
    path: '/dev/mcp-tools',
    label: 'MCP Tool Browser',
    groupKey: 'development',
    position: 920,
    enabled: true,
    access: 'public',
    source: 'seed',
    icon: 'plug',
    scope: 'main',
  },
];

export const SAMPLE_LEARN_ENTRIES: SeedSample[] = [
  {
    document: {
      id: 'seed-learning-menu-aggregation',
      type: 'learning',
      sourceFile: 'seed://learn/menu-aggregation.md',
      concepts: JSON.stringify(['menu', 'unified-plugin', 'development-seed']),
      origin: 'seed',
      project: 'github.com/soul-brews-studio/arra-oracle-v3',
      createdBy: 'seed',
    },
    log: {
      documentId: 'seed-learning-menu-aggregation',
      patternPreview: 'Unified plugin manifests can enrich the studio menu alongside DB rows.',
      source: 'seed',
      concepts: JSON.stringify(['menu', 'unified-plugin']),
      project: 'github.com/soul-brews-studio/arra-oracle-v3',
    },
  },
  {
    document: {
      id: 'seed-learning-vector-mcp',
      type: 'learning',
      sourceFile: 'seed://learn/vector-mcp.md',
      concepts: JSON.stringify(['vector-search', 'mcp-tools', 'development-seed']),
      origin: 'seed',
      project: 'github.com/soul-brews-studio/arra-oracle-v3',
      createdBy: 'seed',
    },
    log: {
      documentId: 'seed-learning-vector-mcp',
      patternPreview: 'Vector search and MCP browser samples keep fresh dev databases navigable.',
      source: 'seed',
      concepts: JSON.stringify(['vector-search', 'mcp-tools']),
      project: 'github.com/soul-brews-studio/arra-oracle-v3',
    },
  },
];

export function seedDevelopmentData(connection: DatabaseConnection, options: SeedOptions = {}): SeedRunResult {
  const nowMs = options.now?.() ?? Date.now();
  const nowDate = new Date(nowMs);
  return {
    menu: seedMenuItems(connection, nowDate),
    learn: seedLearnEntries(connection, nowMs),
  };
}

export async function seedCommand(args: string[], options: SeedOptions = {}): Promise<number> {
  const stdout = options.stdout ?? writeStdout;
  const stderr = options.stderr ?? writeStderr;
  if (args.includes('--help') || args.includes('-h')) {
    printHelp(stdout);
    return 0;
  }
  if (args.length > 0) {
    stderr(`unknown seed option: ${args[0]}\n`);
    printHelp(stderr);
    return 1;
  }

  let ownedConnection: DatabaseConnection | undefined;
  const connection = options.connection ?? (ownedConnection = createDatabase());
  try {
    const result = seedDevelopmentData(connection, options);
    stdout(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    ownedConnection?.storage.close();
  }
}

function seedMenuItems(connection: DatabaseConnection, now: Date): SeedRunResult['menu'] {
  const result = { inserted: 0, updated: 0, skipped: 0 };
  for (const item of SAMPLE_MENU_ITEMS) {
    const existing = connection.db.select().from(menuItems).where(eq(menuItems.path, item.path)).get();
    const values = { ...item, updatedAt: now };
    if (existing && existing.source !== 'seed') {
      result.skipped += 1;
    } else if (existing) {
      connection.db.update(menuItems).set(values).where(eq(menuItems.id, existing.id)).run();
      result.updated += 1;
    } else {
      connection.db.insert(menuItems).values({ ...values, createdAt: now }).run();
      result.inserted += 1;
    }
  }
  return result;
}

function seedLearnEntries(connection: DatabaseConnection, now: number): SeedRunResult['learn'] {
  const result = { documentsInserted: 0, documentsUpdated: 0, logsInserted: 0, logsUpdated: 0 };
  for (const sample of SAMPLE_LEARN_ENTRIES) {
    const document = { ...sample.document, createdAt: now, updatedAt: now, indexedAt: now };
    const existingDoc = connection.db.select({ id: oracleDocuments.id })
      .from(oracleDocuments).where(eq(oracleDocuments.id, document.id)).get();
    if (existingDoc) {
      connection.db.update(oracleDocuments).set(document).where(eq(oracleDocuments.id, document.id)).run();
      result.documentsUpdated += 1;
    } else {
      connection.db.insert(oracleDocuments).values(document).run();
      result.documentsInserted += 1;
    }

    const existingLog = connection.db.select({ id: learnLog.id }).from(learnLog)
      .where(and(eq(learnLog.documentId, sample.log.documentId), eq(learnLog.source, 'seed'))).get();
    if (existingLog) {
      connection.db.update(learnLog).set({ ...sample.log, createdAt: now }).where(eq(learnLog.id, existingLog.id)).run();
      result.logsUpdated += 1;
    } else {
      connection.db.insert(learnLog).values({ ...sample.log, createdAt: now }).run();
      result.logsInserted += 1;
    }
  }
  return result;
}

function printHelp(write: Writer): void {
  write([
    'arra-cli seed',
    '',
    'Populates the development database with sample menu items and learn entries.',
    '',
    'Flags:',
    '  --help, -h          show this help',
    '',
  ].join('\n'));
}

function writeStdout(message: string): void {
  process.stdout.write(message);
}

function writeStderr(message: string): void {
  process.stderr.write(message);
}
