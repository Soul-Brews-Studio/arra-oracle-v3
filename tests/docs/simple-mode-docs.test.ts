import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readme = readFileSync('README.md', 'utf8');
const docsIndex = readFileSync('docs/README.md', 'utf8');
const simpleSpec = readFileSync('docs/SIMPLE-MODE-SPEC.md', 'utf8');
const recap = readFileSync('src/tools/recap.ts', 'utf8');

describe('Simple Mode docs for non-dev users', () => {
  test('README and wake-up recap point users to /simple', () => {
    expect(readme).toContain('http://localhost:47778/simple');
    expect(readme).toContain('Simple Mode');
    expect(recap).toContain('http://localhost:47778/simple');
  });

  test('docs index links the Simple Mode spec', () => {
    expect(docsIndex).toContain('[SIMPLE-MODE-SPEC.md](./SIMPLE-MODE-SPEC.md)');
  });

  test('Simple Mode spec names the six never-silent health states', () => {
    for (const label of [
      'Awake and remembering',
      'Starting up…',
      'Running, but search is limited',
      'Running, but memory storage needs help',
      'Running, but a plugin needs attention',
      "Can't reach your Oracle",
    ]) expect(simpleSpec).toContain(label);
    expect(simpleSpec).toContain('Poll `GET /api/health` every 10 seconds');
    expect(simpleSpec).toContain('Refs #2440');
  });
});
