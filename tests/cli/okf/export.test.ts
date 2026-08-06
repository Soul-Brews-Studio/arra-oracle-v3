import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportOkfBundle, parseOkfArgs } from '../../../src/cli/okf/index.ts';
import { splitMarkdown } from '../../../src/cli/okf/frontmatter.ts';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const BIN_ENTRY = path.join(REPO_ROOT, 'bin/arra.ts');

let tempDir = '';

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function tmp(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-okf-'));
  return tempDir;
}

function writeFixture(root: string): { sourceFile: string; original: string } {
  const sourceDir = path.join(root, 'ψ');
  fs.mkdirSync(path.join(sourceDir, 'learnings'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'plans'), { recursive: true });
  const original = [
    '---',
    'pattern: OKF export keeps vault files read-only while adding bundle metadata.',
    'date: 2026-07-06',
    'source: https://example.test/source',
    'concepts: [okf, vault]',
    'custom_field: keep-me',
    '---',
    '',
    '# Alpha Learning',
    '',
    'See [[beta-plan|the beta plan]] and [[missing-note]].',
    '',
  ].join('\n');
  const sourceFile = path.join(sourceDir, 'learnings', 'alpha.md');
  fs.writeFileSync(sourceFile, original, 'utf8');
  fs.writeFileSync(
    path.join(sourceDir, 'plans', 'beta-plan.md'),
    '# Beta Plan\n\nFirst paragraph describes the beta plan. Second sentence stays body text.\n',
    'utf8',
  );
  return { sourceFile, original };
}

function writeTypeFixture(root: string): string {
  const sourceDir = path.join(root, 'ψ');
  const fixtures = [
    ['learnings/alpha.md', '# Alpha\n\nLearning body.'],
    ['retrospectives/review.md', '# Review\n\nRetrospective body.'],
    ['plans/roadmap.md', '# Roadmap\n\nPlan body.'],
    ['handoff/shift.md', '# Shift\n\nHandoff body.'],
    ['inbox/message.md', '# Message\n\nInbox body.'],
    ['outbox/note.md', '# Note\n\nOutbox body.'],
    ['misc/loose.md', '# Loose\n\nDefault note body.'],
  ];
  for (const [relPath, content] of fixtures) {
    const target = path.join(sourceDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return sourceDir;
}

describe('OKF export mapping', () => {
  test('parses export flags and rejects bad input', () => {
    expect(parseOkfArgs(['export', '--source', 'ψ', '--out=/tmp/out']).export).toEqual({
      sourceDir: 'ψ',
      outDir: '/tmp/out',
    });
    expect(parseOkfArgs(['--help']).help).toBe(true);
    expect(() => parseOkfArgs(['export', '--bad'])).toThrow('unknown okf option: --bad');
    expect(() => parseOkfArgs(['mine'])).toThrow('okf requires subcommand: export');
  });

  test('exports a fixture vault without touching source files', () => {
    const root = tmp();
    const outDir = path.join(root, 'bundle');
    const { sourceFile, original } = writeFixture(root);
    const beforeStat = fs.statSync(sourceFile).mtimeMs;

    const result = exportOkfBundle({ sourceDir: path.join(root, 'ψ'), outDir });

    expect(result.documents).toBe(2);
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(original);
    expect(fs.statSync(sourceFile).mtimeMs).toBe(beforeStat);

    const alpha = splitMarkdown(fs.readFileSync(path.join(outDir, 'learnings', 'alpha.md'), 'utf8'));
    expect(alpha.frontmatter.type).toBe('Learning');
    expect(alpha.frontmatter.title).toBe('Alpha Learning');
    expect(alpha.frontmatter.description).toBe('OKF export keeps vault files read-only while adding bundle metadata.');
    expect(alpha.frontmatter.resource).toBe('https://example.test/source');
    expect(alpha.frontmatter.tags).toEqual(['okf', 'vault']);
    expect(alpha.frontmatter.timestamp).toBe('2026-07-06T00:00:00.000Z');
    expect(alpha.frontmatter.custom_field).toBe('keep-me');
    expect(alpha.body).toContain('[the beta plan](/plans/beta-plan.md)');
    expect(alpha.body).toContain('[[missing-note]]');

    const beta = splitMarkdown(fs.readFileSync(path.join(outDir, 'plans', 'beta-plan.md'), 'utf8'));
    expect(beta.frontmatter.type).toBe('Plan');
    expect(beta.frontmatter.title).toBe('Beta Plan');
    expect(beta.frontmatter.description).toBe('First paragraph describes the beta plan.');

    const rootIndex = fs.readFileSync(path.join(outDir, 'index.md'), 'utf8');
    expect(rootIndex).toContain('okf_version: "0.1"');
    expect(rootIndex).toContain('[Learnings](learnings/index.md)');

    const log = fs.readFileSync(path.join(outDir, 'log.md'), 'utf8');
    expect(log).toContain('## 2026-07-06');
    expect(log).toContain('[Alpha Learning](/learnings/alpha.md)');
  });

  test('maps every issue-specified path segment to an OKF type', () => {
    const root = tmp();
    const outDir = path.join(root, 'bundle');
    const sourceDir = writeTypeFixture(root);

    const result = exportOkfBundle({ sourceDir, outDir });

    expect(result.documents).toBe(7);
    const expectations = {
      'learnings/alpha.md': 'Learning',
      'retrospectives/review.md': 'Retrospective',
      'plans/roadmap.md': 'Plan',
      'handoff/shift.md': 'Handoff',
      'inbox/message.md': 'Message',
      'outbox/note.md': 'Note',
      'misc/loose.md': 'Note',
    };
    for (const [relPath, type] of Object.entries(expectations)) {
      const exported = splitMarkdown(fs.readFileSync(path.join(outDir, relPath), 'utf8'));
      expect(exported.frontmatter.type).toBe(type);
      expect(exported.frontmatter.title).toBeDefined();
      expect(exported.frontmatter.description).toBeDefined();
      expect(exported.frontmatter.timestamp).toBeDefined();
    }
  });
});

describe('arra okf CLI seam', () => {
  test('runs okf export through bin/arra.ts', async () => {
    const root = tmp();
    const outDir = path.join(root, 'bundle');
    writeFixture(root);
    const proc = Bun.spawn(['bun', 'run', BIN_ENTRY, 'okf', 'export', '--source', path.join(root, 'ψ'), '--out', outDir], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ORACLE_DATA_DIR: path.join(root, 'data') },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Exported 2 OKF documents');
    expect(fs.existsSync(path.join(outDir, 'index.md'))).toBe(true);
  });
});
