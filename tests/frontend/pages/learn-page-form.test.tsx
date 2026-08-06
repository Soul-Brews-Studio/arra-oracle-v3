import { describe, expect, test } from 'bun:test';
import { LearnPage } from '../../../frontend/src/pages/LearnPage';
import { htmlFor } from '../_render';

const client = {
  learn: async () => ({ items: [], total: 0 }),
  createLearn: async () => ({ success: true, id: 'learning-1', file: 'ψ/memory/learnings/one.md' }),
  updateLearn: async () => ({ id: 'learning-1' } as never),
  deleteLearn: async () => ({ id: 'learning-1', deleted: 'soft' as const, supersededAt: 1 }),
};

describe('LearnPage form', () => {
  test('renders the learn CRUD form and API hint', () => {
    const html = htmlFor(<LearnPage client={client} />);
    expect(html).toContain('Learn entries');
    expect(html).toContain('aria-label="Learn entry form"');
    expect(html).toContain('Learning title');
    expect(html).toContain('/api/v1/learn');
  });
});
