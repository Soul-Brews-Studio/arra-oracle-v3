#!/usr/bin/env bun
/**
 * Arra Oracle MCP Server
 *
 * Slim entry point: server lifecycle, tool registration, and routing.
 * Handler implementations live in src/tools/.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { Database } from 'bun:sqlite';
import * as schema from './db/schema.ts';
import type { VectorStoreAdapter } from './vector/types.ts';
import path from 'path';
import fs from 'fs';
import { loadToolGroupConfig, getDisabledTools, getEnabledToolNames, watchToolGroupConfig, type ToolGroupConfig } from './config/tool-groups.ts';
import { ORACLE_DATA_DIR, DB_PATH, REPO_ROOT } from './config.ts';
import { MCP_SERVER_NAME } from './const.ts';

// Tool handlers (all extracted to src/tools/)
import type { ToolContext, ToolResponse } from './tools/types.ts';
import {
  searchToolDef, handleSearch,
  learnToolDef, handleLearn,
  listToolDef, handleList,
  statsToolDef, handleStats,
  conceptsToolDef, handleConcepts,
  supersedeToolDef, handleSupersede,
  handoffToolDef, handleHandoff,
  inboxToolDef, handleInbox,
  readToolDef, handleRead,
  forumToolDefs,
  handleThread, handleThreads, handleThreadRead, handleThreadUpdate,
  traceToolDefs,
  handleTrace, handleTraceList, handleTraceGet, handleTraceLink, handleTraceUnlink, handleTraceChain,
  // Standalone tools (#972 wire — reflect + verify only. Schedule handlers
  // remain HTTP-only per maintainer direction: /api/schedule/* routes still
  // use them, but they're not exposed as MCP tools.)
  reflectToolDef, handleReflect,
  verifyToolDef, handleVerify,
} from './tools/index.ts';

import type {
  OracleSearchInput,
  OracleLearnInput,
  OracleListInput,
  OracleStatsInput,
  OracleConceptsInput,
  OracleSupersededInput,
  OracleHandoffInput,
  OracleInboxInput,
  OracleReadInput,
  OracleThreadInput,
  OracleThreadsInput,
  OracleThreadReadInput,
  OracleThreadUpdateInput,
  OracleReflectInput,
  OracleVerifyInput,
} from './tools/index.ts';

import type {
  CreateTraceInput,
  ListTracesInput,
  GetTraceInput,
} from './trace/types.ts';

/**
 * Backward-compat alias chain (3 generations):
 *   arra_*    (original, pre-#1172)         ─┐
 *   muninn_*  (#1172, briefly canonical)   ─┼──►  oracle_*  (current canonical)
 *   oracle_*  (current canonical, advertised in ListTools)
 *
 * Tool LIST is unchanged — only oracle_* is advertised — but BOTH legacy
 * prefixes keep working invisibly. The all-digit identifier prefix-strip
 * is the same shape for both, so a single ALIAS_PREFIXES iteration covers
 * any future rename without code changes.
 * Exported for unit tests.
 */
const ALIAS_PREFIXES = ['arra_', 'muninn_'] as const;
export function resolveToolName(name: string): string {
  for (const p of ALIAS_PREFIXES) {
    if (name.startsWith(p)) return 'oracle_' + name.slice(p.length);
  }
  return name;
}

// Write tools that should be disabled in read-only mode
const WRITE_TOOLS = [
  'oracle_learn',
  'oracle_thread',
  'oracle_thread_update',
  'oracle_trace',
  'oracle_supersede',
  'oracle_handoff',
];

const EMBEDDED_API_VALUES = new Set(['embedded', 'embed', 'off', 'none', 'false', '0']);

class OracleApiUnavailableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(
      `Cannot reach ARRA Oracle at ${baseUrl}\n` +
      `  → Is the server running? Try: bun run server  (in arra-oracle-v3 repo)\n` +
      `  → Set ORACLE_HTTP_URL=http://localhost:<port> for HTTP-proxy mode\n` +
      `  → Or unset ORACLE_HTTP_URL to use direct embedded mode\n` +
      `  Original: ${msg}`,
    );
    this.name = 'OracleApiUnavailableError';
  }
}

function resolveOracleApiBase(): string | null {
  const raw = process.env.ORACLE_HTTP_URL ?? process.env.ORACLE_API ?? process.env.NEO_ARRA_API;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || EMBEDDED_API_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed.replace(/\/+$/, '');
}

async function oracleApiFetch(baseUrl: string, apiPath: string, opts?: RequestInit): Promise<Response> {
  const url = `${baseUrl}${apiPath}`;
  try {
    return await fetch(url, opts);
  } catch (err) {
    throw new OracleApiUnavailableError(baseUrl, err);
  }
}

type ProxyRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

function cleanQueryValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function queryFrom(input: Record<string, unknown>, fields: Record<string, string>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [sourceKey, targetKey] of Object.entries(fields)) {
    const value = cleanQueryValue(input[sourceKey]);
    if (value !== undefined) query[targetKey] = value;
  }
  return query;
}

function appendQuery(pathname: string, query?: Record<string, unknown>): string {
  if (!query || Object.keys(query).length === 0) return pathname;
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    const value = cleanQueryValue(raw);
    if (value !== undefined) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function proxyRequestForTool(toolName: string, args: Record<string, unknown>): ProxyRequest | null {
  switch (toolName) {
    case 'oracle_search':
      return {
        method: 'GET',
        path: '/api/search',
        query: {
          q: args.query,
          ...queryFrom(args, {
            type: 'type',
            limit: 'limit',
            offset: 'offset',
            mode: 'mode',
            project: 'project',
            cwd: 'cwd',
            model: 'model',
          }),
        },
      };
    case 'oracle_learn':
      return { method: 'POST', path: '/api/learn', body: args };
    case 'oracle_stats':
      return { method: 'GET', path: '/api/stats' };
    case 'oracle_read':
      return { method: 'GET', path: '/api/read', query: queryFrom(args, { file: 'file', id: 'id' }) };
    case 'oracle_list':
      return {
        method: 'GET',
        path: '/api/list',
        query: {
          ...queryFrom(args, { type: 'type', limit: 'limit', offset: 'offset' }),
          group: 'false',
        },
      };
    case 'oracle_inbox':
      return { method: 'GET', path: '/api/inbox', query: queryFrom(args, { limit: 'limit', offset: 'offset', type: 'type' }) };
    case 'oracle_handoff':
      return { method: 'POST', path: '/api/handoff', body: args };
    case 'oracle_thread':
      return {
        method: 'POST',
        path: '/api/thread',
        body: {
          message: args.message,
          thread_id: args.threadId,
          title: args.title,
          role: args.role ?? 'claude',
          model: args.model,
        },
      };
    case 'oracle_threads':
      return { method: 'GET', path: '/api/threads', query: queryFrom(args, { status: 'status', limit: 'limit', offset: 'offset' }) };
    case 'oracle_thread_read': {
      const threadId = cleanQueryValue(args.threadId);
      return threadId ? { method: 'GET', path: `/api/thread/${encodeURIComponent(threadId)}` } : null;
    }
    case 'oracle_thread_update': {
      const threadId = cleanQueryValue(args.threadId);
      return threadId ? { method: 'PATCH', path: `/api/thread/${encodeURIComponent(threadId)}/status`, body: { status: args.status } } : null;
    }
    case 'oracle_trace_list':
      return { method: 'GET', path: '/api/traces', query: queryFrom(args, { query: 'query', status: 'status', project: 'project', limit: 'limit', offset: 'offset' }) };
    case 'oracle_trace_get': {
      const traceId = cleanQueryValue(args.traceId);
      if (!traceId) return null;
      return args.includeChain === true
        ? { method: 'GET', path: `/api/traces/${encodeURIComponent(traceId)}/chain` }
        : { method: 'GET', path: `/api/traces/${encodeURIComponent(traceId)}` };
    }
    case 'oracle_trace_link': {
      const prevTraceId = cleanQueryValue(args.prevTraceId);
      return prevTraceId ? { method: 'POST', path: `/api/traces/${encodeURIComponent(prevTraceId)}/link`, body: { nextId: args.nextTraceId } } : null;
    }
    case 'oracle_trace_unlink': {
      const traceId = cleanQueryValue(args.traceId);
      return traceId ? { method: 'DELETE', path: `/api/traces/${encodeURIComponent(traceId)}/link`, query: { direction: args.direction } } : null;
    }
    case 'oracle_trace_chain': {
      const traceId = cleanQueryValue(args.traceId);
      return traceId ? { method: 'GET', path: `/api/traces/${encodeURIComponent(traceId)}/linked-chain` } : null;
    }
    case 'oracle_reflect':
      return { method: 'GET', path: '/api/reflect' };
    default:
      return null;
  }
}

async function readHttpPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function httpPayloadToToolResponse(payload: unknown, isError = false): ToolResponse {
  return {
    content: [{
      type: 'text',
      text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    }],
    ...(isError ? { isError: true } : {}),
  };
}

class OracleMCPServer {
  private server: Server;
  private sqlite: Database | null = null;
  private db: BunSQLiteDatabase<typeof schema> | null = null;
  private repoRoot: string;
  private vectorStore: VectorStoreAdapter | null = null;
  private vectorStatus: 'unknown' | 'connected' | 'unavailable' = 'unknown';
  private readOnly: boolean;
  private version: string;
  private disabledTools: Set<string>;
  private enabledToolNames: string[];
  private stopToolGroupsWatch: (() => void) | null = null;
  private embeddedReady: Promise<void> | null = null;
  private readonly oracleApiBase: string | null;

  constructor(options: { readOnly?: boolean; toolGroups?: ToolGroupConfig } = {}) {
    this.readOnly = options.readOnly ?? false;
    if (this.readOnly) {
      console.error('[Oracle] Running in READ-ONLY mode');
    }
    this.oracleApiBase = resolveOracleApiBase();
    if (this.oracleApiBase) {
      console.error(`[Oracle] Running in HTTP-proxy mode (ORACLE_HTTP_URL → ${this.oracleApiBase})`);
    } else {
      console.error('[Oracle] Running in embedded mode (ORACLE_HTTP_URL unset)');
    }
    // Use safe REPO_ROOT from config.ts: never falls back to process.cwd(),
    // which would create parasitic ψ/ dirs in whatever directory the MCP
    // server was launched from. See #551.
    this.repoRoot = REPO_ROOT;

    const groupConfig = options.toolGroups ?? loadToolGroupConfig(this.repoRoot);
    this.disabledTools = getDisabledTools(groupConfig);
    this.enabledToolNames = getEnabledToolNames(groupConfig);
    const disabledGroups = Object.entries(groupConfig)
      .filter(([, v]) => typeof v === 'boolean' && !v)
      .map(([k]) => k);
    if (disabledGroups.length > 0) {
      console.error(`[ToolGroups] Disabled groups: ${disabledGroups.join(', ')}`);
    }
    if (groupConfig.disabled_tools?.length) {
      console.error(`[ToolGroups] disabled_tools: ${groupConfig.disabled_tools.join(', ')}`);
    }
    if (groupConfig.enabled_tools?.length) {
      console.error(`[ToolGroups] enabled_tools (whitelist): ${groupConfig.enabled_tools.join(', ')}`);
    }

    // Hot reload: rebuild the disabled set in place when config changes.
    // The list/call handlers read this.disabledTools at request time, so
    // mutating it is enough — no re-registration of tool definitions needed.
    // Skip when toolGroups was passed explicitly (tests pin a config).
    if (!options.toolGroups && process.env.ORACLE_TOOL_GROUPS_HOT_RELOAD !== '0') {
      this.stopToolGroupsWatch = watchToolGroupConfig((next) => {
        const nextDisabled = getDisabledTools(next);
        this.disabledTools.clear();
        for (const t of nextDisabled) this.disabledTools.add(t);
        this.enabledToolNames = getEnabledToolNames(next);
        const disabledGroups = Object.entries(next)
          .filter(([, v]) => typeof v === 'boolean' && !v)
          .map(([k]) => k);
        const parts: string[] = [];
        if (disabledGroups.length) parts.push(`groups: ${disabledGroups.join(', ')}`);
        if (next.disabled_tools?.length) parts.push(`disabled_tools: ${next.disabled_tools.join(', ')}`);
        if (next.enabled_tools?.length) parts.push(`enabled_tools: ${next.enabled_tools.join(', ')}`);
        console.error(
          parts.length
            ? `[ToolGroups] Reloaded — ${parts.join(' | ')}`
            : '[ToolGroups] Reloaded — all tools enabled',
        );
      }, this.repoRoot);
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname || __dirname, '..', 'package.json'), 'utf-8'));
    this.version = pkg.version;
    this.server = new Server(
      { name: MCP_SERVER_NAME, version: this.version },
      { capabilities: { tools: {} } }
    );

    if (!this.oracleApiBase) {
      this.embeddedReady = this.initEmbedded();
    }

    this.setupHandlers();
    this.setupErrorHandling();
  }

  /** Build ToolContext from server state */
  private async getToolCtx(): Promise<ToolContext> {
    if (!this.embeddedReady) {
      this.embeddedReady = this.initEmbedded();
    }
    await this.embeddedReady;
    if (!this.sqlite || !this.db || !this.vectorStore) {
      throw new Error('Embedded Oracle resources failed to initialize');
    }
    return {
      db: this.db,
      sqlite: this.sqlite,
      repoRoot: this.repoRoot,
      vectorStore: this.vectorStore,
      vectorStatus: this.vectorStatus,
      version: this.version,
    };
  }

  private async initEmbedded(): Promise<void> {
    if (this.sqlite && this.db && this.vectorStore) return;

    const [{ createVectorStoreForModel, getEmbeddingModels }, { createDatabase }] = await Promise.all([
      import('./vector/factory.ts'),
      import('./db/index.ts'),
    ]);

    const models = getEmbeddingModels();
    this.vectorStore = createVectorStoreForModel(models['bge-m3']);

    const { sqlite, db } = createDatabase(DB_PATH);
    this.sqlite = sqlite;
    this.db = db;
    await this.verifyVectorHealth();
  }

  private async verifyVectorHealth(): Promise<void> {
    if (!this.vectorStore) {
      this.vectorStatus = 'unavailable';
      return;
    }
    try {
      const stats = await this.vectorStore.getStats();
      if (stats.count > 0) {
        this.vectorStatus = 'connected';
        console.error(`[VectorDB:${this.vectorStore.name}] ✓ oracle_knowledge: ${stats.count} documents`);
      } else {
        this.vectorStatus = 'connected';
        console.error(`[VectorDB:${this.vectorStore.name}] ✓ Connected but collection empty`);
      }
    } catch (e) {
      this.vectorStatus = 'unavailable';
      console.error(`[VectorDB:${this.vectorStore.name}] ✗ Cannot connect:`, e instanceof Error ? e.message : String(e));
    }
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup(): Promise<void> {
    this.sqlite?.close();
    await this.vectorStore?.close();
  }

  private async proxyToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResponse | null> {
    if (!this.oracleApiBase) return null;

    const proxyRequest = proxyRequestForTool(toolName, args);
    if (!proxyRequest) return null;

    const pathWithQuery = appendQuery(proxyRequest.path, proxyRequest.query);
    try {
      const response = await oracleApiFetch(this.oracleApiBase, pathWithQuery, {
        method: proxyRequest.method,
        headers: proxyRequest.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: proxyRequest.body === undefined ? undefined : JSON.stringify(proxyRequest.body),
      });

      const payload = await readHttpPayload(response);
      return httpPayloadToToolResponse(payload, !response.ok);
    } catch (err) {
      if (err instanceof OracleApiUnavailableError) {
        return httpPayloadToToolResponse(err.message, true);
      }
      throw err;
    }
  }

  private setupHandlers(): void {
    // ================================================================
    // List available tools
    // ================================================================
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools = [
        // Meta-documentation tool
        {
          name: '____IMPORTANT',
          description: `ORACLE WORKFLOW GUIDE (v${this.version}):\n\n1. SEARCH & DISCOVER\n   oracle_search(query) → Find knowledge by keywords/vectors\n   oracle_read(file/id) → Read full document content\n   oracle_list() → Browse all documents\n   oracle_concepts() → See topic coverage\n\n2. LEARN & REMEMBER\n   oracle_learn(pattern) → Add new patterns/learnings\n   oracle_thread(message) → Multi-turn discussions\n   ⚠️ BEFORE adding: search for similar topics first!\n   If updating old info → use oracle_supersede(oldId, newId)\n\n3. TRACE & DISTILL\n   oracle_trace(query) → Log discovery sessions with dig points\n   oracle_trace_list() → Find past traces\n   oracle_trace_get(id) → Explore dig points (files, commits, issues)\n   oracle_trace_link(prevId, nextId) → Chain related traces together\n   oracle_trace_chain(id) → View the full linked chain\n\n4. HANDOFF & INBOX\n   oracle_handoff(content) → Save session context for next session\n   oracle_inbox() → List pending handoffs\n\n5. SUPERSEDE (when info changes)\n   oracle_supersede(oldId, newId, reason) → Mark old doc as outdated\n   "Nothing is Deleted" — old preserved, just marked superseded\n\nPhilosophy: "Nothing is Deleted" — All interactions logged.`,
          inputSchema: { type: 'object', properties: {} }
        },
        // Core tools (from src/tools/)
        searchToolDef,
        readToolDef,
        learnToolDef,
        listToolDef,
        statsToolDef,
        conceptsToolDef,
        // Forum tools (from src/tools/forum.ts)
        ...forumToolDefs,
        // Trace tools (from src/tools/trace.ts)
        ...traceToolDefs,
        // Supersede, Handoff, Inbox
        supersedeToolDef,
        handoffToolDef,
        inboxToolDef,
        // Standalone tools (#972 wire — reflect + verify only; schedule kept HTTP-only)
        reflectToolDef,
        verifyToolDef,
      ];

      const byName = new Map(allTools.map((tool) => [tool.name, tool]));
      let tools = this.enabledToolNames
        .map((name) => byName.get(name))
        .filter((tool): tool is NonNullable<typeof tool> => !!tool)
        .filter(t => !this.disabledTools.has(t.name));
      if (this.readOnly) {
        tools = tools.filter(t => !WRITE_TOOLS.includes(t.name));
      }

      return { tools };
    });

    // ================================================================
    // Handle tool calls — route to extracted handlers
    // ================================================================
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      // Backward compat: arra_* → oracle_* aliasing (PR #1172 renamed the
      // tools; old callers keep working). See resolveToolName().
      const toolName = resolveToolName(request.params.name);

      if (this.disabledTools.has(toolName)) {
        return {
          content: [{
            type: 'text',
            text: `Error: Tool "${toolName}" is disabled by tool group config. Check ${ORACLE_DATA_DIR}/config.json or arra.config.json.`
          }],
          isError: true
        };
      }

      if (this.readOnly && WRITE_TOOLS.includes(toolName)) {
        return {
          content: [{
            type: 'text',
            text: `Error: Tool "${toolName}" is disabled in read-only mode. This Oracle instance is configured for read-only access.`
          }],
          isError: true
        };
      }

      try {
        const args = (request.params.arguments && typeof request.params.arguments === 'object')
          ? request.params.arguments as Record<string, unknown>
          : {};
        const proxied = await this.proxyToolCall(toolName, args);
        if (proxied) return proxied;

        switch (toolName) {
          // Core tools (delegated to src/tools/)
          case 'oracle_search': {
            const ctx = await this.getToolCtx();
            return await handleSearch(ctx, request.params.arguments as unknown as OracleSearchInput);
          }
          case 'oracle_read': {
            const ctx = await this.getToolCtx();
            return await handleRead(ctx, request.params.arguments as unknown as OracleReadInput);
          }
          case 'oracle_learn': {
            const ctx = await this.getToolCtx();
            return await handleLearn(ctx, request.params.arguments as unknown as OracleLearnInput);
          }
          case 'oracle_list': {
            const ctx = await this.getToolCtx();
            return await handleList(ctx, request.params.arguments as unknown as OracleListInput);
          }
          case 'oracle_stats': {
            const ctx = await this.getToolCtx();
            return await handleStats(ctx, request.params.arguments as unknown as OracleStatsInput);
          }
          case 'oracle_concepts': {
            const ctx = await this.getToolCtx();
            return await handleConcepts(ctx, request.params.arguments as unknown as OracleConceptsInput);
          }
          case 'oracle_supersede': {
            const ctx = await this.getToolCtx();
            return await handleSupersede(ctx, request.params.arguments as unknown as OracleSupersededInput);
          }
          case 'oracle_handoff': {
            const ctx = await this.getToolCtx();
            return await handleHandoff(ctx, request.params.arguments as unknown as OracleHandoffInput);
          }
          case 'oracle_inbox': {
            const ctx = await this.getToolCtx();
            return await handleInbox(ctx, request.params.arguments as unknown as OracleInboxInput);
          }
          // Forum tools (delegated to src/tools/forum.ts)
          case 'oracle_thread':
            return await handleThread(request.params.arguments as unknown as OracleThreadInput);
          case 'oracle_threads':
            return await handleThreads(request.params.arguments as unknown as OracleThreadsInput);
          case 'oracle_thread_read':
            return await handleThreadRead(request.params.arguments as unknown as OracleThreadReadInput);
          case 'oracle_thread_update':
            return await handleThreadUpdate(request.params.arguments as unknown as OracleThreadUpdateInput);

          // Trace tools (delegated to src/tools/trace.ts)
          case 'oracle_trace':
            return await handleTrace(request.params.arguments as unknown as CreateTraceInput);
          case 'oracle_trace_list':
            return await handleTraceList(request.params.arguments as unknown as ListTracesInput);
          case 'oracle_trace_get':
            return await handleTraceGet(request.params.arguments as unknown as GetTraceInput);
          case 'oracle_trace_link':
            return await handleTraceLink(request.params.arguments as unknown as { prevTraceId: string; nextTraceId: string });
          case 'oracle_trace_unlink':
            return await handleTraceUnlink(request.params.arguments as unknown as { traceId: string; direction: 'prev' | 'next' });
          case 'oracle_trace_chain':
            return await handleTraceChain(request.params.arguments as unknown as { traceId: string });

          // Standalone tools (#972 wire — reflect + verify; schedule kept HTTP-only)
          case 'oracle_reflect': {
            const ctx = await this.getToolCtx();
            return await handleReflect(ctx, request.params.arguments as unknown as OracleReflectInput);
          }
          case 'oracle_verify': {
            const ctx = await this.getToolCtx();
            return await handleVerify(ctx, request.params.arguments as unknown as OracleVerifyInput);
          }

          case '____IMPORTANT':
            return {
              content: [{
                type: 'text',
                text: `ORACLE WORKFLOW GUIDE (v${this.version})\n\n` +
                  `1. SEARCH & DISCOVER\n   arra_search(query) → keyword/vector search\n   arra_read(file/id) → full document\n   arra_list() → browse all\n   arra_concepts() → topic coverage\n\n` +
                  `2. LEARN & REMEMBER\n   arra_learn(pattern) → add a learning\n   arra_thread(message) → start/continue a thread\n   arra_supersede(oldId, newId) → mark outdated (Nothing is Deleted)\n\n` +
                  `3. TRACE & DISTILL\n   arra_trace(query) → log a discovery session\n   arra_trace_list() / arra_trace_get(id) / arra_trace_chain(id)\n   arra_trace_link(prev, next) / arra_trace_unlink(id, dir)\n\n` +
                  `4. HANDOFF & INBOX\n   arra_handoff(content) → save session context\n   arra_inbox() → list pending handoffs\n\n` +
                  `Philosophy: Nothing is Deleted — supersede, don't remove.`
              }]
            };

          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    });
  }

  async preConnectVector(): Promise<void> {
    if (this.oracleApiBase) {
      console.error('[Startup] Skipping vector pre-connect in HTTP-proxy mode');
      return;
    }
    await this.getToolCtx();
    if (!this.vectorStore) return;
    await this.vectorStore.connect();
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Arra Oracle MCP Server running on stdio (FTS5 mode)');
  }
}

async function main() {
  const readOnly = process.env.ORACLE_READ_ONLY === 'true' || process.argv.includes('--read-only');
  const server = new OracleMCPServer({ readOnly });

  try {
    console.error('[Startup] Pre-connecting to vector store...');
    await server.preConnectVector();
    console.error('[Startup] Vector store pre-connected successfully');
  } catch (e) {
    console.error('[Startup] Vector store pre-connect failed:', e instanceof Error ? e.message : e);
  }

  await server.run();
}

main().catch(console.error);
