import type { MemoryRecord } from './store.ts';

export type MorningTapeSection = {
  title: string;
  bullets: string[];
};

export type MorningTape = {
  generatedAt: string;
  readTimeMinutes: number;
  memoryCount: number;
  sections: MorningTapeSection[];
  markdown: string;
};

const DEFAULT_READ_TIME_MINUTES = 2;

export function buildMorningTape(memories: MemoryRecord[], generatedAt = new Date()): MorningTape {
  const sections = [
    {
      title: 'Wake protocol',
      bullets: [
        'Read this tape before coding or answering status questions.',
        'Recover the current mission from saved memories, then inspect git state.',
        'Report starting/blocked/done to the lead for every assigned task.',
      ],
    },
    {
      title: 'Fresh memory',
      bullets: memories.length ? memories.slice(0, 8).map(memoryBullet) : ['No persisted memories yet; save one with POST /api/memory/save.'],
    },
    {
      title: 'Verification oath',
      bullets: [
        'Before claiming done, run the scoped test and bunx tsc --noEmit.',
        'Keep files under 250 lines and target alpha for PRs.',
        'If blocked, state the exact blocker and the alternative already tried.',
      ],
    },
  ];
  const tape = { generatedAt: generatedAt.toISOString(), readTimeMinutes: DEFAULT_READ_TIME_MINUTES, memoryCount: memories.length, sections };
  return { ...tape, markdown: toMarkdown(tape) };
}

function memoryBullet(memory: MemoryRecord): string {
  const label = memory.title || memory.source || memory.id;
  const tags = memory.tags?.length ? ` [${memory.tags.join(', ')}]` : '';
  return `${label}${tags}: ${oneLine(memory.content)}`;
}

function oneLine(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

function toMarkdown(tape: Omit<MorningTape, 'markdown'>): string {
  const lines = [
    '# MORNING-TAPE',
    '',
    `Generated: ${tape.generatedAt}`,
    `Target read time: ${tape.readTimeMinutes} minutes`,
    `Persisted memories included: ${tape.memoryCount}`,
    '',
  ];
  for (const section of tape.sections) {
    lines.push(`## ${section.title}`, '');
    for (const bullet of section.bullets) lines.push(`- ${bullet}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
