import { proxyToolCall } from '../../../src/mcp/http-proxy.ts';

export async function captureProxyRequest(toolName: string, args: Record<string, unknown>) {
  let captured: Record<string, unknown> = {};
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      captured = {
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body: request.headers.get('content-type') ? await request.json() : null,
      };
      return Response.json(captured);
    },
  });
  try {
    await proxyToolCall(`http://127.0.0.1:${server.port}`, toolName, args);
    return captured;
  } finally {
    await server.stop();
  }
}
