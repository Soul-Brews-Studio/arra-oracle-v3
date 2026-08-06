import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const morningTape = readFileSync('MORNING-TAPE.md', 'utf8');
const template = readFileSync('docs/MORNING-TAPE-TEMPLATE.md', 'utf8');

function words(markdown: string): number {
  return markdown.trim().split(/\s+/).filter(Boolean).length;
}

describe('Challenge 2 morning tape contract', () => {
  test('repo morning tape stays operational and portable', () => {
    for (const heading of [
      '## 0. Wake protocol',
      '## 1. Current operating identity',
      '## 2. Oracle heartbeat',
      '## 3. Memory system map',
      '## 4. Two-minute recovery drill',
      '## 5. Default task loop',
      '## 6. When blocked',
      '## 7. Reflection from Challenge 2',
    ]) expect(morningTape).toContain(heading);

    expect(words(morningTape)).toBeLessThanOrEqual(650);
    expect(morningTape).not.toMatch(/agents\/1-codex-\d+`/);
    expect(morningTape).toContain('docs/MORNING-TAPE-TEMPLATE.md');
  });

  test('template captures the reusable Challenge 2 structure', () => {
    for (const phrase of [
      'Boot self-check',
      'Wake protocol',
      'Operating identity',
      'Safety rails',
      'Memory map',
      'Two-minute recovery drill',
      'Default task loop',
      'Blocked format',
      'Reflection',
    ]) expect(template).toContain(phrase);

    expect(words(template)).toBeLessThanOrEqual(750);
    expect(template).toContain('blocked: <exact blocker>; tried <alternative>');
  });
});
