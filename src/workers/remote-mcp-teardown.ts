const BODY = `arra-oracle-remote-mcp was retired. Use the canonical workers/mcp deploy target: arra-oracle-mcp.\n`;

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname === '/health' || pathname === '/__health') {
      return Response.json({ ok: false, retired: true, replacement: 'arra-oracle-mcp' }, { status: 410 });
    }
    return new Response(BODY, {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
