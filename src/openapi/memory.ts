type Spec = Record<string, any>;

type MemoryOperation = {
  method: 'get' | 'post';
  path: string;
  summary: string;
  description: string;
  request?: string;
  response: string;
  example: unknown;
};

const JSON_TYPE = 'application/json';
const ISO = '2026-06-17T00:00:00.000Z';

export function documentMemoryOpenApi(spec: Spec): void {
  spec.components ??= {};
  spec.components.schemas = { ...spec.components.schemas, ...schemas() };

  for (const route of memoryOperations()) {
    const op = ensureOperation(spec, route.method, route.path);
    op.tags = ['memory'];
    op.summary = route.summary;
    op.description = route.description;
    op.operationId ??= operationId(route.method, route.path);
    if (route.request) setJsonRequest(op, route.request, requestExample(route.request));
    setJsonResponse(op, route.response, route.example, route.method, route.path);
  }

  enrichQueryParams(spec.paths?.['/api/memory/recall']?.get, ['q', 'limit', 'asOf']);
  enrichQueryParams(spec.paths?.['/api/memory/search']?.get, ['q', 'limit', 'asOf']);
  enrichQueryParams(spec.paths?.['/api/memory/fanout']?.get, ['q', 'limit']);
  enrichQueryParams(spec.paths?.['/api/memory/morning-tape']?.get, ['limit', 'format']);
}

function ensureOperation(spec: Spec, method: 'get' | 'post', path: string): Spec {
  spec.paths ??= {};
  spec.paths[path] ??= {};
  const op = spec.paths[path][method] ??= {};
  op.responses ??= {};
  return op;
}

function setJsonRequest(op: Spec, schemaName: string, example: unknown): void {
  op.requestBody = {
    required: true,
    content: { [JSON_TYPE]: { schema: ref(schemaName), example } },
  };
}

function setJsonResponse(op: Spec, schemaName: string, example: unknown, method: string, path: string): void {
  op.responses ??= {};
  op.responses['200'] = {
    description: 'Successful response',
    content: { [JSON_TYPE]: { schema: ref(schemaName), example } },
  };
  op['x-codeSamples'] ??= [{ lang: 'curl', label: 'curl', source: `curl -X ${method.toUpperCase()} http://localhost:47778${path}` }];
}

function enrichQueryParams(op: Spec | undefined, names: string[]): void {
  if (!op) return;
  op.parameters ??= [];
  for (const name of names) {
    let param = op.parameters.find((item: Spec) => item.in === 'query' && item.name === name);
    if (!param) op.parameters.push(param = { name, in: 'query', required: false, schema: { type: 'string' } });
    param.description ||= queryDescription(name);
    param.example ??= queryExample(name);
  }
}

function queryDescription(name: string): string {
  if (name === 'q') return 'Search text used for keyword, semantic, or fanout recall.';
  if (name === 'limit') return 'Maximum number of memory results to return.';
  if (name === 'asOf') return 'Valid-time read timestamp; filters by valid_from/valid_to.';
  if (name === 'format') return 'Use markdown or md for text/markdown morning tape output.';
  return `${name} query parameter.`;
}

function queryExample(name: string): string | number {
  if (name === 'q') return 'memory confidence heat';
  if (name === 'limit') return 5;
  if (name === 'asOf') return ISO;
  if (name === 'format') return 'markdown';
  return `example-${name}`;
}

function memoryOperations(): MemoryOperation[] {
  return [
    {
      method: 'post', path: '/api/memory/save', request: 'MemorySaveRequest', response: 'MemorySaveResponse',
      summary: 'Save a persisted memory',
      description: 'Stores a memory with provenance, tags, and valid_from/valid_to temporal bounds.',
      example: { success: true, memory: memoryExample(), vector: { indexed: true } },
    },
    {
      method: 'post', path: '/api/memory/closeout', request: 'MemoryCloseoutRequest', response: 'MemorySaveResponse',
      summary: 'Persist a session close-out memory',
      description: 'Formats close-out notes into a persisted memory and indexes it for recall.',
      example: { success: true, memory: { ...memoryExample(), title: 'Session close-out 2026-06-17' }, vector: { indexed: true } },
    },
    {
      method: 'get', path: '/api/memory/recall', response: 'MemoryRecallResponse',
      summary: 'Recall persisted memories by keyword',
      description: 'Returns keyword matches with query-time confidence, valid-time filtering, and heat signals.',
      example: { query: 'confidence', asOf: ISO, total: 1, confidence: confidenceStrategy(), items: [{ ...memoryExample(), confidence: confidenceExample() }] },
    },
    {
      method: 'get', path: '/api/memory/search', response: 'MemorySearchResponse',
      summary: 'Search memories by vector similarity',
      description: 'Returns semantic memory hits with valid_from/valid_to metadata and query-time confidence.',
      example: { success: true, query: 'confidence heat', asOf: ISO, total: 1, confidence: confidenceStrategy(), results: [searchResultExample()] },
    },
    {
      method: 'get', path: '/api/memory/fanout', response: 'MemoryFanoutResponse',
      summary: 'Fanout memory search across vector collections',
      description: 'Blends reciprocal-rank fusion with confidence and retrieval heat from usage_count/last_accessed_at.',
      example: fanoutExample(),
    },
  ];
}

function schemas(): Spec {
  return {
    MemorySaveRequest: memorySaveRequestSchema(),
    MemoryCloseoutRequest: closeoutRequestSchema(),
    MemoryRecord: memoryRecordSchema(),
    MemoryConfidence: memoryConfidenceSchema(),
    MemorySaveResponse: objectSchema({ success: { type: 'boolean' }, memory: ref('MemoryRecord'), vector: { type: 'object', additionalProperties: true } }, ['success', 'memory', 'vector']),
    MemoryRecallResponse: objectSchema({ query: { type: 'string' }, asOf: dt('valid-time filter used for this read'), total: { type: 'integer' }, confidence: strategySchema(), items: { type: 'array', items: ref('MemoryWithConfidence') } }, ['query', 'total', 'confidence', 'items']),
    MemorySearchResponse: objectSchema({ success: { type: 'boolean' }, query: { type: 'string' }, asOf: dt('valid-time filter used for this read'), total: { type: 'integer' }, confidence: strategySchema(), results: { type: 'array', items: ref('MemorySearchResult') } }, ['success', 'query', 'total', 'confidence', 'results']),
    MemoryWithConfidence: allOf('MemoryRecord', { confidence: ref('MemoryConfidence') }),
    MemorySearchResult: allOf('MemoryRecord', { score: { type: 'number' }, distance: { type: 'number' }, vectorId: { type: 'string' }, confidence: ref('MemoryConfidence') }),
    MemoryFanoutResponse: objectSchema({ query: { type: 'string' }, strategy: { type: 'string' }, collections: { type: 'array', items: { type: 'string' } }, ranking: { type: 'object', additionalProperties: true }, results: { type: 'array', items: ref('MemoryFanoutResult') }, errors: { type: 'object', additionalProperties: { type: 'string' } }, cost: { type: 'object', additionalProperties: true } }, ['query', 'strategy', 'collections', 'ranking', 'results', 'errors', 'cost']),
    MemoryFanoutResult: allOf('MemorySearchResult', { fusedScore: { type: 'number' }, rankingScore: { type: 'number' }, confidenceWeight: { type: 'number' }, matches: { type: 'array', items: { type: 'object', additionalProperties: true } } }),
  };
}

function memoryRecordSchema(): Spec {
  return objectSchema({
    id: { type: 'string', example: 'mem_lx3v9a_ab12cd34' }, tenantId: { type: 'string', example: 'default' },
    content: { type: 'string', example: 'Use confidence-weighted recall for memory search.' }, title: { type: 'string', nullable: true },
    tags: { type: 'array', items: { type: 'string' }, example: ['memory', 'confidence'] }, source: { type: 'string', nullable: true, example: 'runbook' },
    validFrom: { ...dt('HTTP field backed by oracle_memories.valid_from.'), 'x-storage-field': 'valid_from' },
    validTo: { ...dt('HTTP field backed by oracle_memories.valid_to; null means open-ended.'), nullable: true, 'x-storage-field': 'valid_to' },
    createdAt: dt('Creation timestamp.'), updatedAt: dt('Last update timestamp.'),
    usageCount: { type: 'integer', minimum: 0, example: 7, description: 'Retrieval heat visit count from usage_count when available.', 'x-storage-field': 'usage_count' },
    lastAccessedAt: { ...dt('Latest recall timestamp feeding recency-decay heat.'), 'x-storage-field': 'last_accessed_at' },
  }, ['id', 'content', 'createdAt', 'updatedAt']);
}

function memoryConfidenceSchema(): Spec {
  return objectSchema({
    score: { type: 'number', minimum: 0, maximum: 1, example: 0.823 }, label: { type: 'string', enum: ['high', 'medium', 'low'] },
    ageDays: { type: 'number' }, freshness: { type: 'number' }, usageCount: { type: 'integer', description: 'Visit count used by retrieval heat.' },
    lastAccessedAgeDays: { type: 'number', nullable: true },
    components: objectSchema({ match: { type: 'number' }, freshness: { type: 'number' }, provenance: { type: 'number' }, usage: { type: 'number', description: 'Bounded heat score from visit-count plus recency decay.' } }, ['match', 'freshness', 'provenance', 'usage']),
    warnings: { type: 'array', items: { type: 'string' } }, reasons: { type: 'array', items: { type: 'string' }, example: ['computed_at_query_time', 'retrieval_reinforced'] },
  }, ['score', 'label', 'ageDays', 'freshness', 'usageCount', 'components', 'warnings', 'reasons']);
}

function memorySaveRequestSchema(): Spec { return objectSchema({ content: { type: 'string' }, title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, source: { type: 'string' }, validFrom: { ...dt('Start of valid_from window.'), 'x-storage-field': 'valid_from' }, validTo: { ...dt('End of valid_to window.'), nullable: true, 'x-storage-field': 'valid_to' } }, ['content']); }
function closeoutRequestSchema(): Spec { return objectSchema({ summary: { type: 'string' }, title: { type: 'string' }, next: { type: 'string' }, blockers: { type: 'array', items: { type: 'string' } }, artifacts: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } } }, ['summary']); }
function allOf(base: string, properties: Spec): Spec { return { allOf: [ref(base), { type: 'object', properties }] }; }
function objectSchema(properties: Spec, required: string[] = []): Spec { return { type: 'object', required, properties }; }
function ref(name: string): Spec { return { $ref: `#/components/schemas/${name}` }; }
function dt(description: string): Spec { return { type: 'string', format: 'date-time', description, example: ISO }; }
function operationId(method: string, path: string): string { return `${method}_${path.replace(/^\/api\//, '').replace(/[^a-z0-9]+/gi, '_')}`; }
function requestExample(name: string): unknown { return name === 'MemoryCloseoutRequest' ? { summary: 'Resolved blockers and saved next boot actions.', next: 'Run focused memory tests.', tags: ['closeout'] } : { content: 'Use query-time confidence and retrieval heat for memory recall.', title: 'Memory ranking', tags: ['memory'], source: 'architecture', validFrom: ISO, validTo: null }; }
function memoryExample(): Spec { return { id: 'mem_lx3v9a_ab12cd34', content: 'Use query-time confidence and retrieval heat for memory recall.', title: 'Memory ranking', tags: ['memory'], source: 'architecture', validFrom: ISO, validTo: null, createdAt: ISO, updatedAt: ISO, usageCount: 7, lastAccessedAt: ISO }; }
function confidenceStrategy(): Spec { return { stored: false, strategy: 'query-time-confidence', signals: ['match_score', 'freshness_decay', 'usage_count', 'last_accessed_at'] }; }
function confidenceExample(): Spec { return { score: 0.823, label: 'high', ageDays: 1, freshness: 0.995, usageCount: 7, lastAccessedAgeDays: 0.5, components: { match: 0.86, freshness: 0.995, provenance: 1, usage: 0.7 }, warnings: [], reasons: ['computed_at_query_time', 'retrieval_reinforced'] }; }
function searchResultExample(): Spec { return { ...memoryExample(), score: 0.92, distance: 0.08, vectorId: 'memory:mem_lx3v9a_ab12cd34', confidence: confidenceExample() }; }
function fanoutExample(): Spec { return { query: 'confidence heat', strategy: 'reciprocal_rank_fusion', collections: ['bge-m3'], ranking: { strategy: 'confidence_weighted_rrf', confidenceWeight: 0.25, confidenceRerankingEnabled: true, confidenceSource: 'query-time-confidence' }, results: [{ ...searchResultExample(), fusedScore: 0.016393, rankingScore: 0.941, confidenceWeight: 0.25, matches: [{ collection: 'bge-m3', rank: 1, score: 0.92 }] }], errors: {}, cost: { vectorQueries: 1, estimatedUsd: 0 } }; }
function strategySchema(): Spec { return { type: 'object', properties: { stored: { type: 'boolean' }, strategy: { type: 'string' }, signals: { type: 'array', items: { type: 'string' } } } }; }
