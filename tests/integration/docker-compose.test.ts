import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(600_000);

const COMPOSE_FILE = 'docker-compose.prod.yml';
const SERVICE = 'arra-oracle';
const UID = '1000';
const PROJECT = `arra-codex-6-${process.pid}-${Date.now()}`;

type CommandOptions = {
  allowFailure?: boolean;
  env?: Record<string, string>;
};

async function run(command: string[], options: CommandOptions = {}) {
  const proc = Bun.spawn(command, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command.join(' ')} failed with ${code}\n${stdout}\n${stderr}`);
  }
  return { stdout, stderr, code };
}

function compose(args: string[], env: Record<string, string>, allowFailure = false) {
  return run(['docker', 'compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args], { env, allowFailure });
}

async function reservePort(): Promise<number> {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') });
  const { port } = server;
  await server.stop(true);
  if (!port) throw new Error('failed to reserve docker compose host port');
  return port;
}

async function containerId(env: Record<string, string>): Promise<string> {
  const { stdout } = await compose(['ps', '-q', SERVICE], env);
  const id = stdout.trim();
  if (!id) throw new Error('compose did not report an arra-oracle container id');
  return id;
}

async function waitForHealthcheck(container: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastStatus = 'unknown';
  while (Date.now() < deadline) {
    const { stdout } = await run(['docker', 'inspect', '-f', '{{.State.Health.Status}}', container], { allowFailure: true });
    lastStatus = stdout.trim() || lastStatus;
    if (lastStatus === 'healthy') return;
    if (lastStatus === 'unhealthy') throw new Error('compose container became unhealthy');
    await Bun.sleep(1_000);
  }
  throw new Error(`compose healthcheck did not become healthy; last status=${lastStatus}`);
}

async function jsonGet(url: string) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json() as Record<string, unknown>;
  return { response, body };
}

test('docker compose prod stack serves versioned health and menu as non-root', async () => {
  const port = await reservePort();
  const env = { ARRA_HTTP_BIND: '127.0.0.1', ARRA_HTTP_PORT: String(port), ARRA_IMAGE: `${PROJECT}:prod` };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await compose(['up', '-d', '--build'], env);
    const id = await containerId(env);
    await waitForHealthcheck(id);

    const uid = (await compose(['exec', '-T', SERVICE, 'id', '-u'], env)).stdout.trim();
    expect(uid).toBe(UID);

    const health = await jsonGet(`${baseUrl}/api/v1/health`);
    expect(health.response.status).toBe(200);
    expect(health.response.headers.get('X-API-Version')).toBe('v1');
    expect(health.body).toMatchObject({ status: 'ok', server: 'arra-oracle-v3', dbStatus: 'ok' });

    const menu = await jsonGet(`${baseUrl}/api/v1/menu`);
    expect(menu.response.status).toBe(200);
    expect(menu.response.headers.get('X-API-Version')).toBe('v1');
    expect(Array.isArray(menu.body.items)).toBe(true);
    expect((menu.body.items as Array<{ path?: string }>).some((item) => item.path === '/search')).toBe(true);
  } finally {
    await compose(['down', '--volumes', '--remove-orphans'], env, true);
    await run(['docker', 'image', 'rm', env.ARRA_IMAGE], { allowFailure: true });
  }
});
