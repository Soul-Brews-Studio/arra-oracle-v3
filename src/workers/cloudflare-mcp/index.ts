import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentContext } from 'agents';
import { McpAgent } from 'agents/mcp';
import { z } from 'zod';
import {
  healthResponse,
  landingResponse,
  runRemoteOracleHealth,
  runRemoteOracleSearch,
  type OracleMcpEnv,
} from './tools.ts';

export interface WorkerEnv extends OracleMcpEnv {
  MCP_OBJECT: unknown;
}

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
  props?: unknown;
};

const searchSchema = {
  query: z.string().min(1),
  type: z.enum(['principle', 'pattern', 'learning', 'retro', 'all']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
  mode: z.enum(['hybrid', 'fts', 'vector']).optional(),
  project: z.string().optional(),
  cwd: z.string().optional(),
  model: z.enum(['nomic', 'qwen3', 'bge-m3']).optional(),
};

export class OracleMcpAgent extends McpAgent<WorkerEnv, unknown, Record<string, unknown>> {
  server = new McpServer({ name: 'arra-oracle-remote-mcp', version: '1.0.0' });
  private readonly workerEnv: WorkerEnv;

  constructor(ctx: AgentContext, env: WorkerEnv) {
    super(ctx, env);
    this.workerEnv = env;
  }

  async init() {
    this.server.registerTool(
      'oracle_health',
      { description: 'Report Cloudflare Worker remote MCP configuration and backend status.' },
      async () => runRemoteOracleHealth(this.workerEnv),
    );

    this.server.registerTool(
      'oracle_search',
      {
        description: 'Search Oracle through the configured ORACLE_HTTP_URL backend from Cloudflare Workers.',
        inputSchema: searchSchema,
      },
      async (args) => runRemoteOracleSearch(this.workerEnv, args as Record<string, unknown>),
    );

    this.server.registerTool(
      'muninn_search',
      {
        description: 'Backward-compatible alias for oracle_search on the remote MCP Worker.',
        inputSchema: searchSchema,
      },
      async (args) => runRemoteOracleSearch(this.workerEnv, args as Record<string, unknown>),
    );
  }
}

const streamableHandler = OracleMcpAgent.serve('/mcp', { binding: 'MCP_OBJECT' });
const sseHandler = OracleMcpAgent.serveSSE('/sse', { binding: 'MCP_OBJECT' });

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/' && request.method === 'GET') return landingResponse(request, env);
    if (pathname === '/health' || pathname === '/api/health') return healthResponse(env);
    if (pathname.startsWith('/sse')) return sseHandler.fetch(request, env, ctx as never);
    if (pathname.startsWith('/mcp')) return streamableHandler.fetch(request, env, ctx as never);
    return new Response('Not found. Use /mcp for MCP or /health for readiness.\n', { status: 404 });
  },
};
