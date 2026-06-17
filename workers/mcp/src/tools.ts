import { remoteableMcpRestMap, type McpRestBodyMode, type RemoteableMcpRestEntry } from '../../../src/tools/mcp-rest-map.ts';
import { oracleProxyTool, type OracleMcpAuthContext, type OracleProxyEnv, type ProxyRequest, type TextToolResult } from './proxy.ts';

type ToolInput = Record<string, unknown>;
type ToolHandler = (input: ToolInput) => Promise<TextToolResult>;
type ToolServer = {
  tool(name: string, description: string, schema: Record<string, unknown>, handler: ToolHandler): void;
};
type OptionalSchema = { optional(): unknown };
type AnySchema = OptionalSchema;
type StringSchema = OptionalSchema & { nullable(): OptionalSchema };
type ZodLike = {
  any(): AnySchema;
  array(schema: unknown): unknown;
  boolean(): OptionalSchema;
  enum(values: readonly [string, ...string[]]): OptionalSchema;
  number(): OptionalSchema;
  string(): StringSchema;
  union(values: readonly [unknown, unknown, ...unknown[]]): OptionalSchema;
};

const TENANT_ARG = 'tenantId';
const NUMBER_ARGS = new Set(['limit', 'offset', 'threadId', 'agentCount', 'durationMs']);
const BOOLEAN_ARGS = new Set(['check', 'includeChain', 'promoteToLearning', 'reopen']);
const ARRAY_ARGS = new Set(['concepts', 'foundFiles', 'foundCommits', 'foundIssues', 'foundRetrospectives', 'foundLearnings']);
const BODY_FIELDS: Record<string, readonly string[]> = {
  oracle_handoff: ['content', 'slug'],
  oracle_learn: ['pattern', 'source', 'concepts', 'project', 'cwd'],
  oracle_supersede: ['oldId', 'newId', 'reason'],
  oracle_trace: ['query', 'queryType', 'foundFiles', 'foundCommits', 'foundIssues', 'foundRetrospectives', 'foundLearnings', 'scope', 'parentTraceId', 'project', 'agentCount', 'durationMs'],
  oracle_verify: ['check', 'type'],
};

export const workerMcpToolEntries = remoteableMcpRestMap;

export function registerOracleMcpTools(
  server: ToolServer,
  z: ZodLike,
  env: OracleProxyEnv,
  authContext?: OracleMcpAuthContext,
): void {
  for (const entry of workerMcpToolEntries) {
    server.tool(entry.name, descriptionFor(entry), schemaFor(entry, z), async (input) => {
      const request = proxyRequestFromEntry(entry, input, authContext);
      return request
        ? oracleProxyTool(env, request)
        : toolError(`Missing required argument for ${entry.name}`);
    });
  }
}

export function proxyRequestFromEntry(
  entry: RemoteableMcpRestEntry,
  input: ToolInput,
  authContext?: OracleMcpAuthContext,
): ProxyRequest | null {
  const path = pathFor(entry, input);
  if (!path) return null;
  const body = bodyFor(entry.body, input);
  return {
    method: entry.method,
    path,
    query: queryFor(entry, input),
    body,
    tenantId: input[TENANT_ARG],
    authContext,
  };
}

function descriptionFor(entry: RemoteableMcpRestEntry): string {
  return `Proxy ${entry.name} to the Arra Oracle backend REST endpoint ${entry.method} ${entry.path}.`;
}

function schemaFor(entry: RemoteableMcpRestEntry, z: ZodLike): Record<string, unknown> {
  const schema: Record<string, unknown> = { [TENANT_ARG]: optional(z.string()) };
  for (const arg of argsFor(entry)) schema[arg] = optional(schemaNode(arg, z));
  return schema;
}

function argsFor(entry: RemoteableMcpRestEntry): string[] {
  return [...new Set([
    ...(entry.pathParams ?? []),
    ...(entry.query ?? []).map((binding) => binding.arg),
    ...(entry.body ? bodyArgs(entry.name, entry.body) : []),
  ])];
}

function bodyArgs(name: string, mode: McpRestBodyMode): readonly string[] {
  if (mode === 'thread-message') return ['message', 'threadId', 'title', 'role', 'model', 'reopen'];
  if (mode === 'thread-status') return ['threadId', 'status'];
  if (mode === 'trace-link') return ['prevTraceId', 'nextTraceId'];
  if (mode === 'trace-distill') return ['traceId', 'awakening', 'promoteToLearning', 'oracle', 'theme', 'concepts', 'source', 'finding', 'metadata'];
  return BODY_FIELDS[name] ?? [];
}

function schemaNode(arg: string, z: ZodLike): unknown {
  if (NUMBER_ARGS.has(arg)) return z.number();
  if (BOOLEAN_ARGS.has(arg)) return z.boolean();
  if (ARRAY_ARGS.has(arg)) return z.union([z.array(z.any()), z.string()]);
  if (arg === 'type') return z.enum(['principle', 'pattern', 'learning', 'retro', 'all']);
  if (arg === 'mode') return z.enum(['hybrid', 'fts', 'vector']);
  if (arg === 'model') return z.enum(['nomic', 'qwen3', 'bge-m3']);
  return z.any();
}

function queryFor(entry: RemoteableMcpRestEntry, input: ToolInput): Record<string, unknown> | undefined {
  const query: Record<string, unknown> = {};
  for (const binding of entry.query ?? []) query[binding.param] = input[binding.arg];
  for (const binding of entry.staticQuery ?? []) query[binding.param] = binding.value;
  return Object.keys(query).length ? query : undefined;
}

function pathFor(entry: RemoteableMcpRestEntry, input: ToolInput): string | null {
  const sourcePath = entry.name === 'oracle_trace_get' && input.includeChain === true
    ? entry.pathVariants?.[0] ?? entry.path
    : entry.path;
  let path = sourcePath;
  for (const param of entry.pathParams ?? []) {
    const value = cleanPathValue(input[param]);
    if (!value && path.includes(`:${param}?`)) {
      path = path.replace(new RegExp(`/?:${param}\\?`), '');
      continue;
    }
    if (!value) return null;
    path = path.replace(`:${param}?`, encodeURIComponent(value)).replace(`:${param}`, encodeURIComponent(value));
  }
  return path;
}

function bodyFor(mode: McpRestBodyMode | undefined, input: ToolInput): unknown {
  if (!mode) return undefined;
  if (mode === 'thread-message') {
    return { message: input.message, thread_id: input.threadId, title: input.title, role: input.role ?? 'claude', model: input.model, reopen: input.reopen };
  }
  if (mode === 'thread-status') return { status: input.status };
  if (mode === 'trace-link') return { nextId: input.nextTraceId };
  const body = { ...input };
  delete body[TENANT_ARG];
  if (mode === 'trace-distill') delete body.traceId;
  return body;
}

function cleanPathValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function optional(schema: unknown): unknown {
  return hasOptional(schema) ? schema.optional() : schema;
}

function hasOptional(schema: unknown): schema is OptionalSchema {
  return typeof schema === 'object' && schema !== null && 'optional' in schema && typeof schema.optional === 'function';
}

function toolError(text: string): TextToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
