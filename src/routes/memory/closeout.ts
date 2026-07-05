import type { MemoryInput } from './store.ts';

export type MemoryCloseoutInput = {
  summary: string;
  title?: string;
  next?: string;
  blockers?: string[];
  artifacts?: string[];
  tags?: string[];
};

export function formatCloseoutMemory(input: MemoryCloseoutInput, now = new Date()): MemoryInput {
  const summary = input.summary.trim();
  if (!summary) throw new Error('closeout summary is required');

  const lines = ['## Summary', summary];
  addOptionalSection(lines, 'Next boot action', input.next);
  addListSection(lines, 'Blockers', input.blockers);
  addListSection(lines, 'Artifacts', input.artifacts);

  return {
    title: input.title?.trim() || `Session close-out ${now.toISOString().slice(0, 10)}`,
    content: lines.join('\n\n'),
    tags: uniqueTags(['challenge-2', 'closeout', 'morning-tape', ...(input.tags ?? [])]),
    source: 'challenge-2-closeout',
  };
}

function addOptionalSection(lines: string[], title: string, value?: string): void {
  const clean = value?.trim();
  if (clean) lines.push(`## ${title}`, clean);
}

function addListSection(lines: string[], title: string, values: string[] = []): void {
  const clean = values.map((value) => value.trim()).filter(Boolean);
  if (clean.length) lines.push(`## ${title}`, clean.map((value) => `- ${value}`).join('\n'));
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
