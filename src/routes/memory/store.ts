export type MemoryInput = {
  content: string;
  title?: string;
  tags?: string[];
  source?: string;
};

export type MemoryRecord = MemoryInput & {
  id: string;
  createdAt: string;
};

export class InMemoryStore {
  private readonly records = new Map<string, MemoryRecord>();
  private counter = 0;

  save(input: MemoryInput): MemoryRecord {
    const content = input.content.trim();
    if (!content) throw new Error('memory content is required');
    const id = `mem_${Date.now().toString(36)}_${(++this.counter).toString(36)}`;
    const record: MemoryRecord = {
      id,
      content,
      title: input.title?.trim() || undefined,
      tags: input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
      source: input.source?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    this.records.set(id, record);
    return record;
  }

  recall(query = '', limit = 10): MemoryRecord[] {
    const normalized = query.trim().toLowerCase();
    const records = [...this.records.values()].reverse();
    const matches = normalized ? records.filter((record) => searchable(record).includes(normalized)) : records;
    return matches.slice(0, limit);
  }

  clear(): void {
    this.records.clear();
    this.counter = 0;
  }
}

function searchable(record: MemoryRecord): string {
  return [record.content, record.title, record.source, ...(record.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export const memoryStore = new InMemoryStore();
