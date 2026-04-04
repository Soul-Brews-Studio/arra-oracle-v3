/**
 * MCP HTTP Transport Factory
 *
 * Creates per-request Server + WebStandardStreamableHTTPServerTransport instances
 * for stateless Streamable HTTP MCP endpoint at /mcp.
 *
 * Reuses the same tool definitions and handlers as src/index.ts (OracleMCPServer)
 * without the stdio transport. Uses module-level db/sqlite from src/db/index.ts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import path from 'path';
import fs from 'fs';

import { db, sqlite } from './db/index.ts';
import { createVectorStore } from './vector/factory.ts';
import type { VectorStoreAdapter } from './vector/types.ts';
import { loadToolGroupConfig, getDisabledTools } from './config/tool-groups.ts';
import { ORACLE_DATA_DIR, CHROMADB_DIR } from './config.ts';
import { MCP_SERVER_NAME } from './const.ts';
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

const WRITE_TOOLS = [
  'arra_learn',
  'arra_thread',
  'arra_thread_update',
  'arra_trace',
  'arra_supersede',
  'arra_handoff',
];

// Version (read once at module load — graceful fallback if package.json is missing)
let VERSION = '0.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname || '', '..', 'package.json'), 'utf-8'));
  VERSION = pkg.version ?? '0.0.0';
} catch {
  console.warn('[Oracle] Could not read package.json — using fallback version 0.0.0');
}

// Tool group config (read once at module load)
const repoRoot = process.env.ORACLE_REPO_ROOT || process.cwd();
const groupConfig = loadToolGroupConfig(repoRoot);
const disabledTools = getDisabledTools(groupConfig);
const readOnly = process.env.ORACLE_READ_ONLY === 'true';

// Lazy-initialized vector store shared across requests
let _vectorStore: VectorStoreAdapter | null = null;
let _vectorStatus: 'unknown' | 'connected' | 'unavailable' = 'unknown';

function getVectorStore(): VectorStoreAdapter {
  if (!_vectorStore) {
    _vectorStore = createVectorStore({ dataPath: CHROMADB_DIR });
    _vectorStore.connect().then(() => {
      _vectorStatus = 'connected';
    }).catch((err: unknown) => {
      console.error('[Oracle] Vector store connection failed:', err);
      _vectorStatus = 'unavailable';
    });
  }
  return _vectorStore;
}

const IMPORTANT_DESCRIPTION = `ORACLE WORKFLOW GUIDE (v${VERSION}):\n\n1. SEARCH & DISCOVER\n   arra_search(query) → Find knowledge by keywords/vectors\n   arra_read(file/id) → Read full document content\n   arra_list() → Browse all documents\n   arra_concepts() → See topic coverage\n\n2. LEARN & REMEMBER\n   arra_learn(pattern) → Add new patterns/learnings\n   arra_thread(message) → Multi-turn discussions\n   ⚠️ BEFORE adding: search for similar topics first!\n   If updating old info → use arra_supersede(oldId, newId)\n\n3. TRACE & DISTILL\n   arra_trace(query) → Log discovery sessions with dig points\n   arra_trace_list() → Find past traces\n   arra_trace_get(id) → Explore dig points (files, commits, issues)\n   arra_trace_link(prevId, nextId) → Chain related traces together\n   arra_trace_chain(id) → View the full linked chain\n\n4. HANDOFF & INBOX\n   arra_handoff(content) → Save session context for next session\n   arra_inbox() → List pending handoffs\n\n5. SUPERSEDE (when info changes)\n   arra_supersede(oldId, newId, reason) → Mark old doc as outdated\n   "Nothing is Deleted" — old preserved, just marked superseded\n\nPhilosophy: "Nothing is Deleted" — All interactions logged.`;

/**
 * Creates an MCP Server with all Oracle tools registered.
 * Called once per HTTP request (stateless mode).
 */
function createMcpServer(): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: VERSION },
    { capabilities: { tools: {} } }
  );

  const vs = getVectorStore();
  // Use a getter so each tool invocation reads the live _vectorStatus
  // instead of the snapshot captured at server-creation time.
  const toolCtx = {
    db,
    sqlite,
    repoRoot,
    vectorStore: vs,
    get vectorStatus() { return _vectorStatus; },
    version: VERSION,
  } satisfies ToolContext;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools = [
      { name: '____IMPORTANT', description: IMPORTANT_DESCRIPTION, inputSchema: { type: 'object', properties: {} } },
      searchToolDef,
      readToolDef,
      learnToolDef,
      listToolDef,
      statsToolDef,
      conceptsToolDef,
      ...forumToolDefs,
      ...traceToolDefs,
      supersedeToolDef,
      handoffToolDef,
      inboxToolDef,
    ];

    let tools = allTools.filter(t => !disabledTools.has(t.name));
    if (readOnly) {
      tools = tools.filter(t => !WRITE_TOOLS.includes(t.name));
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    if (disabledTools.has(request.params.name)) {
      return {
        content: [{ type: 'text', text: `Error: Tool "${request.params.name}" is disabled by tool group config. Check ${ORACLE_DATA_DIR}/config.json or arra.config.json.` }],
        isError: true,
      };
    }

    if (readOnly && WRITE_TOOLS.includes(request.params.name)) {
      return {
        content: [{ type: 'text', text: `Error: Tool "${request.params.name}" is disabled in read-only mode.` }],
        isError: true,
      };
    }

    try {
      switch (request.params.name) {
        case 'arra_search':
          return await handleSearch(toolCtx, request.params.arguments as unknown as OracleSearchInput);
        case 'arra_read':
          return await handleRead(toolCtx, request.params.arguments as unknown as OracleReadInput);
        case 'arra_learn':
          return await handleLearn(toolCtx, request.params.arguments as unknown as OracleLearnInput);
        case 'arra_list':
          return await handleList(toolCtx, request.params.arguments as unknown as OracleListInput);
        case 'arra_stats':
          return await handleStats(toolCtx, request.params.arguments as unknown as OracleStatsInput);
        case 'arra_concepts':
          return await handleConcepts(toolCtx, request.params.arguments as unknown as OracleConceptsInput);
        case 'arra_supersede':
          return await handleSupersede(toolCtx, request.params.arguments as unknown as OracleSupersededInput);
        case 'arra_handoff':
          return await handleHandoff(toolCtx, request.params.arguments as unknown as OracleHandoffInput);
        case 'arra_inbox':
          return await handleInbox(toolCtx, request.params.arguments as unknown as OracleInboxInput);
        case 'arra_thread':
          return await handleThread(request.params.arguments as unknown as OracleThreadInput);
        case 'arra_threads':
          return await handleThreads(request.params.arguments as unknown as OracleThreadsInput);
        case 'arra_thread_read':
          return await handleThreadRead(request.params.arguments as unknown as OracleThreadReadInput);
        case 'arra_thread_update':
          return await handleThreadUpdate(request.params.arguments as unknown as OracleThreadUpdateInput);
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
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Handles an incoming MCP HTTP request.
 * Creates a fresh Server + transport per request (stateless mode).
 * Call this from the Hono /mcp route after auth passes.
 */
export async function createMcpHandler(request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking
    enableJsonResponse: true,
  });
  const server = createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(request);
}
