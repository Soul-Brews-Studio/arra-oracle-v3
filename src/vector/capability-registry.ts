export interface CapabilityRecord {
  kind: string;
  name: string;
  capabilities?: Record<string, unknown>;
}

export type CapabilityHealthChecker<T extends CapabilityRecord, H> = (entry: T) => Promise<H>;

export class CapabilityRegistry<T extends CapabilityRecord, H = unknown> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly healthCheckers: Record<string, CapabilityHealthChecker<T, H>> = {}) {}

  register(entry: T): T {
    const normalized = this.copy(entry);
    if (!normalized.kind.trim()) throw new Error('capability kind is required');
    if (!normalized.name.trim()) throw new Error('capability name is required');
    this.entries.set(this.key(normalized.kind, normalized.name), normalized);
    return this.copy(normalized);
  }

  discover(kind?: string): T[] {
    return [...this.entries.values()]
      .filter((entry) => !kind || entry.kind === kind)
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
      .map((entry) => this.copy(entry));
  }

  unregister(kind: string, name: string): boolean {
    return this.entries.delete(this.key(kind, name));
  }

  clear(kind?: string): void {
    if (!kind) {
      this.entries.clear();
      return;
    }
    for (const entry of this.discover(kind)) this.entries.delete(this.key(entry.kind, entry.name));
  }

  async healthCheck(kind?: string): Promise<Map<string, H>> {
    const checks = this.discover(kind).map(async (entry): Promise<readonly [string, H] | undefined> => {
      const checker = this.healthCheckers[entry.kind];
      if (!checker) return undefined;
      const key = kind ? entry.name : this.key(entry.kind, entry.name);
      return [key, await checker(entry)] as const;
    });
    const results = await Promise.all(checks);
    const present: Array<readonly [string, H]> = [];
    for (const item of results) if (item) present.push(item);
    return new Map(present);
  }

  private key(kind: string, name: string): string {
    return `${kind.trim().toLowerCase()}:${name.trim()}`;
  }

  private copy(entry: T): T {
    return {
      ...entry,
      capabilities: entry.capabilities ? { ...entry.capabilities } : undefined,
    };
  }
}
