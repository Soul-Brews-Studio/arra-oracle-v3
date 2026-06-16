import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import * as schema from '../db/schema.ts';
import { DB_PATH, ORACLE_DATA_DIR, REPO_ROOT } from '../config.ts';
import { MCP_SERVER_NAME } from '../const.ts';
import { getDisabledTools, getEnabledToolNames, loadToolGroupConfig, watchToolGroupConfig, type ToolGroupConfig } from '../config/tool-groups.ts';
import type { ToolContext, ToolResponse } from '../tools/types.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import { defaultMcpToolOrder, mcpToolByName, mcpTools, toMcpToolDefinition, type RuntimeMcpToolManifest } from '../tools/mcp-manifest.ts';
import { loadUnifiedPlugins, type UnifiedRuntime } from '../plugins/unified-loader.ts';
import { resolveToolName } from './aliases.ts';
import { proxyToolCall, resolveOracleApiBase } from './http-proxy.ts';
import { pluginMcpToolsFrom } from './plugin-tools.ts';
import { runWithTenant } from '../middleware/tenant.ts';
import { stripMcpTenantArgs, tenantIdFromMcpArgs } from './tenant.ts';

function errorResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }], isError: true };
}

function loadPackageVersion(): string {
  const pkgPath = path.join(import.meta.dir, '..', '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
}

type EmbeddedDeps = {
  createVectorStoreForModel: (preset: any) => VectorStoreAdapter;
  getEmbeddingModels: () => Record<string, any>;
  createDatabase: (dbPath?: string) => {
    sqlite: Database;
    db: BunSQLiteDatabase<typeof schema>;
  };
};

export type OracleMCPServerOptions = {
  readOnly?: boolean;
  toolGroups?: ToolGroupConfig;
  embeddedDeps?: EmbeddedDeps | Promise<EmbeddedDeps>;
  watchToolGroups?: typeof watchToolGroupConfig;
};

export class OracleMCPServer {
  private server: Server;
  private sqlite: Database | null = null;
  private db: BunSQLiteDatabase<typeof schema> | null = null;
  private repoRoot = REPO_ROOT;
  private vectorStore: VectorStoreAdapter | null = null;
  private vectorStatus: ToolContext['vectorStatus'] = 'unknown';
  private readOnly: boolean;
  private version = loadPackageVersion();
  private disabledTools = new Set<string>();
  private enabledToolNames: string[] = [];
  private explicitDisabledTools = new Set<string>();
  private explicitEnabledTools = new Set<string>();
  private stopToolGroupsWatch: (() => void) | null = null;
  private embeddedReady: Promise<void> | null = null;
  private readonly oracleApiBase: string | null;
  private readonly unifiedRuntimeReady: Promise<UnifiedRuntime>;
  private readonly embeddedDeps?: EmbeddedDeps | Promise<EmbeddedDeps>;
  private readonly watchToolGroups: typeof watchToolGroupConfig;

  constructor(options: OracleMCPServerOptions = {}) {
    this.readOnly = options.readOnly ?? false;
    this.embeddedDeps = options.embeddedDeps;
    this.watchToolGroups = options.watchToolGroups ?? watchToolGroupConfig;
    if (this.readOnly) console.error('[Oracle] Running in READ-ONLY mode');
    this.oracleApiBase = resolveOracleApiBase();
    console.error(this.oracleApiBase
      ? `[Oracle] Running in HTTP-proxy mode (ORACLE_HTTP_URL → ${this.oracleApiBase})`
      : '[Oracle] Running in embedded mode (ORACLE_HTTP_URL unset)');

    const groupConfig = options.toolGroups ?? loadToolGroupConfig(this.repoRoot);
    this.applyToolGroupConfig(groupConfig);
    this.logToolGroupConfig(groupConfig);
    this.unifiedRuntimeReady = loadUnifiedPlugins({ warn: (message) => console.error(message) });
    this.watchToolGroupsIfNeeded(options.toolGroups);

    this.server = new Server(
      { name: MCP_SERVER_NAME, version: this.version },
      { capabilities: { tools: {} } },
    );
    if (!this.oracleApiBase) this.embeddedReady = this.initEmbedded();
    this.setupHandlers();
    this.setupErrorHandling();
  }


  private applyToolGroupConfig(config: ToolGroupConfig): void {
    this.disabledTools = getDisabledTools(config);
    this.enabledToolNames = getEnabledToolNames(config);
    this.explicitDisabledTools = new Set(config.disabled_tools ?? []);
    this.explicitEnabledTools = new Set(config.enabled_tools ?? []);
  }

  private logToolGroupConfig(config: ToolGroupConfig): void {
    const disabledGroups = Object.entries(config).filter(([, v]) => typeof v === 'boolean' && !v).map(([k]) => k);
    if (disabledGroups.length) console.error(`[ToolGroups] Disabled groups: ${disabledGroups.join(', ')}`);
    if (config.disabled_tools?.length) console.error(`[ToolGroups] disabled_tools: ${config.disabled_tools.join(', ')}`);
    if (config.enabled_tools?.length) console.error(`[ToolGroups] enabled_tools (whitelist): ${config.enabled_tools.join(', ')}`);
  }

  private watchToolGroupsIfNeeded(pinnedConfig?: ToolGroupConfig): void {
    if (pinnedConfig || process.env.ORACLE_TOOL_GROUPS_HOT_RELOAD === '0') return;
    this.stopToolGroupsWatch = this.watchToolGroups((next) => {
      this.applyToolGroupConfig(next);
      this.logToolGroupConfig(next);
      console.error('[ToolGroups] Reloaded');
    }, this.repoRoot);
  }

  private async getToolCtx(): Promise<ToolContext> {
    this.embeddedReady ??= this.initEmbedded();
    await this.embeddedReady;
    if (!this.sqlite || !this.db || !this.vectorStore) throw new Error('Embedded Oracle resources failed to initialize');
    return { db: this.db, sqlite: this.sqlite, repoRoot: this.repoRoot, vectorStore: this.vectorStore, vectorStatus: this.vectorStatus, version: this.version };
  }

  private async initEmbedded(): Promise<void> {
    if (this.sqlite && this.db && this.vectorStore) return;
    const { createVectorStoreForModel, getEmbeddingModels, createDatabase } = await this.loadEmbeddedDeps();
    this.vectorStore = createVectorStoreForModel(getEmbeddingModels()['bge-m3']);
    const { sqlite, db } = createDatabase(DB_PATH);
    this.sqlite = sqlite;
    this.db = db;
    await this.verifyVectorHealth();
  }

  private async loadEmbeddedDeps(): Promise<EmbeddedDeps> {
    if (this.embeddedDeps) return await this.embeddedDeps;
    const [{ createVectorStoreForModel, getEmbeddingModels }, { createDatabase }] = await Promise.all([
      import('../vector/factory.ts'),
      import('../db/index.ts'),
    ]);
    return { createVectorStoreForModel, getEmbeddingModels, createDatabase };
  }

  private async verifyVectorHealth(): Promise<void> {
    if (!this.vectorStore) {
      this.vectorStatus = 'unavailable';
      return;
    }
    try {
      const stats = await this.vectorStore.getStats();
      this.vectorStatus = 'connected';
      console.error(stats.count > 0
        ? `[VectorDB:${this.vectorStore.name}] ✓ oracle_knowledge: ${stats.count} documents`
        : `[VectorDB:${this.vectorStore.name}] ✓ Connected but collection empty`);
    } catch (e) {
      this.vectorStatus = 'unavailable';
      console.error(`[VectorDB:${this.vectorStore.name}] ✗ Cannot connect:`, e instanceof Error ? e.message : String(e));
    }
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async toolRegistry(): Promise<Map<string, RuntimeMcpToolManifest>> {
    const runtime = await this.unifiedRuntimeReady;
    const pluginTools = pluginMcpToolsFrom(runtime, new Set(mcpToolByName.keys()));
    return new Map([...mcpTools, ...pluginTools].map((tool) => [tool.name, tool]));
  }

  private isDisabled(tool: RuntimeMcpToolManifest): boolean {
    if (this.explicitEnabledTools.has(tool.name)) return false;
    return this.disabledTools.has(tool.name) || this.explicitDisabledTools.has(tool.name);
  }

  private async availableTools() {
    const registry = await this.toolRegistry();
    const configured = defaultMcpToolOrder(this.enabledToolNames);
    const dynamic = [...registry.values()]
      .filter((tool) => !configured.includes(tool.name) && (tool.enabledByDefault !== false || this.explicitEnabledTools.has(tool.name)))
      .map((tool) => tool.name);
    return [...configured, ...dynamic]
      .map((name) => registry.get(name))
      .filter((tool): tool is RuntimeMcpToolManifest => !!tool)
      .filter((tool) => !this.isDisabled(tool))
      .filter((tool) => !this.readOnly || tool.readOnly !== false);
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: (await this.availableTools()).map(toMcpToolDefinition),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      const toolName = resolveToolName(request.params.name);
      const tool = (await this.toolRegistry()).get(toolName);
      if (!tool) return errorResponse(`Error: Unknown tool: ${toolName}`);
      if (this.isDisabled(tool)) {
        return errorResponse(`Error: Tool "${toolName}" is disabled by tool group config. Check ${ORACLE_DATA_DIR}/config.json or arra.config.json.`);
      }
      if (this.readOnly && tool.readOnly === false) {
        return errorResponse(`Error: Tool "${toolName}" is disabled in read-only mode. This Oracle instance is configured for read-only access.`);
      }
      try {
        const rawArgs = request.params.arguments && typeof request.params.arguments === 'object'
          ? request.params.arguments as Record<string, unknown>
          : {};
        const tenantId = tenantIdFromMcpArgs(rawArgs);
        const args = stripMcpTenantArgs(rawArgs);
        const proxied = await proxyToolCall(this.oracleApiBase, toolName, args, tenantId);
        if (proxied) return proxied;
        return await runWithTenant(tenantId, () => tool.handler(args, { version: this.version, getToolCtx: () => this.getToolCtx() }));
      } catch (error) {
        return errorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async preConnectVector(): Promise<void> {
    if (this.oracleApiBase) {
      console.error('[Startup] Skipping vector pre-connect in HTTP-proxy mode');
      return;
    }
    await this.getToolCtx();
    await this.vectorStore?.connect();
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Arra Oracle MCP Server running on stdio (FTS5 mode)');
  }

  async cleanup(): Promise<void> {
    this.stopToolGroupsWatch?.();
    this.sqlite?.close();
    await this.vectorStore?.close();
  }
}
