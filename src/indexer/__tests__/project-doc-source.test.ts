import { describe, expect, test } from 'bun:test';
import {
  isPsiProjectsSource,
  parsePsiProjectFile,
  projectIdFromProjectsSource,
} from '../project-doc-source.ts';

describe('ψ/projects source contract', () => {
  test('derives canonical project id from nested project paths', () => {
    expect(projectIdFromProjectsSource('ψ/projects/oracle/context.md')).toBe('oracle');
    expect(projectIdFromProjectsSource('ψ/projects/client-alpha/research/note.md')).toBe('client-alpha');
  });

  test('indexes root README as universal learning documentation', () => {
    const docs = parsePsiProjectFile('ψ/projects/README.md', '# Projects\n\nCanonical project contract.');
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((doc) => doc.type === 'learning')).toBe(true);
    expect(docs.every((doc) => doc.project === null)).toBe(true);
    expect(docs.every((doc) => doc.source_file === 'ψ/projects/README.md')).toBe(true);
  });

  test('indexes valid project context with exact project metadata', () => {
    const docs = parsePsiProjectFile(
      'ψ/projects/oracle/context.md',
      '# Oracle\n\nUnique project context phrase.'
    );
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((doc) => doc.type === 'learning')).toBe(true);
    expect(docs.every((doc) => doc.project === 'oracle')).toBe(true);
    expect(docs.every((doc) => doc.source_file === 'ψ/projects/oracle/context.md')).toBe(true);
    expect(docs.every((doc) => doc.id.startsWith('learning_psi_project_'))).toBe(true);
  });

  test('rejects invalid or non-project paths instead of universalizing them', () => {
    expect(parsePsiProjectFile('ψ/projects/Bad_ID/context.md', '# Bad')).toEqual([]);
    expect(parsePsiProjectFile('ψ/projects/orphan.md', '# Orphan')).toEqual([]);
    expect(parsePsiProjectFile('ψ/inbox/context.md', '# Other')).toEqual([]);
    expect(isPsiProjectsSource('ψ/inbox/context.md')).toBe(false);
  });

  test('path-namespaced ids differ for identical text in different projects', () => {
    const content = '# Shared\n\nIdentical text is still project-specific.';
    const left = parsePsiProjectFile('ψ/projects/alpha/context.md', content);
    const right = parsePsiProjectFile('ψ/projects/beta/context.md', content);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(left[0]?.id).not.toBe(right[0]?.id);
    expect(left[0]?.project).toBe('alpha');
    expect(right[0]?.project).toBe('beta');
  });
});
