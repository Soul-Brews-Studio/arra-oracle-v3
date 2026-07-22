import { describe, expect, test } from 'bun:test';

describe('project authority seam', () => {
  test('distinguishes explicit string, null, and omitted authority', async () => {
    const { resolveProjectAuthority } = await import('../authority.ts');
    expect(resolveProjectAuthority('GitHub.com/Acme/Widgets', { explicit: true })).toEqual({ project: 'github.com/acme/widgets' });
    expect(resolveProjectAuthority(null, { explicit: true })).toEqual({ project: null });
    expect(resolveProjectAuthority(undefined, { explicit: false })).toEqual({ project: null });
    expect(resolveProjectAuthority(undefined, {
      explicit: false, trustedCallerCwd: true, detectedProject: 'github.com/acme/widgets',
    })).toEqual({ project: 'github.com/acme/widgets' });
  });

  test('rejects malformed explicit values without fallback', async () => {
    const { resolveProjectAuthority } = await import('../authority.ts');
    for (const value of [
      '', 'owner/repo', 'https://github.com/acme/widgets', 'github.com/acme/widgets/extra',
      'github.com/acme/.', 'github.com/acme/..', 'github.com/acme/%2e%2e',
      'github.com/acme\\widgets', 'github.com/acme/widgets\nother', 'unknown', '_universal',
      'github.com/acme/widget space', 'github.com/acme/widget?x', 'github.com/acme/widget#x',
      'github.com/acme/widget:tag', 'github.com/acme/widget@x', 'github.com/acme/widgets.git',
      'github.com/acme/widget🔥', `github.com/${'a'.repeat(101)}/widgets`,
    ]) {
      expect(resolveProjectAuthority(value, {
        explicit: true, trustedCallerCwd: true, detectedProject: 'github.com/fallback/blocked',
      })).toEqual({ invalid: true });
    }
  });
});
