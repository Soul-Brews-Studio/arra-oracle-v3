import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveTenantIdForRequest, type OAuthTenantAuthContext } from './oauth-tenant.ts';
import { oracleProxyTool, type OracleProxyEnv, type TextToolResult } from './proxy.ts';

type Env = OracleProxyEnv;
type AuthContext = OAuthTenantAuthContext;

const typeArg = z.enum(['principle', 'pattern', 'learning', 'retro', 'all']).optional();
const modeArg = z.enum(['hybrid', 'fts', 'vector']).optional();
const modelArg = z.enum(['nomic', 'qwen3', 'bge-m3']).optional();
const tenantArg = z.string().optional();
const conceptsArg = z.union([z.array(z.string()), z.string()]).optional();

function tenantErrorResult(error: string): TextToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error }, null, 2) }],
    isError: true,
  };
}

export class OracleMCP extends McpAgent<Env, unknown, AuthContext> {
  server = new McpServer({ name: 'arra-oracle', version: '1.0.0' });

  private resolveTenant(requestedTenantId?: unknown): { tenantId?: string; error?: TextToolResult } {
    const resolved = resolveTenantIdForRequest(this.props, requestedTenantId);
    return resolved.error
      ? { error: tenantErrorResult(resolved.error) }
      : { tenantId: resolved.tenantId };
  }

  async init() {
    this.server.tool(
      'muninn_search',
      'Search the Arra Oracle knowledge backend through the Cloudflare MCP proxy.',
      {
        query: z.string(),
        type: typeArg,
        limit: z.number().optional(),
        offset: z.number().optional(),
        mode: modeArg,
        project: z.string().optional(),
        cwd: z.string().optional(),
        model: modelArg,
        tenantId: tenantArg,
      },
      async ({ query, tenantId, ...args }) => {
        const tenant = this.resolveTenant(tenantId);
        if (tenant.error) return tenant.error;
        return oracleProxyTool(this.env, {
          path: '/api/search',
          query: { q: query, ...args },
          tenantId: tenant.tenantId,
        });
      },
    );

    this.server.tool(
      'muninn_stats',
      'Read Arra Oracle backend document, indexing, and vector status.',
      { tenantId: tenantArg },
      async ({ tenantId }) => {
        const tenant = this.resolveTenant(tenantId);
        if (tenant.error) return tenant.error;
        return oracleProxyTool(this.env, {
          path: '/api/stats',
          tenantId: tenant.tenantId,
        });
      },
    );

    this.server.tool(
      'oracle_learn',
      'Record a learning in the Arra Oracle backend through the Cloudflare MCP proxy.',
      {
        pattern: z.string(),
        concepts: conceptsArg,
        source: z.string().optional(),
        origin: z.string().nullable().optional(),
        project: z.string().nullable().optional(),
        cwd: z.string().optional(),
        tenantId: tenantArg,
      },
      async ({ tenantId, ...body }) => {
        const tenant = this.resolveTenant(tenantId);
        if (tenant.error) return tenant.error;
        return oracleProxyTool(this.env, {
          method: 'POST',
          path: '/api/learn',
          body,
          tenantId: tenant.tenantId,
        });
      },
    );
  }
}

export default OracleMCP.serve('/mcp');
