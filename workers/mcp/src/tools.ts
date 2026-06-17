import { oracleProxyTool, type OracleMcpAuthContext, type OracleProxyEnv, type TextToolResult } from './proxy.ts';

type ToolInput = Record<string, unknown>;
type ToolHandler = (input: ToolInput) => Promise<TextToolResult>;
type ToolServer = {
  tool(name: string, description: string, schema: Record<string, unknown>, handler: ToolHandler): void;
};
type OptionalSchema = { optional(): unknown };
type StringSchema = OptionalSchema & { nullable(): OptionalSchema };
type ZodLike = {
  array(schema: unknown): unknown;
  enum(values: readonly [string, ...string[]]): OptionalSchema;
  number(): OptionalSchema;
  string(): StringSchema;
  union(values: readonly [unknown, unknown, ...unknown[]]): OptionalSchema;
};

export function registerOracleMcpTools(
  server: ToolServer,
  z: ZodLike,
  env: OracleProxyEnv,
  authContext?: OracleMcpAuthContext,
): void {
  const typeArg = optional(z.enum(['principle', 'pattern', 'learning', 'retro', 'all']));
  const modeArg = optional(z.enum(['hybrid', 'fts', 'vector']));
  const modelArg = optional(z.enum(['nomic', 'qwen3', 'bge-m3']));
  const tenantArg = z.string().optional();
  const conceptsArg = z.union([z.array(z.string()), z.string()]).optional();

  server.tool(
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
    async ({ query, tenantId, ...args }) => oracleProxyTool(env, {
      path: '/api/search',
      query: { q: query, ...args },
      tenantId,
      authContext,
    }),
  );

  server.tool(
    'muninn_stats',
    'Read Arra Oracle backend document, indexing, and vector status.',
    { tenantId: tenantArg },
    async ({ tenantId }) => oracleProxyTool(env, {
      path: '/api/stats',
      tenantId,
      authContext,
    }),
  );

  server.tool(
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
    async ({ tenantId, ...body }) => oracleProxyTool(env, {
      method: 'POST',
      path: '/api/learn',
      body,
      tenantId,
      authContext,
    }),
  );
}

function optional(schema: unknown): unknown {
  return hasOptional(schema) ? schema.optional() : schema;
}

function hasOptional(schema: unknown): schema is OptionalSchema {
  return typeof schema === 'object' && schema !== null && 'optional' in schema && typeof schema.optional === 'function';
}
