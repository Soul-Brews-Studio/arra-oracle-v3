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
import { Database } from 'bun:sqlite';
import * as schema from './db/schema.ts';
import { createDatabase } from './db/index.ts';
import { createVectorStore } from './vector/factory.ts';
import type { VectorStoreAdapter } from './vector/types.ts';
import path from 'path';
import fs from 'fs';
import { loadToolGroupConfig, getDisabledTools, type ToolGroupConfig } from './config/tool-groups.ts';
import { ORACLE_DATA_DIR, DB_PATH, LANCEDB_DIR } from './config.ts';
import { MCP_SERVER_NAME } from './const.ts';

// Tool handlers (all extracted to src/tools/)
import type { ToolContext } from './tools/types.ts';
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
} from './tools/index.ts';

import type {
  CreateTraceInput,
  ListTracesInput,
  GetTraceInput,
} from './trace/types.ts';

// Write tools that should be disabled in read-only mode
const WRITE_TOOLS = [
  'arra_learn',
  'arra_thread',
  'arra_thread_update',
  'arra_trace',
  'arra_supersede',
  'arra_handoff',
];

class OracleMCPServer {
  private server: Server;
  private sqlite: Database;
  private db: BunSQLiteDatabase<typeof schema>;
  private repoRoot: string;
  private vectorStore: VectorStoreAdapter;
  private vectorStatus: 'unknown' | 'connected' | 'unavailable' = 'unknown';
  private readOnly: boolean;
  private version: string;
  private disabledTools: Set<string>;

  constructor(options: { readOnly?: boolean; toolGroups?: ToolGroupConfig } = {}) {
    this.readOnly = options.readOnly ?? false;
    if (this.readOnly) {
      console.error('[Oracle] Running in READ-ONLY mode');
    }
    this.repoRoot = process.env.ORACLE_REPO_ROOT || process.cwd();

    const groupConfig = options.toolGroups ?? loadToolGroupConfig(this.repoRoot);
    this.disabledTools = getDisabledTools(groupConfig);
    const disabledGroups = Object.entries(groupConfig).filter(([, v]) => !v).map(([k]) => k);
    if (disabledGroups.length > 0) {
      console.error(`[ToolGroups] Disabled: ${disabledGroups.join(', ')}`);
    }

    this.vectorStore = createVectorStore({
      dataPath: LANCEDB_DIR,
    });

    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname || __dirname, '..', 'package.json'), 'utf-8'));
    this.version = pkg.version;
    this.server = new Server(
      { name: MCP_SERVER_NAME, version: this.version },
      { capabilities: { tools: {} } }
    );

    const { sqlite, db } = createDatabase(DB_PATH);
    this.sqlite = sqlite;
    this.db = db;

    this.setupHandlers();
    this.setupErrorHandling();
    this.verifyVectorHealth();
  }

  /** Build ToolContext from server state */
  private get toolCtx(): ToolContext {
    return {
      db: this.db,
      sqlite: this.sqlite,
      repoRoot: this.repoRoot,
      vectorStore: this.vectorStore,
      vectorStatus: this.vectorStatus,
      version: this.version,
    };
  }

  private async verifyVectorHealth(): Promise<void> {
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
    this.sqlite.close();
    await this.vectorStore.close();
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
          description: `ORACLE WORKFLOW GUIDE (v${this.version}):\n\n1. SEARCH & DISCOVER\n   arra_search(query) → Find knowledge by keywords/vectors\n   arra_read(file/id) → Read full document content\n   arra_list() → Browse all documents\n   arra_concepts() → See topic coverage\n\n2. LEARN & REMEMBER\n   arra_learn(pattern) → Add new patterns/learnings\n   arra_thread(message) → Multi-turn discussions\n   ⚠️ BEFORE adding: search for similar topics first!\n   If updating old info → use arra_supersede(oldId, newId)\n\n3. TRACE & DISTILL\n   arra_trace(query) → Log discovery sessions with dig points\n   arra_trace_list() → Find past traces\n   arra_trace_get(id) → Explore dig points (files, commits, issues)\n   arra_trace_link(prevId, nextId) → Chain related traces together\n   arra_trace_chain(id) → View the full linked chain\n\n4. HANDOFF & INBOX\n   arra_handoff(content) → Save session context for next session\n   arra_inbox() → List pending handoffs\n\n5. SUPERSEDE (when info changes)\n   arra_supersede(oldId, newId, reason) → Mark old doc as outdated\n   "Nothing is Deleted" — old preserved, just marked superseded\n\nPhilosophy: "Nothing is Deleted" — All interactions logged.`,
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
        // Supersede, Handoff, Inbox, Verify
        supersedeToolDef,
        handoffToolDef,
        inboxToolDef,
      ];

      let tools = allTools.filter(t => !this.disabledTools.has(t.name));
      if (this.readOnly) {
        tools = tools.filter(t => !WRITE_TOOLS.includes(t.name));
      }

      return { tools };
    });

    // ================================================================
    // Handle tool calls — route to extracted handlers
    // ================================================================
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      if (this.disabledTools.has(request.params.name)) {
        return {
          content: [{
            type: 'text',
            text: `Error: Tool "${request.params.name}" is disabled by tool group config. Check ${ORACLE_DATA_DIR}/config.json or arra.config.json.`
          }],
          isError: true
        };
      }

      if (this.readOnly && WRITE_TOOLS.includes(request.params.name)) {
        return {
          content: [{
            type: 'text',
            text: `Error: Tool "${request.params.name}" is disabled in read-only mode. This Oracle instance is configured for read-only access.`
          }],
          isError: true
        };
      }

      const ctx = this.toolCtx;

      try {
        switch (request.params.name) {
          // Core tools (delegated to src/tools/)
          case 'arra_search':
            return await handleSearch(ctx, request.params.arguments as unknown as OracleSearchInput);
          case 'arra_read':
            return await handleRead(ctx, request.params.arguments as unknown as OracleReadInput);
          case 'arra_learn':
            return await handleLearn(ctx, request.params.arguments as unknown as OracleLearnInput);
          case 'arra_list':
            return await handleList(ctx, request.params.arguments as unknown as OracleListInput);
          case 'arra_stats':
            return await handleStats(ctx, request.params.arguments as unknown as OracleStatsInput);
          case 'arra_concepts':
            return await handleConcepts(ctx, request.params.arguments as unknown as OracleConceptsInput);
          case 'arra_supersede':
            return await handleSupersede(ctx, request.params.arguments as unknown as OracleSupersededInput);
          case 'arra_handoff':
            return await handleHandoff(ctx, request.params.arguments as unknown as OracleHandoffInput);
          case 'arra_inbox':
            return await handleInbox(ctx, request.params.arguments as unknown as OracleInboxInput);
          // Forum tools (delegated to src/tools/forum.ts)
          case 'arra_thread':
            return await handleThread(request.params.arguments as unknown as OracleThreadInput);
          case 'arra_threads':
            return await handleThreads(request.params.arguments as unknown as OracleThreadsInput);
          case 'arra_thread_read':
            return await handleThreadRead(request.params.arguments as unknown as OracleThreadReadInput);
          case 'arra_thread_update':
            return await handleThreadUpdate(request.params.arguments as unknown as OracleThreadUpdateInput);

          // Trace tools (delegated to src/tools/trace.ts)
          case 'arra_trace':
            return await handleTrace(request.params.arguments as unknown as CreateTraceInput);
          case 'arra_trace_list':
            return await handleTraceList(request.params.arguments as unknown as ListTracesInput);
          case 'arra_trace_get':
            return await handleTraceGet(request.params.arguments as unknown as GetTraceInput);
          case 'arra_trace_link':
            return await handleTraceLink(request.params.arguments as unknown as { prevTraceId: string; nextTraceId: string });
          case 'arra_trace_unlink':
            return await handleTraceUnlink(request.params.arguments as unknown as { traceId: string; direction: 'prev' | 'next' });
          case 'arra_trace_chain':
            return await handleTraceChain(request.params.arguments as unknown as { traceId: string });

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
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
