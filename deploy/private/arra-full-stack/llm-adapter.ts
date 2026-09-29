type Env = Record<string, string | undefined>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Source = { index?: unknown; id?: unknown; excerpt?: unknown } & Record<string, unknown>;
type AskPayload = { instruction: string; question?: string; sources: Source[] };
type AdapterState = { active: number; nextAllowedAt: number };
type Options = { env?: Env; fetcher?: Fetcher; sleep?: (ms: number) => Promise<void>; state?: AdapterState };
type ProviderName = 'hermes' | 'codex' | 'openai';
type ProviderConfig = {
  name: ProviderName;
  key: string;
  model: string;
  url: string;
  maxRetries: number;
  timeoutMs: number;
  maxOutputTokens: number;
};

const HERMES_URL = 'http://127.0.0.1:8642/v1/chat/completions';
const CODEX_BRIDGE_URL = 'http://127.0.0.1:47781/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_INSTRUCTION_CHARS = 12_000;
const MAX_QUESTION_CHARS = 8_000;
const MAX_SOURCE_COUNT = 32;
const MAX_SOURCE_CHARS = 120_000;
const defaultState: AdapterState = { active: 0, nextAllowedAt: 0 };

export function createAdapterState(): AdapterState { return { active: 0, nextAllowedAt: 0 }; }

export async function handleRequest(request: Request, options: Options = {}): Promise<Response> {
  const url = new URL(request.url);
  const env = options.env ?? process.env;
  if (url.pathname === '/health' && request.method === 'GET') return json(health(env));
  if (url.pathname !== '/ask') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let payload: AskPayload;
  try { payload = parsePayload(await request.json()); }
  catch { return json({ error: 'invalid_request' }, 400); }
  const consolidation = isConsolidation(payload.instruction);
  try {
    return json(await callProviders(payload, consolidation, options));
  } catch (error) {
    if (consolidation) return json({ action: 'NOOP', reason: 'adapter_fail_closed', model: configuredModel(env) || 'unconfigured' });
    return json({ answer: '', citations: [], noEvidence: true, mode: 'extractive' }, 503);
  }
}

async function callProviders(payload: AskPayload, consolidation: boolean, options: Options): Promise<Record<string, unknown>> {
  const env = options.env ?? process.env;
  let lastError: unknown;
  for (const provider of providerConfigs(env)) {
    try {
      const raw = await callProvider(provider, payload, options);
      const parsed = parseJson(raw);
      return consolidation ? validateConsolidation(parsed, payload.sources) : validateAsk(parsed, payload.sources);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('no inference provider succeeded');
}

async function callProvider(provider: ProviderConfig, payload: AskPayload, options: Options): Promise<string> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const state = options.state ?? defaultState;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxConcurrent = boundedInt(env.ARRA_LLM_MAX_CONCURRENCY ?? env[`${provider.name.toUpperCase()}_MAX_CONCURRENCY`], 2, 1, 8);
  const minIntervalMs = boundedInt(env.ARRA_LLM_MIN_INTERVAL_MS ?? env[`${provider.name.toUpperCase()}_MIN_INTERVAL_MS`], 0, 0, 60_000);
  await acquire(state, maxConcurrent, minIntervalMs, sleep);
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt <= provider.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (provider.key) headers.authorization = `Bearer ${provider.key}`;
        const body: Record<string, unknown> = {
          model: provider.model,
          temperature: 0,
          messages: [
            { role: 'system', content: payload.instruction },
            { role: 'user', content: JSON.stringify({ question: payload.question ?? '', sources: payload.sources }) },
          ],
        };
        // Hermes and the Codex bridge enforce the JSON contract through the
        // instruction and the adapter validator. OpenAI additionally supports
        // the native response_format hint.
        if (provider.name === 'openai') {
          body.max_completion_tokens = provider.maxOutputTokens;
          body.response_format = { type: 'json_object' };
        } else body.max_tokens = provider.maxOutputTokens;
        const response = await fetcher(provider.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`${provider.name} chat failed (${response.status})`);
          if (attempt < provider.maxRetries && (response.status === 429 || response.status >= 500)) {
            lastError = error;
            await sleep(50 * 2 ** attempt);
            continue;
          }
          lastError = error;
          break;
        }
        const responseBody = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = responseBody.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error(`${provider.name} chat response missing content`);
        return content;
      } catch (error) {
        lastError = error;
        if (attempt < provider.maxRetries) { await sleep(50 * 2 ** attempt); continue; }
      } finally { clearTimeout(timeout); }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } finally { state.active = Math.max(0, state.active - 1); }
}

async function acquire(state: AdapterState, maxConcurrent: number, minIntervalMs: number, sleep: (ms: number) => Promise<void>): Promise<void> {
  while (true) {
    if (state.active < maxConcurrent) {
      const now = Date.now();
      const wait = state.nextAllowedAt - now;
      if (wait <= 0) {
        state.active += 1;
        state.nextAllowedAt = now + minIntervalMs;
        return;
      }
      await sleep(wait);
    } else await sleep(10);
  }
}

function parsePayload(value: unknown): AskPayload {
  if (!value || typeof value !== 'object') throw new Error('payload must be an object');
  const record = value as Record<string, unknown>;
  const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : '';
  if (!instruction) throw new Error('instruction is required');
  const question = typeof record.question === 'string' ? record.question.trim() : '';
  if (instruction.length > MAX_INSTRUCTION_CHARS || question.length > MAX_QUESTION_CHARS) throw new Error('request text exceeds adapter bounds');
  const sources = Array.isArray(record.sources) ? record.sources.filter(isRecord) as Source[] : [];
  if (sources.length > MAX_SOURCE_COUNT || JSON.stringify(sources).length > MAX_SOURCE_CHARS) throw new Error('source payload exceeds adapter bounds');
  return { instruction, question, sources };
}

function validateAsk(value: unknown, sources: Source[]): Record<string, unknown> {
  const record = asRecord(value);
  const answer = typeof record.answer === 'string' ? record.answer.trim() : '';
  const citationValue = record.citations ?? record.citationIndexes ?? record.citation_indexes;
  const citations = citationIndexes(citationValue);
  if (!answer || typeof record.noEvidence !== 'boolean') throw new Error('invalid ask response');
  const validIndexes = new Set(sources.map((source, index) => Number.isInteger(source.index) ? Number(source.index) : index + 1));
  if (citations.some((citation) => !validIndexes.has(citation))) throw new Error('ask citation index is not in sources');
  if (record.noEvidence === false && citations.length === 0) throw new Error('evidence-backed ask requires citations');
  return { answer, citations: [...new Set(citations)], noEvidence: record.noEvidence };
}

function citationIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (isRecord(item)) return Number(item.index ?? item.citationIndex ?? item.citation_index);
    return Number(item);
  }).filter(Number.isInteger);
}

function validateConsolidation(value: unknown, sources: Source[]): Record<string, unknown> {
  const record = asRecord(value);
  const action = String(record.action ?? '').toUpperCase();
  if (action === 'NOOP') return { action: 'NOOP', reason: text(record.reason) ?? 'no-op' };
  if (action !== 'SUPERSEDE') throw new Error('invalid consolidation action');
  const oldId = text(record.oldId ?? record.old_id), newId = text(record.newId ?? record.new_id);
  const ids = new Set(sources.map((source) => text(source.id)).filter(Boolean));
  if (!oldId || !newId || oldId === newId || !ids.has(oldId) || !ids.has(newId)) throw new Error('invalid consolidation ids');
  return { action: 'SUPERSEDE', oldId, newId, reason: text(record.reason) ?? 'LLM consolidation suggestion' };
}

function parseJson(value: string): unknown {
  const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}
function isConsolidation(instruction: string): boolean {
  return /\bSUPERSEDE\b|\bNOOP\b/i.test(instruction);
}
function asRecord(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw new Error('response must be an object'); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number { const value = Number.parseInt(raw ?? '', 10); return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { 'cache-control': 'no-store' } }); }

function providerConfigs(env: Env): ProviderConfig[] {
  const names = providerNames(env);
  const unique = [...new Set(names)];
  const providers: ProviderConfig[] = [];
  for (const name of unique) {
    try { providers.push(providerConfig(name, env)); } catch { /* Skip unavailable fallback providers. */ }
  }
  return providers;
}

function providerNames(env: Env): ProviderName[] {
  const configured = env.ARRA_LLM_PROVIDERS?.trim() || env.ARRA_LLM_PROVIDER?.trim();
  return (configured ? configured.split(',') : inferProviderNames(env))
    .map((value) => value.trim().toLowerCase()).filter(Boolean) as ProviderName[];
}

function inferProviderNames(env: Env): ProviderName[] {
  if (env.HERMES_API_KEY?.trim() || env.HERMES_MODEL?.trim() || env.HERMES_CHAT_URL?.trim()) return ['hermes'];
  return ['openai'];
}

function providerConfig(name: ProviderName, env: Env): ProviderConfig {
  const prefix = name.toUpperCase();
  if (!['hermes', 'codex', 'openai'].includes(name)) throw new Error(`unsupported inference provider: ${name}`);
  const key = name === 'hermes' ? (env.HERMES_API_KEY?.trim() || '')
    : name === 'codex' ? (env.CODEX_BRIDGE_KEY?.trim() || '')
      : (env.OPENAI_API_KEY?.trim() || '');
  const model = name === 'hermes' ? (env.HERMES_MODEL?.trim() || env.ARRA_LLM_MODEL?.trim() || '')
    : name === 'codex' ? (env.CODEX_MODEL?.trim() || env.ARRA_LLM_MODEL?.trim() || 'codex')
      : (env.OPENAI_CHAT_MODEL?.trim() || '');
  const url = name === 'hermes' ? (env.HERMES_CHAT_URL?.trim() || HERMES_URL)
    : name === 'codex' ? (env.CODEX_CHAT_URL?.trim() || CODEX_BRIDGE_URL)
      : (env.OPENAI_CHAT_URL?.trim() || OPENAI_URL);
  if (name === 'openai' && (!key || !model)) throw new Error('OPENAI_API_KEY and OPENAI_CHAT_MODEL are required');
  if (name === 'hermes' && !model) throw new Error('HERMES_MODEL is required');
  if (env.ORACLE_PRIVATE_DEPLOYMENT === '1' && name !== 'openai' && !key) throw new Error(`${prefix}_API_KEY is required in private mode`);
  const maxRetries = boundedInt(env.ARRA_LLM_MAX_RETRIES ?? env[`${prefix}_MAX_RETRIES`], 2, 0, 3);
  const timeoutMs = boundedInt(env.ARRA_LLM_TIMEOUT_MS ?? env[`${prefix}_TIMEOUT_MS`], 30_000, 500, 120_000);
  const maxOutputTokens = boundedInt(env.ARRA_LLM_MAX_OUTPUT_TOKENS ?? env[`${prefix}_MAX_OUTPUT_TOKENS`], 700, 64, 2_000);
  return { name, key, model, url: providerUrl(name, url, env), maxRetries, timeoutMs, maxOutputTokens };
}

function providerUrl(name: ProviderName, candidate: string, env: Env): string {
  if (name === 'openai' && env.ORACLE_PRIVATE_DEPLOYMENT === '1' && candidate !== OPENAI_URL) throw new Error('private adapter only permits api.openai.com chat completions');
  try {
    const parsed = new URL(candidate);
    if (parsed.pathname !== '/v1/chat/completions' || parsed.search || parsed.username || parsed.password) throw new Error(`unapproved ${name} endpoint`);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`unapproved ${name} endpoint`);
    if (name === 'openai') {
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.openai.com') throw new Error('unapproved OpenAI endpoint');
    } else if (env.ORACLE_PRIVATE_DEPLOYMENT === '1' && (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' || !isLoopbackHostname(parsed.hostname))) {
      throw new Error(`private ${name} endpoint must be loopback-only`);
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(`invalid ${name} endpoint`);
  }
  return candidate;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function configuredModel(env: Env): string | null {
  try { return providerConfigs(env)[0]?.model || null; } catch { return null; }
}

function health(env: Env): Record<string, unknown> {
  const configured = providerNames(env);
  const providers = configured.map((name) => {
    try {
      const item = providerConfig(name as ProviderName, env);
      return { provider: item.name, model: item.model, configured: true };
    } catch (error) {
      return { provider: name, model: null, configured: false, reason: error instanceof Error ? error.message : 'unconfigured' };
    }
  });
  return { status: 'ok', provider: providers.map((item) => item.provider).join(',') || null, model: providers[0]?.model ?? null, configured: providers.some((item) => item.configured), providers };
}

if (import.meta.main) {
  const port = boundedInt(process.env.ORACLE_LLM_ADAPTER_PORT, 47779, 1024, 65_535);
  Bun.serve({ hostname: '127.0.0.1', port, fetch: (request) => handleRequest(request) });
  console.log(`Arra LLM adapter listening on 127.0.0.1:${port}`);
}
