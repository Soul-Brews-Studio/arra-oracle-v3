import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { findDuplicateLearning } from '../dedup.ts';
import { learningContentHash } from '../markdown.ts';

const SCHEMA = `
CREATE TABLE oracle_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_file TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  project TEXT,
  superseded_at INTEGER
);
CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
`;

function database(): Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA);
  return sqlite;
}

function seed(sqlite: Database, input: {
  id: string;
  pattern: string;
  tenantId?: string;
  project?: string | null;
  supersededAt?: number | null;
}): void {
  sqlite.prepare(`
    INSERT INTO oracle_documents (id, type, source_file, tenant_id, project, superseded_at)
    VALUES (?, 'learning', ?, ?, ?, ?)
  `).run(
    input.id,
    `ψ/memory/learnings/${input.id}.md`,
    input.tenantId ?? 'default',
    input.project ?? null,
    input.supersededAt ?? null,
  );
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    input.id,
    `---\ntitle: Existing\n---\n\n# Existing\n\n${input.pattern}\n\n---\n*Added via Oracle Learn*\n`,
    '',
  );
}

describe('oracle_learn duplicate gate', () => {
  test('matches normalized active learning content in the same tenant and project', () => {
    const sqlite = database();
    seed(sqlite, {
      id: 'learning_existing',
      pattern: 'Write once, then reuse.\nKeep the original identity.',
      project: 'github.com/acme/repo',
    });

    expect(findDuplicateLearning(sqlite, {
      pattern: '  Write once, then reuse.   Keep the original identity.  ',
      tenantId: 'default',
      project: 'github.com/acme/repo',
    })).toEqual({
      id: 'learning_existing',
      sourceFile: 'ψ/memory/learnings/learning_existing.md',
    });
    sqlite.close();
  });

  test('does not treat hash-shaped body text as frontmatter identity', () => {
    const sqlite = database();
    const target = 'A different learning';
    seed(sqlite, {
      id: 'hash_in_body',
      pattern: `Documentation example: hash: ${learningContentHash(target)}`,
    });

    expect(findDuplicateLearning(sqlite, {
      pattern: target,
      tenantId: 'default',
      project: null,
    })).toBeNull();
    sqlite.close();
  });

  test('does not cross tenant, project, or superseded boundaries', () => {
    const sqlite = database();
    seed(sqlite, { id: 'tenant_b', pattern: 'Scoped learning', tenantId: 'tenant-b' });
    seed(sqlite, { id: 'project_b', pattern: 'Scoped learning', project: 'github.com/acme/b' });
    seed(sqlite, { id: 'superseded', pattern: 'Scoped learning', supersededAt: Date.now() });

    expect(findDuplicateLearning(sqlite, {
      pattern: 'Scoped learning',
      tenantId: 'default',
      project: null,
    })).toBeNull();
    sqlite.close();
  });
});
