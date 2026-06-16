import { ensureVectorStoreConnected } from '../../vector/factory.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';
import type { MemoryRecord } from './store.ts';

export type MemoryVectorHit = {
  memoryId: string;
  vectorId: string;
  document: string;
  metadata: Record<string, unknown>;
  distance: number;
  score: number;
};

export type MemoryVectorIndexResult = { indexed: true } | { indexed: false; error: string };

export interface MemoryVectorIndex {
  index(memory: MemoryRecord): Promise<MemoryVectorIndexResult>;
  search(query: string, limit: number): Promise<MemoryVectorHit[]>;
}

type StoreResolver = () => Promise<VectorStoreAdapter>;

export class VectorMemoryIndex implements MemoryVectorIndex {
  constructor(private readonly resolveStore: StoreResolver = () => ensureVectorStoreConnected('bge-m3')) {}

  async index(memory: MemoryRecord): Promise<MemoryVectorIndexResult> {
    try {
      const store = await this.resolveStore();
      await store.addDocuments([memoryDocument(memory)]);
      return { indexed: true };
    } catch (error) {
      return { indexed: false, error: messageFrom(error) };
    }
  }

  async search(query: string, limit: number): Promise<MemoryVectorHit[]> {
    const clean = query.trim();
    if (!clean) throw new Error('memory search query is required');
    const store = await this.resolveStore();
    const tenantId = currentTenantId();
    const where = tenantId ? { type: 'memory', tenant_id: tenantId } : { type: 'memory' };
    const result = await store.query(clean, limit, where);
    return hitsFrom(result).filter((hit) => matchesTenant(hit, tenantId));
  }
}

function memoryDocument(memory: MemoryRecord): VectorDocument {
  return {
    id: vectorId(memory.id),
    document: [memory.title, memory.content, ...(memory.tags ?? [])].filter(Boolean).join('\n'),
    metadata: {
      type: 'memory',
      memoryId: memory.id,
      tenant_id: memory.tenantId ?? 'default',
      title: memory.title ?? '',
      source: memory.source ?? '',
      tags: (memory.tags ?? []).join(','),
      createdAt: memory.createdAt,
    },
  };
}

function hitsFrom(result: VectorQueryResult): MemoryVectorHit[] {
  return result.ids.map((id, index) => {
    const metadata = (result.metadatas[index] ?? {}) as Record<string, unknown>;
    const distance = Number(result.distances[index] ?? 0);
    return {
      memoryId: String(metadata.memoryId ?? id.replace(/^memory:/, '')),
      vectorId: id,
      document: result.documents[index] ?? '',
      metadata,
      distance,
      score: Math.max(0, 1 - distance),
    };
  });
}

function matchesTenant(hit: MemoryVectorHit, tenantId: string | undefined): boolean {
  if (!tenantId) return true;
  const value = hit.metadata.tenant_id ?? hit.metadata.tenantId ?? hit.metadata.tenant;
  return value === tenantId;
}

function vectorId(memoryId: string): string {
  return `memory:${memoryId}`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const memoryVectorIndex = new VectorMemoryIndex();
