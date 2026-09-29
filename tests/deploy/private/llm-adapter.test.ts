import { describe, expect, test } from 'bun:test';
import { handleRequest } from '../../../deploy/private/arra-full-stack/llm-adapter.ts';

const askPayload = {
  instruction: 'Answer only from sources. Return JSON with answer, citations, noEvidence.',
  question: 'What is Arra?',
  sources: [{ index: 1, id: 'doc-1', excerpt: 'Arra is a private memory layer.' }],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('private LLM adapter', () => {
  test('routes Hermes mode to the loopback OpenAI-compatible API without an OpenAI key', async () => {
    let request: any;
    let endpoint = '';
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), {
      env: { ORACLE_PRIVATE_DEPLOYMENT: '1', ARRA_LLM_PROVIDER: 'hermes', HERMES_API_KEY: 'hermes-key', HERMES_MODEL: 'grok-4.7' },
      fetcher: async (url, init) => {
        endpoint = String(url);
        request = JSON.parse(String(init?.body));
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer hermes-key');
        return response({ choices: [{ message: { content: '{"answer":"Arra is private.","citations":[1],"noEvidence":false}' } }] });
      },
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ answer: 'Arra is private.', citations: [1], noEvidence: false });
    expect(endpoint).toBe('http://127.0.0.1:8642/v1/chat/completions');
    expect(request.model).toBe('grok-4.7');
    expect(request.messages[1].content).toContain('What is Arra?');
  });

  test('normalizes Hermes citation objects to validated source indexes', async () => {
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), {
      env: { ORACLE_PRIVATE_DEPLOYMENT: '1', ARRA_LLM_PROVIDER: 'hermes', HERMES_API_KEY: 'hermes-key', HERMES_MODEL: 'grok-4.7' },
      fetcher: async () => response({ choices: [{ message: { content: '{"answer":"Arra is private.","citations":[{"index":1,"text":"source"}],"noEvidence":false}' } }] }),
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ answer: 'Arra is private.', citations: [1], noEvidence: false });
  });

  test('does not misclassify ask instructions that mention superseded evidence', async () => {
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify({ ...askPayload, instruction: 'Warn when evidence is stale or superseded. Return JSON only with keys answer, citations, noEvidence.' }), headers: { 'content-type': 'application/json' },
    }), {
      env: { ORACLE_PRIVATE_DEPLOYMENT: '1', ARRA_LLM_PROVIDER: 'hermes', HERMES_API_KEY: 'hermes-key', HERMES_MODEL: 'grok-4.7' },
      fetcher: async () => response({ choices: [{ message: { content: '{"answer":"Arra is private.","citations":[1],"noEvidence":false}' } }] }),
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ answer: 'Arra is private.', citations: [1], noEvidence: false });
  });

  test('rejects a non-loopback Hermes endpoint in private mode without sending the key', async () => {
    let calls = 0;
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), {
      env: { ORACLE_PRIVATE_DEPLOYMENT: '1', ARRA_LLM_PROVIDER: 'hermes', HERMES_API_KEY: 'hermes-key', HERMES_MODEL: 'grok-4.7', HERMES_CHAT_URL: 'http://100.64.0.1:8642/v1/chat/completions' },
      fetcher: async () => { calls += 1; return response({}); },
    });

    expect(result.status).toBe(503);
    expect(calls).toBe(0);
  });

  test('falls back from unavailable Hermes to the configured Codex bridge', async () => {
    const endpoints: string[] = [];
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), {
      env: {
        ORACLE_PRIVATE_DEPLOYMENT: '1', ARRA_LLM_PROVIDERS: 'hermes,codex',
        ARRA_LLM_MAX_RETRIES: '0',
        HERMES_API_KEY: 'hermes-key', HERMES_MODEL: 'grok-4.7',
        CODEX_BRIDGE_KEY: 'codex-key', CODEX_MODEL: 'codex',
      },
      fetcher: async (url) => {
        endpoints.push(String(url));
        if (endpoints.length === 1) return response({ error: 'Hermes unavailable' }, 503);
        return response({ choices: [{ message: { content: '{"answer":"Codex fallback.","citations":[1],"noEvidence":false}' } }] });
      },
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ answer: 'Codex fallback.', citations: [1], noEvidence: false });
    expect(endpoints).toEqual([
      'http://127.0.0.1:8642/v1/chat/completions',
      'http://127.0.0.1:47781/v1/chat/completions',
    ]);
  });

  test('fails closed when provider credentials are incomplete', async () => {
    let calls = 0;
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), { env: {}, fetcher: async () => { calls += 1; return response({}); } });

    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ noEvidence: true });
    expect(calls).toBe(0);
  });

  test('returns a cited ask response and pins the configured model', async () => {
    let request: any;
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), {
      env: { OPENAI_API_KEY: 'test-key', OPENAI_CHAT_MODEL: 'test-mini' },
      fetcher: async (_url, init) => { request = JSON.parse(String(init?.body)); return response({ choices: [{ message: { content: '{"answer":"Arra is private.","citations":[1],"noEvidence":false}' } }] }); },
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ answer: 'Arra is private.', citations: [1], noEvidence: false });
    expect(request.model).toBe('test-mini');
    expect(request.messages[1].content).toContain('What is Arra?');
  });

  test('fails closed when an ask cites an unavailable source index', async () => {
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), {
      env: { OPENAI_API_KEY: 'test-key', OPENAI_CHAT_MODEL: 'test-mini' },
      fetcher: async () => response({ choices: [{ message: { content: '{"answer":"unsupported","citations":[99],"noEvidence":false}' } }] }),
    });

    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ noEvidence: true, citations: [] });
  });

  test('fails closed when evidence-backed output has no citations', async () => {
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), {
      env: { OPENAI_API_KEY: 'test-key', OPENAI_CHAT_MODEL: 'test-mini' },
      fetcher: async () => response({ choices: [{ message: { content: '{"answer":"unsupported","citations":[],"noEvidence":false}' } }] }),
    });
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ noEvidence: true });
  });

  test('rejects a non-OpenAI endpoint in private mode without sending the key', async () => {
    let calls = 0;
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify(askPayload), headers: { 'content-type': 'application/json' },
    }), {
      env: { ORACLE_PRIVATE_DEPLOYMENT: '1', OPENAI_API_KEY: 'test-key', OPENAI_CHAT_MODEL: 'test-mini', OPENAI_CHAT_URL: 'http://evil.invalid/chat' },
      fetcher: async () => { calls += 1; return response({}); },
    });
    expect(result.status).toBe(503);
    expect(calls).toBe(0);
  });

  test('returns a validated SUPERSEDE decision for consolidation prompts', async () => {
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify({ instruction: 'Return SUPERSEDE or NOOP only.', question: 'compare', sources: [{ index: 1, id: 'old' }, { index: 2, id: 'new' }] }),
      headers: { 'content-type': 'application/json' },
    }), {
      env: { OPENAI_API_KEY: 'test-key', OPENAI_CHAT_MODEL: 'test-mini' },
      fetcher: async () => response({ choices: [{ message: { content: '{"action":"SUPERSEDE","oldId":"old","newId":"new","reason":"newer"}' } }] }),
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ action: 'SUPERSEDE', oldId: 'old', newId: 'new' });
  });

  test('consolidation provider failure becomes a safe NOOP', async () => {
    const result = await handleRequest(new Request('http://127.0.0.1/ask', {
      method: 'POST', body: JSON.stringify({ instruction: 'Return SUPERSEDE or NOOP only.', question: 'compare', sources: [] }),
      headers: { 'content-type': 'application/json' },
    }), {
      env: { OPENAI_API_KEY: 'test-key', OPENAI_CHAT_MODEL: 'test-mini' },
      fetcher: async () => { throw new Error('network down'); },
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ action: 'NOOP' });
  });
});
