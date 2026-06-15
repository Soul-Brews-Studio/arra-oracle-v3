import { describe, expect, test } from 'bun:test';
import { LearnEntryList } from '../../../frontend/src/pages/LearnPage';
import type { LearnEntry } from '../../../frontend/src/types';
import { htmlFor } from '../_render';

const entry: LearnEntry = {
  id: 'learning-1',
  title: 'Learning UI',
  content: 'React page lists learn entries.',
  concepts: ['learn', 'ui'],
  sourceFile: 'ψ/memory/learnings/ui.md',
  createdAt: 1,
  updatedAt: 2,
};

describe('LearnEntryList', () => {
  test('shows entry title, content, concepts, and edit/delete actions', () => {
    const html = htmlFor(<LearnEntryList entries={[entry]} busy={false} onDelete={() => {}} onEdit={() => {}} />);
    expect(html).toContain('Learning UI');
    expect(html).toContain('React page lists learn entries.');
    expect(html).toContain('learn · ui');
    expect(html).toContain('Soft-delete');
    expect(html).toContain('Edit');
  });
});
