import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const repo = 'https://github.com/Soul-Brews-Studio/arra-oracle-v3';
const buttonImage = 'https://vercel.com/button';
const buttonBase = 'https://vercel.com/new/clone';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function extractVercelButton(markdown: string): URL {
  const match = markdown.match(/\[!\[Deploy with Vercel\]\(https:\/\/vercel\.com\/button\)\]\(([^)]+)\)/);
  expect(match).not.toBeNull();
  return new URL(match![1]);
}

describe('Vercel deploy docs', () => {
  test('README exposes one Deploy with Vercel button', () => {
    const readme = read('README.md');
    const matches = readme.match(/\[!\[Deploy with Vercel\]\([^)]+\)\]\([^)]+\)/g) ?? [];
    expect(matches).toHaveLength(1);

    const url = extractVercelButton(readme);
    expect(url.origin + url.pathname).toBe(buttonBase);
    expect(url.searchParams.get('repository-url')).toBe(repo);
    expect(url.searchParams.get('project-name')).toBe('arra-oracle-studio');
    expect(url.searchParams.get('repository-name')).toBe('arra-oracle-studio');
    expect(url.searchParams.get('env')).toBe('ORACLE_URL');
    expect(readme).toContain(`[![Deploy with Vercel](${buttonImage})]`);
    expect(readme).toContain('docs/deploy-vercel.md');
  });

  test('deploy guide documents Vercel config and env handoff', () => {
    const guide = read('docs/deploy-vercel.md');

    expect(guide).toContain('# Deploy Oracle Studio on Vercel');
    expect(guide).toContain('`ORACLE_URL`');
    expect(guide).toContain('cd frontend && bun run build');
    expect(guide).toContain('frontend/dist');
    expect(guide).toContain('`/api/:path*` rewrite');
    expect(guide).toContain('https://vercel.com/docs/deploy-button');
  });

  test('docs index links the Vercel deploy guide', () => {
    const index = read('docs/README.md');

    expect(index).toContain('[deploy-vercel.md](./deploy-vercel.md)');
  });
});
