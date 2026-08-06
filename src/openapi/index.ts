import type { ElysiaSwaggerConfig } from '@elysiajs/swagger';
import pkg from '../../package.json' with { type: 'json' };
import { documentMemoryOpenApi } from './memory.ts';

export const OPENAPI_INTERNAL_SPEC_PATH = '/api/docs/__raw.json';

const METHODS = ['get', 'put', 'post', 'delete', 'head', 'patch', 'trace'] as const;
const TAGS: Record<string, string> = {
  ask: 'Cited oracle question answering.',
  auth: 'Login, logout, and session status.',
  canvas: 'Canvas plugin registry endpoints.',
  dashboard: 'Dashboard summaries and trends.',
  export: 'Data export, import, and export jobs.',
  feed: 'Local and remote event feed.',
  files: 'Repository file and graph inspection.',
  forum: 'Forum threads and statuses.',
  gateway: 'Gateway proxy status and upstream health.',
  health: 'Runtime health and profile checks.',
  indexer: 'Indexer scans, jobs, and configuration.',
  knowledge: 'Learnings, inbox, handoffs, and research notes.',
  mcp: 'MCP transport and tool discovery.',
  memory: 'Persisted memory save and recall.',
  menu: 'Navigation menu registry.',
  metrics: 'Prometheus-compatible service metrics.',
  plugins: 'Plugin registries and toggles.',
  schedule: 'Scheduled work records.',
  search: 'Search, reflection, concepts, and verification.',
  sessions: 'Session summaries.',
  settings: 'Runtime settings and tool configuration.',
  supersede: 'Document supersession chains.',
  system: 'Root service metadata.',
  tenants: 'Tenant registry and isolation controls.',
  traces: 'Trace capture, links, and distillation.',
  vault: 'Vault sync operations.',
  vector: 'Vector search, config, exports, and maps.',
  'vector-indexer': 'Vector model indexing jobs.',
  'vector-registry': 'Registered vector sidecar services.',
  watcher: 'Learning file watcher lifecycle.',
};

type Spec = Record<string, any>;
type RouteLike = { method: string; path: string; hooks?: { detail?: { hide?: boolean } } };

export function createOpenApiSwaggerConfig(version = pkg.version): ElysiaSwaggerConfig<'/api/docs'> {
  return {
    provider: 'swagger-ui',
    path: '/api/docs',
    specPath: OPENAPI_INTERNAL_SPEC_PATH,
    swaggerOptions: { url: '/api/docs/json', persistAuthorization: true } as any,
    documentation: {
      info: {
        title: 'Arra Oracle API',
        version,
        description: 'HTTP API for the Arra Oracle MCP memory and search layer.',
      },
      servers: [{ url: '/api/v1', description: 'Canonical versioned API prefix' }],
      tags: Object.entries(TAGS).map(([name, description]) => ({ name, description })),
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'ARRA_API_TOKEN' },
        },
      },
    },
  };
}

export function openApiSpecHandler(app: { handle: (request: Request) => Response | Promise<Response>; routes: RouteLike[] }) {
  return async () => {
    const response = await app.handle(new Request(`http://openapi.local${OPENAPI_INTERNAL_SPEC_PATH}`));
    const payload = await response.json() as Spec;
    const raw = payload?.openapi ? payload : payload?.data ?? payload;
    return Response.json(documentOpenApiSpec(raw, app.routes));
  };
}

export function documentOpenApiSpec(raw: Spec, routes: RouteLike[] = []): Spec {
  const spec = structuredClone(raw) as Spec;
  spec.paths ??= {};
  spec.components ??= {};
  spec.components.securitySchemes = {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'ARRA_API_TOKEN' },
    ...spec.components.securitySchemes,
  };
  spec.tags = mergeTags(spec.tags, spec.paths);

  for (const route of documentedRoutes(routes)) {
    const pathItem = spec.paths[route.path];
    const op = pathItem?.[route.method];
    if (!op) continue;
    completeOperation(op, route.method, route.path, spec.components);
  }
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of METHODS) {
      const op = (pathItem as Spec)[method];
      if (op) completeOperation(op, method, path, spec.components);
    }
  }
  documentMemoryOpenApi(spec);
  spec.tags = mergeTags(spec.tags, spec.paths);
  return spec;
}

export function findOpenApiCompletenessGaps(spec: Spec, routes: RouteLike[] = []) {
  const missingRoutes: string[] = [];
  const missingSummaries: string[] = [];
  const missingExamples: string[] = [];
  for (const route of documentedRoutes(routes)) {
    const op = spec.paths?.[route.path]?.[route.method];
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (!op) { missingRoutes.push(key); continue; }
    if (!op.summary && !op.description) missingSummaries.push(key);
    if (!operationHasExample(op)) missingExamples.push(key);
  }
  return { missingRoutes, missingSummaries, missingExamples };
}

function documentedRoutes(routes: RouteLike[]) {
  const allowed = new Set(METHODS.map((method) => method.toUpperCase()));
  return routes.flatMap((route) => {
    if (route.hooks?.detail?.hide === true || !allowed.has(route.method)) return [];
    if (route.path.includes('*') || route.path.includes('.')) return [];
    return [{ method: route.method.toLowerCase(), path: toOpenApiPath(route.path) }];
  });
}

function toOpenApiPath(path: string): string {
  return path.split('/').map((part) => part.startsWith(':') ? `{${part.slice(1).replace(/\?$/, '')}}` : part).join('/');
}

function completeOperation(op: Spec, method: string, path: string, components: Spec): void {
  op.tags = Array.isArray(op.tags) && op.tags.length ? op.tags : [inferTag(path)];
  op.summary ||= summaryFor(method, path);
  op.description ||= op.summary;
  if (path.startsWith('/api/') && !path.startsWith('/api/health') && !path.startsWith('/api/docs')) op.security ??= [{ bearerAuth: [] }];
  for (const param of op.parameters ?? []) if (!hasExample(param)) param.example = exampleFromSchema(param.schema, components, param.name);
  addRequestExamples(op.requestBody, components, fallbackFor(method, path));
  const responses = op.responses ??= { 200: { description: 'Successful response' } };
  const code = responses['200'] ? '200' : Object.keys(responses)[0] ?? '200';
  responses[code] ??= { description: 'Response' };
  for (const [status, response] of Object.entries(responses) as [string, Spec][]) {
    response.description ||= status.startsWith('2') ? 'Successful response' : 'Error response';
    if (!response.content) response.content = { 'application/json': { example: fallbackFor(method, path) } };
    addContentExamples(response.content, components, fallbackFor(method, path));
  }
  op['x-codeSamples'] ??= [{ lang: 'curl', label: 'curl', source: curlFor(method, path) }];
}

function addRequestExamples(requestBody: Spec | undefined, components: Spec, fallback: unknown): void {
  if (requestBody?.content) addContentExamples(requestBody.content, components, fallback);
}

function addContentExamples(content: Spec, components: Spec, fallback: unknown): void {
  for (const [type, media] of Object.entries(content) as [string, Spec][]) {
    if (hasExample(media)) continue;
    media.example = exampleForMedia(type, media.schema, components, fallback);
  }
}

function operationHasExample(op: Spec): boolean {
  if (Array.isArray(op['x-codeSamples']) && op['x-codeSamples'].length) return true;
  const bodies = [op.requestBody, ...Object.values(op.responses ?? {})] as Spec[];
  return bodies.some((body) => Object.values(body?.content ?? {}).some((media) => hasExample(media as Spec)));
}

function hasExample(value: Spec | undefined): boolean {
  return Boolean(value && ('example' in value || 'examples' in value));
}

function exampleForMedia(type: string, schema: Spec | undefined, components: Spec, fallback: unknown): unknown {
  if (type.includes('csv')) return 'id,title\nexample,Example row\n';
  if (type.includes('markdown')) return '# Example\n\nExported content.\n';
  if (type.includes('text')) return 'Example response';
  if (type.includes('ndjson')) return '{"id":"example"}\n';
  return exampleFromSchema(schema, components) ?? fallback;
}

function exampleFromSchema(schema: Spec | undefined, components: Spec, name = 'value', seen = new Set<string>()): unknown {
  if (!schema || typeof schema !== 'object') return fallbackScalar(name);
  if ('example' in schema) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if ('default' in schema) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if ('const' in schema) return schema.const;
  if (schema.$ref) return refExample(schema.$ref, components, name, seen);
  const branch = schema.anyOf?.[0] ?? schema.oneOf?.[0] ?? schema.allOf?.[0];
  if (branch) return exampleFromSchema(branch, components, name, seen);
  const type = Array.isArray(schema.type) ? schema.type.find((item: string) => item !== 'null') : schema.type;
  if (type === 'array') return [exampleFromSchema(schema.items, components, singular(name), seen)];
  if (type === 'object' || schema.properties) {
    const entries = Object.entries(schema.properties ?? {}).slice(0, 8);
    return Object.fromEntries(entries.map(([key, value]) => [key, exampleFromSchema(value as Spec, components, key, seen)]));
  }
  if (type === 'integer' || type === 'number') return /count|total|limit|days|size|bytes/i.test(name) ? 1 : 42;
  if (type === 'boolean') return true;
  return fallbackScalar(name);
}

function refExample(ref: string, components: Spec, name: string, seen: Set<string>): unknown {
  if (seen.has(ref)) return fallbackScalar(name);
  seen.add(ref);
  const key = ref.replace('#/components/schemas/', '');
  return exampleFromSchema(components.schemas?.[key], components, name, seen);
}

function fallbackScalar(name: string): string {
  if (/id$/i.test(name)) return 'example-id';
  if (/url|href/i.test(name)) return 'https://example.com';
  if (/at|date|time/i.test(name)) return '2026-06-17T00:00:00.000Z';
  if (/email/i.test(name)) return 'oracle@example.com';
  if (/password|token|secret/i.test(name)) return 'example-secret';
  return `example-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

function fallbackFor(method: string, path: string): Spec {
  return { success: true, method: method.toUpperCase(), path };
}

function inferTag(path: string): string {
  if (path === '/') return 'system';
  return path.split('/').filter(Boolean).find((part) => part !== 'api') ?? 'system';
}

function summaryFor(method: string, path: string): string {
  const noun = path === '/' ? 'service metadata' : path.replace(/^\/api\/?/, '').replace(/[{}]/g, '').replace(/[/-]+/g, ' ').trim();
  return `${method.toUpperCase()} ${noun || 'API resource'}`;
}

function curlFor(method: string, path: string): string {
  const versioned = path === '/' ? '/' : `/api/v1${path.slice(4)}`;
  return `curl -X ${method.toUpperCase()} http://localhost:47778${versioned}`;
}

function singular(value: string): string { return value.replace(/s$/, '') || 'item'; }

function mergeTags(tags: unknown, paths: Spec) {
  const map = new Map(Object.entries(TAGS).map(([name, description]) => [name, { name, description }]));
  if (Array.isArray(tags)) for (const tag of tags) if (tag?.name) map.set(tag.name, { description: TAGS[tag.name] ?? tag.description, ...tag });
  for (const pathItem of Object.values(paths ?? {}) as Spec[]) {
    for (const method of METHODS) for (const name of pathItem?.[method]?.tags ?? []) map.set(name, { name, description: TAGS[name] ?? `${name} endpoints.` });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
