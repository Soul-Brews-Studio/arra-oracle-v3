import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { autoDeriveStructure, deriveProject } from '../auto-derive.ts';

describe('auto-derived bulk ingest structure', () => {
  test('derives mine project from directory name and concepts from folders plus keywords', () => {
    const rootDir = path.join('/tmp', 'Customer Notes');
    const derived = autoDeriveStructure({
      rootDir,
      sourceFile: 'mine/customer-notes/ops/runbooks/deploy.md',
      structurePath: 'ops/runbooks/deploy.md',
      title: 'Deploy runbook',
      content: 'Rollback rollback checklist for deploy failures and incident recovery.',
    });

    expect(derived.project).toBe('customer-notes');
    expect(derived.concepts).toEqual(expect.arrayContaining([
      'customer', 'notes', 'ops', 'runbooks', 'deploy', 'rollback', 'incident', 'recovery',
    ]));
    expect(derived.concepts.length).toBeLessThanOrEqual(20);
  });

  test('prefers project-first vault paths over generic source fallbacks', () => {
    const sourceFile = 'github.com/Soul-Brews-Studio/demo/ψ/learn/codex/vector-search.md';
    const derived = autoDeriveStructure({
      sourceFile,
      title: 'Vector Search',
      content: 'Latency latency ranking improves retrieval quality.',
    });

    expect(deriveProject({ sourceFile })).toBe('github.com/soul-brews-studio/demo');
    expect(derived.concepts).toEqual(expect.arrayContaining([
      'soul', 'brews', 'studio', 'demo', 'codex', 'vector', 'search', 'latency', 'ranking',
    ]));
  });
});
