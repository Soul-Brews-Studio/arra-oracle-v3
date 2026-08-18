import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { Database } from 'bun:sqlite';
import * as schema from '../db/schema.ts';
import pkg from '../../package.json' with { type: 'json' };
import { DB_PATH, ORACLE_DATA_DIR, REPO_ROOT } from '../config.ts';
import { MCP_SERVER_NAME } from '../const.ts';
import { getDisabledTools, getEnabledToolNames, loadToolGroupConfig, watchToolGroupConfig, type ToolGroupConfig } from '../config/tool-groups.ts';
import type { ToolContext, ToolResponse } from '../tools/types.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import { defaultMcpToolOrder, mcpToolByName, mcpTools, toMcpToolDefinition, type RuntimeMcpToolManifest } from '../tools/mcp-manifest.ts';
import type { UnifiedRuntime } from '../plugins/unified-loader.ts';
import type { EmbeddedDeps, OracleMCPServerOptions } from './server-options.ts';
import { probeVectorStore } from './vector-health.ts';
import { formatEmbedderDegradedWarning, probeConfiguredEmbedder, readEmbedderRuntimeStatus, setEmbedderRuntimeStatus, type EmbedderRuntimeStatus } from '../vector/embedder-config.ts';
import { resolveInboundToolName, retiredAliasNotice } from './aliases.ts';
import { proxyToolCall, resolveOracleApiBase, resolveRemoteWriteApiBase } from './http-proxy.ts';
import { pluginMcpToolsFrom } from './plugin-tools.ts';
import { runWithTenant } from '../middleware/tenant.ts';
import { stripMcpTenantArgs, tenantIdFromMcpArgs } from './tenant.ts';
import { createMcpPluginRuntime, type McpPluginRuntime } from './plugin-runtime.ts';
import { createFtsOnlyVectorStore } from './fts-only-vector-store.ts';
export type { OracleMCPServerOptions } from './server-options.ts';
function errorResponse(text: string): ToolResponse { return { content: [{ type: 'text', text }], isError: true }; }
export class OracleMCPServer {
  private server: Server;
  private sqlite: Database | null = null;
  private db: BunSQLiteDatabase<typeof schema> | null = null;
  private repoRoot = REPO_ROOT;
  private vectorStore: VectorStoreAdapter | null = null;
  private vectorStatus: ToolContext['vectorStatus'] = 'unknown';
  private vectorReason: string | undefined; private embedderProvider: string | undefined; private lastEmbedderWarning: string | undefined;
  private readOnly: boolean;
  private version = pkg.version;
  private disabledTools = new Set<string>();
  private enabledToolNames: string[] = [];
  private explicitDisabledTools = new Set<string>();
  private explicitEnabledTools = new Set<string>();
  private stopToolGroupsWatch: (() => void) | null = null;
  private embeddedReady: Promise<void> | null = null;
  private readonly oracleApiBase: string | null;
  private readonly remoteWriteApiBase: string | null;
  private readonly unifiedRuntime: McpPluginRuntime;
  private readonly embeddedDeps?: EmbeddedDeps | Promise<EmbeddedDeps>;
  private readonly watchToolGroups: typeof watchToolGroupConfig;
  private readonly toolAllowlist: ReadonlySet<string> | null;
  constructor(options: OracleMCPServerOptions = {}) {
    this.readOnly = options.readOnly ?? false;
    this.embeddedDeps = options.embeddedDeps;
    this.watchToolGroups = options.watchToolGroups ?? watchToolGroupConfig;
    this.toolAllowlist = options.toolAllowlist ? new Set(options.toolAllowlist) : null;
    if (this.readOnly) console.error('[Oracle] Running in READ-ONLY mode');
    this.oracleApiBase = resolveOracleApiBase();
    this.remoteWriteApiBase = resolveRemoteWriteApiBase();
    console.error(this.oracleApiBase
      ? `[Oracle] Running in HTTP-proxy mode (ORACLE_HTTP_URL → ${this.oracleApiBase})`
      : '[Oracle] Running in embedded mode (ORACLE_HTTP_URL unset)');
    const groupConfig = options.toolGroups ?? loadToolGroupConfig(this.repoRoot);
    this.applyToolGroupConfig(groupConfig);
    this.logToolGroupConfig(groupConfig);
    this.unifiedRuntime = createMcpPluginRuntime({ runtime: options.unifiedRuntime, runtimeRef: options.unifiedRuntimeRef, watch: options.watchPlugins, warn: (message) => console.error(message) });
    this.watchToolGroupsIfNeeded(options.toolGroups);
    this.server = new Server(
      { name: MCP_SERVER_NAME, version: this.version },
      { capabilities: { tools: {} } },
    );
    if (!this.oracleApiBase) this.embeddedReady = this.initEmbedded();
    this.setupHandlers();
    this.setupErrorHandling(options.installSignalHandlers !== false);
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
    // Re-probes behind a TTL, as /api/v1/stats and /api/v1/health already do. The snapshot
    // reader never re-probes, so this reported boot-time truth forever — see #2817 and
    // tests/mcp/stats-embedder-freshness.test.ts.
    this.applyEmbedderStatus(await readEmbedderRuntimeStatus());
    return { db: this.db, sqlite: this.sqlite, repoRoot: this.repoRoot, vectorStore: this.vectorStore, vectorStatus: this.vectorStatus, vectorReason: this.vectorReason, embedderProvider: this.embedderProvider, version: this.version };
  }

  private async initEmbedded(): Promise<void> {
    if (this.sqlite && this.db && this.vectorStore) return;
    const { createVectorStoreForModel, getEmbeddingModels, createDatabase, probeEmbedder = probeConfiguredEmbedder } = await this.loadEmbeddedDeps();
    const models = getEmbeddingModels();
    const preset = models['bge-m3'] ?? Object.values(models)[0];
    const embedderStatus = await probeEmbedder(preset);
    this.applyEmbedderStatus(embedderStatus);
    try { this.vectorStore = createVectorStoreForModel(preset); } catch (error) {
      if (embedderStatus.status !== 'degraded') throw error;
      this.vectorStore = createFtsOnlyVectorStore(embedderStatus.reason ?? 'embedder unavailable');
    }
    const { sqlite, db } = createDatabase(DB_PATH, { readonly: this.readOnly });
    this.sqlite = sqlite;
    this.db = db;
    await this.verifyVectorHealth();
  }

  private async loadEmbeddedDeps(): Promise<EmbeddedDeps> {
    if (this.embeddedDeps) return await this.embeddedDeps;
    const [{ createVectorStoreForModel, getEmbeddingModels }, { createDatabase }] = await Promise.all([
      import('../vector/factory.ts'),
      import('../db/create.ts'),
    ]);
    return { createVectorStoreForModel, getEmbeddingModels, createDatabase, probeEmbedder: probeConfiguredEmbedder };
  }

  private applyEmbedderStatus(status: EmbedderRuntimeStatus): void {
    setEmbedderRuntimeStatus(status);
    this.embedderProvider = status.provider;
    if (status.status === 'connected') { this.vectorStatus = 'connected'; this.vectorReason = undefined; this.lastEmbedderWarning = undefined; return; }
    if (status.status !== 'degraded') return;
    this.vectorStatus = 'degraded';
    this.vectorReason = status.reason;
    const warning = formatEmbedderDegradedWarning(status.provider, status.reason ?? 'unknown');
    if (this.lastEmbedderWarning !== warning) { console.error(warning); this.lastEmbedderWarning = warning; }
  }

  private async verifyVectorHealth(): Promise<void> {
    this.vectorStatus = await probeVectorStore(this.vectorStore, this.vectorStatus);
  }

  private setupErrorHandling(installSignalHandlers: boolean): void {
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    if (!installSignalHandlers) return;
    process.on('SIGINT', async () => { await this.cleanup(); process.exit(0); });
  }

  private async toolRegistry(): Promise<Map<string, RuntimeMcpToolManifest>> {
    const runtime = await this.unifiedRuntime.current();
    const pluginTools = pluginMcpToolsFrom(runtime, new Set(mcpToolByName.keys()));
    return new Map([...mcpTools, ...pluginTools].map((tool) => [tool.name, tool]));
  }

  private isDisabled(tool: RuntimeMcpToolManifest): boolean {
    if (this.explicitEnabledTools.has(tool.name)) return false;
    return this.disabledTools.has(tool.name) || this.explicitDisabledTools.has(tool.name);
  }

  private isAllowed(tool: RuntimeMcpToolManifest): boolean {
    return !this.toolAllowlist || this.toolAllowlist.has(tool.name);
  }

  /**
   * TINE-ratified read-only exception (2026-08-18): a remoteWriteSafe tool is
   * usable from a read-only seat only when an HTTP owner core is configured —
   * the write happens in the owner core, never against the local readonly DB.
   */
  private remoteWriteAllowed(tool: RuntimeMcpToolManifest): boolean {
    return tool.remoteWriteSafe === true && !!(this.oracleApiBase || this.remoteWriteApiBase);
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
      .filter((tool) => this.isAllowed(tool))
      .filter((tool) => !this.isDisabled(tool))
      .filter((tool) => !this.readOnly || tool.readOnly !== false || this.remoteWriteAllowed(tool));
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: (await this.availableTools()).map(toMcpToolDefinition),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      if (typeof request.params.name !== 'string' || !request.params.name.trim()) {
        return errorResponse('Error: Tool name must be a non-empty string');
      }
      const toolName = resolveInboundToolName(request.params.name);
      const tool = (await this.toolRegistry()).get(toolName);
      if (!tool) {
        // A retired alias fails like any unknown tool, but the CLIENT gets told why.
        // `resolveInboundToolName` already logged it to stderr, which the caller may never
        // see; #2824 flagged exactly this — "a confusing error with no hint about the rename".
        const retired = retiredAliasNotice(request.params.name);
        return errorResponse(retired ? `Error: Unknown tool: ${toolName}. ${retired}` : `Error: Unknown tool: ${toolName}`);
      }
      if (!this.isAllowed(tool)) return errorResponse(`Error: Unknown tool: ${toolName}`);
      if (this.isDisabled(tool)) {
        return errorResponse(`Error: Tool "${toolName}" is disabled by tool group config. Check ${ORACLE_DATA_DIR}/config.json or arra.config.json.`);
      }
      if (this.readOnly && tool.readOnly === false && !this.remoteWriteAllowed(tool)) {
        return errorResponse(`Error: Tool "${toolName}" is disabled in read-only mode. This Oracle instance is configured for read-only access.`);
      }
      try {
        const rawArgs = request.params.arguments && typeof request.params.arguments === 'object'
          ? request.params.arguments as Record<string, unknown>
          : {};
        const tenantId = tenantIdFromMcpArgs(rawArgs);
        const args = stripMcpTenantArgs(rawArgs);
        // ORACLE_REMOTE_WRITE_URL applies ONLY to remoteWriteSafe tools on a
        // read-only seat — it must never flip search/read into proxy mode.
        const proxyBase = this.oracleApiBase
          ?? (this.readOnly && tool.remoteWriteSafe === true ? this.remoteWriteApiBase : null);
        const proxied = await proxyToolCall(proxyBase, toolName, args, tenantId);
        if (proxied) return proxied;
        if (this.readOnly && tool.readOnly === false) {
          // remoteWriteSafe passed the gate above but the owner-core proxy did
          // not handle the call — fail closed rather than write locally.
          return errorResponse(`Error: Tool "${toolName}" requires the HTTP owner core on a read-only seat, and the proxy did not handle the call.`);
        }
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
    try { await this.vectorStore?.connect(); }
    catch (error) {
      if (this.vectorStatus !== 'degraded') throw error;
      console.error(`[VectorDB:${this.vectorStore?.name ?? 'unknown'}] skipped pre-connect after embedder degradation`);
    }
  }

  async connect(transport: Transport): Promise<void> { await this.server.connect(transport); }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.connect(transport);
    console.error('Arra Oracle MCP Server running on stdio (FTS5 mode)');
  }

  async cleanup(): Promise<void> {
    this.stopToolGroupsWatch?.(); this.unifiedRuntime.close(); this.sqlite?.close();
    await this.vectorStore?.close();
  }
}
