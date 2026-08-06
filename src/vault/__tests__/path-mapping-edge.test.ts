import { describe, expect, test } from 'bun:test';
import {
  ensureFrontmatterProject,
  mapFromVaultPath,
  mapToVaultPath,
  normalizeVaultRelativePath,
} from '../path-mapping.ts';

const project = 'github.com/soul-brews-studio/oracle-v2';

describe('vault path mapping edge cases', () => {
  test('normalizes backslashes before applying project mapping', () => {
    expect(mapToVaultPath('ψ\\memory\\learnings\\edge.md', project))
      .toBe(`${project}/ψ/memory/learnings/edge.md`);
    expect(mapFromVaultPath(`${project}\\ψ\\memory\\learnings\\edge.md`, project))
      .toBe('ψ/memory/learnings/edge.md');
  });

  test('keeps universal categories flat after normalization', () => {
    expect(mapToVaultPath('ψ\\memory\\resonance\\voice.md', project))
      .toBe('ψ/memory/resonance/voice.md');
  });

  test('rejects absolute and parent-directory vault paths', () => {
    expect(() => normalizeVaultRelativePath('/tmp/escape.md')).toThrow(/relative path/);
    expect(() => normalizeVaultRelativePath('ψ/memory/../escape.md')).toThrow(/parent directory/);
    expect(() => mapToVaultPath('ψ/memory/learnings/file.md', '../evil')).toThrow(/parent directory/);
  });

  test('sanitizes project frontmatter onto one YAML scalar line', () => {
    const content = '---\ntags: [edge]\n---\n\n# Body';
    const tagged = ensureFrontmatterProject(content, 'github.com/acme/repo\nsource: evil');
    const frontmatter = tagged.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';

    expect(frontmatter.match(/^project:/gm)).toHaveLength(1);
    expect(frontmatter.match(/^source:/gm)).toBeNull();
    expect(frontmatter).toContain('project: "github.com/acme/repo source: evil"');
  });
});
