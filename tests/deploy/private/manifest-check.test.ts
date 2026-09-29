import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, parseManifest } from '../../../deploy/private/arra-full-stack/manifest-check.ts';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('curated corpus manifest', () => {
  test('expands only listed markdown files with deterministic hashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-corpus-')); roots.push(root);
    mkdirSync(join(root, 'planning')); writeFileSync(join(root, 'README.md'), '# Arra');
    writeFileSync(join(root, 'planning', 'b.md'), 'B'); writeFileSync(join(root, 'planning', 'a.md'), 'A');
    const entries = buildManifest(parseManifest('repo|README.md\nrepo|planning'), { repo: root });

    expect(entries.map((entry) => entry.relativePath)).toEqual(['planning/a.md', 'planning/b.md', 'README.md']);
    expect(entries[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects generic instruction files and symlink escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-corpus-deny-')); roots.push(root);
    const outside = mkdtempSync(join(tmpdir(), 'arra-corpus-outside-')); roots.push(outside);
    writeFileSync(join(root, 'AGENTS.md'), 'generic'); writeFileSync(join(outside, 'secret.md'), 'secret');
    symlinkSync(join(outside, 'secret.md'), join(root, 'linked.md'));

    expect(() => buildManifest(parseManifest('repo|AGENTS.md'), { repo: root })).toThrow(/excluded/i);
    expect(() => buildManifest(parseManifest('repo|linked.md'), { repo: root })).toThrow(/symlink/i);
  });

  test('rejects ancestor symlink escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-manifest-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'arra-manifest-outside-'));
    mkdirSync(join(outside, 'notes'));
    writeFileSync(join(outside, 'notes', 'decision.md'), 'safe decision');
    symlinkSync(join(outside, 'notes'), join(root, 'linked-notes'));
    expect(() => buildManifest(parseManifest('repo|linked-notes/decision.md'), { repo: root })).toThrow(/symlink|escapes root/);
  });

  test('rejects secret-looking content even in an allowed Markdown file', () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-corpus-secret-')); roots.push(root);
    writeFileSync(join(root, 'notes.md'), 'OPENAI_API_KEY=' + 's'.repeat(32));
    expect(() => buildManifest(parseManifest('repo|notes.md'), { repo: root })).toThrow(/secret/i);
  });

  test('rejects Hermes and Codex bridge secrets too', () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-corpus-hermes-secret-')); roots.push(root);
    writeFileSync(join(root, 'notes.md'), 'HERMES_API_KEY=hermes-secret-value-123456789');
    expect(() => buildManifest(parseManifest('repo|notes.md'), { repo: root })).toThrow(/secret/i);
  });
});
