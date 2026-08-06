import { dlopen, FFIType, suffix } from 'bun:ffi';
import { join } from 'node:path';
import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../vector/adapter';
import type { LoadedPlugin } from './types';

const RESULT_BUF_SIZE = 1024 * 256;

type FfiSymbols = {
  plugin_init: { args: [FFIType.ptr, FFIType.i32]; returns: FFIType.i32 };
  plugin_query: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32]; returns: FFIType.i32 };
  plugin_query_by_id: { args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32]; returns: FFIType.i32 };
  plugin_query_by_vector: { args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32]; returns: FFIType.i32 };
  plugin_add_documents: { args: [FFIType.ptr, FFIType.i32]; returns: FFIType.i32 };
  plugin_get_stats: { args: [FFIType.ptr, FFIType.i32]; returns: FFIType.i32 };
  plugin_shutdown: { args: []; returns: FFIType.void };
};

function encode(s: string): { ptr: Uint8Array; len: number } {
  const buf = new TextEncoder().encode(s);
  return { ptr: buf, len: buf.length };
}

function decode(buf: Uint8Array, written: number): string {
  return new TextDecoder().decode(buf.subarray(0, written));
}

export function createFfiVectorAdapter(plugin: LoadedPlugin): VectorStoreAdapter | null {
  if (plugin.manifest.type !== 'ffi') return null;
  const m = plugin.manifest;
  const libPath = join(plugin.dir, m.library);

  const lib = dlopen(libPath, {
    plugin_init: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    plugin_query: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    plugin_query_by_id: { args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    plugin_query_by_vector: { args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    plugin_add_documents: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    plugin_get_stats: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    plugin_shutdown: { args: [], returns: FFIType.void },
  });

  const resultBuf = new Uint8Array(RESULT_BUF_SIZE);

  return {
    name: `ffi:${m.name}`,

    async connect() {
      const config = encode(JSON.stringify({ name: m.name }));
      lib.symbols.plugin_init(config.ptr, config.len);
    },

    async close() {
      lib.symbols.plugin_shutdown();
    },

    async ensureCollection() {},
    async deleteCollection() {},

    async addDocuments(docs: VectorDocument[]) {
      const data = encode(JSON.stringify(docs));
      lib.symbols.plugin_add_documents(data.ptr, data.len);
    },

    async query(text: string, limit = 10): Promise<VectorQueryResult> {
      const q = encode(JSON.stringify({ text, limit }));
      const written = lib.symbols.plugin_query(q.ptr, q.len, resultBuf, RESULT_BUF_SIZE);
      if (written <= 0) return { ids: [], documents: [], distances: [], metadatas: [] };
      return JSON.parse(decode(resultBuf, written));
    },

    async queryById(id: string, nResults = 10): Promise<VectorQueryResult> {
      const idBuf = encode(id);
      const written = lib.symbols.plugin_query_by_id(idBuf.ptr, idBuf.len, nResults, resultBuf, RESULT_BUF_SIZE);
      if (written <= 0) return { ids: [], documents: [], distances: [], metadatas: [] };
      return JSON.parse(decode(resultBuf, written));
    },

    async getStats(): Promise<{ count: number }> {
      const written = lib.symbols.plugin_get_stats(resultBuf, RESULT_BUF_SIZE);
      if (written <= 0) return { count: 0 };
      return JSON.parse(decode(resultBuf, written));
    },

    async getCollectionInfo(): Promise<{ count: number; name: string }> {
      const stats = await this.getStats();
      return { count: stats.count, name: `ffi:${m.name}` };
    },
  };
}
