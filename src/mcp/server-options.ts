import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { Database } from 'bun:sqlite';
import type * as schema from '../db/schema.ts';
import type { ToolGroupConfig, watchToolGroupConfig } from '../config/tool-groups.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import type { EmbedderRuntimeStatus } from '../vector/embedder-config.ts';
import type { McpPluginRuntimeOptions } from './plugin-runtime.ts';

export type EmbeddedDeps = {
  createVectorStoreForModel: (preset: any) => VectorStoreAdapter;
  getEmbeddingModels: () => Record<string, any>;
  createDatabase: (dbPath?: string, options?: { readonly?: boolean }) => {
    sqlite: Database;
    db: BunSQLiteDatabase<typeof schema>;
  };
  probeEmbedder?: (preset: any) => Promise<EmbedderRuntimeStatus>;
};

export type OracleMCPServerOptions = {
  readOnly?: boolean;
  /**
   * Birth spec v5 D3: 'delegate' is a no-retro worker seat — forces readOnly,
   * never resolves a remote-write or HTTP-proxy base, so oracle_index_retro,
   * oracle_learn and oracle_supersede are structurally absent from the catalog.
   */
  profile?: 'read-mostly' | 'delegate' | 'owner';
  toolGroups?: ToolGroupConfig;
  toolAllowlist?: readonly string[];
  embeddedDeps?: EmbeddedDeps | Promise<EmbeddedDeps>;
  watchToolGroups?: typeof watchToolGroupConfig;
  unifiedRuntime?: McpPluginRuntimeOptions['runtime'];
  unifiedRuntimeRef?: McpPluginRuntimeOptions['runtimeRef'];
  watchPlugins?: McpPluginRuntimeOptions['watch'];
  installSignalHandlers?: boolean;
};
