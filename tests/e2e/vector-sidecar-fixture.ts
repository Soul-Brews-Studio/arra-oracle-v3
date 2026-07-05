const port = Number(process.env.PLAYWRIGHT_VECTOR_PORT ?? 47790);
const collection = 'playwright_e2e';

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    headers: { 'access-control-allow-origin': '*' },
    ...init,
  });
}

function health() {
  return {
    status: 'ok',
    engines: [],
    checked_at: new Date().toISOString(),
  };
}

Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (url.pathname === '/health' || url.pathname === '/api/vector/health') return json(health());
    if (url.pathname === '/api/vector/stats') {
      return json({
        vector: { enabled: true, count: 0, collection },
        vectors: [],
      });
    }

    if (url.pathname === '/api/vector/index/models' || url.pathname === '/api/vector/models') {
      return json({ models: {} });
    }
    if (url.pathname === '/api/vector/index/status') {
      return json({ status: 'idle', job: null });
    }
    if (url.pathname === '/api/search') {
      return json({
        results: [],
        total: 0,
        offset: Number(url.searchParams.get('offset') ?? 0),
        limit: Number(url.searchParams.get('limit') ?? 10),
        query: url.searchParams.get('q') ?? '',
      });
    }
    return json({ error: 'not found' }, { status: 404 });
  },
});

console.log(`Playwright vector sidecar fixture listening on http://127.0.0.1:${port}`);
