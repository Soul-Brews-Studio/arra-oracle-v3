import { describe, expect, test } from 'bun:test';

const { renderRescueFile } = await import('../orphan-rescue-shared.ts');
const { parseLearningFile } = await import('../parser.ts');

describe('recovery envelope parser branch', () => {
  test('ordinary ## learning behavior unchanged without marker', () => {
    const docs = parseLearningFile('x.md', '---\narra_id: base\n---\n\nintro\n\n## Section A\n\nbody a\n\n## Section B\n\nbody b\n');
    expect(docs.length).toBe(2);
    expect(docs[0].id).toBe('base_1');
  });

  test('recovery-marked leading-## body stays one exact opaque doc', () => {
    const body = '## Looks like a section\n\nbut must stay opaque\n\n## Another';
    const rendered = renderRescueFile({
      newId: 'x-rescue', type: 'learning', project: 'github.com/ttt3p/nntn', concepts: ['alpha'],
      createdAt: 1000, updatedAt: 2000, oldId: 'x', oldSourceFile: 'ψ/memory/learnings/x.md', body,
    });
    const docs = parseLearningFile('x.md', rendered, 'dest.md');
    expect(docs.length).toBe(1);
    expect(docs[0].content).toBe(body);
    expect(docs[0].id).toBe('x-rescue');
    expect(docs[0].type).toBe('learning');
  });

  test('retro type survives the learning-path envelope', () => {
    const rendered = renderRescueFile({
      newId: 'r-rescue', type: 'retro', project: 'github.com/ttt3p/nntn', concepts: [],
      createdAt: 1000, updatedAt: 2000, oldId: 'r', oldSourceFile: 'ψ/memory/retrospectives/r.md', body: 'retro body',
    });
    const docs = parseLearningFile('r.md', rendered, 'dest.md');
    expect(docs.length).toBe(1);
    expect(docs[0].type).toBe('retro');
    expect(docs[0].content).toBe('retro body');
  });
});
