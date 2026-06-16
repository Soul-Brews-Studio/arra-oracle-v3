import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(90_000);

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response('ok') });
  const port = server.port;
  server.stop(true);
  return port;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function text(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  return new Response(stream).text();
}

async function waitForMcp(baseUrl: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 45_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/mcp`, { headers: { accept: 'application/json' } });
      if (response.ok) return await response.json() as Record<string, unknown>;
      lastError = `status ${response.status}: ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`wrangler dev did not serve /mcp in time (${lastError})`);
}

test('wrangler dev --local starts the Cloudflare Worker and serves /mcp', async () => {
  const port = freePort();
  const proc = Bun.spawn([
    'bunx',
    'wrangler',
    'dev',
    '--local',
    '--config',
    'wrangler.jsonc',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = Promise.all([text(proc.stdout), text(proc.stderr)]).then((parts) => parts.join('\n'));

  try {
    const mcp = await waitForMcp(`http://127.0.0.1:${port}`);
    expect(mcp).toMatchObject({
      ok: true,
      transport: 'streamable-http',
      path: '/mcp',
      capabilities: { tools: {} },
    });

    const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(init.status).toBe(200);
    expect(await init.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { serverInfo: { name: 'arra-oracle-remote-mcp' } },
    });
  } catch (error) {
    proc.kill();
    await proc.exited.catch(() => {});
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nwrangler output:\n${await output}`);
  } finally {
    proc.kill();
    await proc.exited.catch(() => {});
  }
});
