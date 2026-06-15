import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBench, tempBenchDir } from './harness.ts';

const root = tempBenchDir('plugin-load');
const pluginsDir = join(root, 'plugins');
mkdirSync(pluginsDir, { recursive: true });

for (let i = 0; i < 8; i += 1) {
  const name = `bench-plugin-${i}`;
  const dir = join(pluginsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), 'export default async () => ({ ok: true });\n');
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name,
    version: '1.0.0',
    entry: './index.ts',
    description: `Benchmark plugin ${i}`,
    apiRoutes: [{ path: `/api/${name}`, methods: ['GET'], handler: 'default' }],
    mcpTools: [{ name: `bench_tool_${i}`, description: 'Benchmark tool', inputSchema: {}, handler: 'default' }],
    menu: [{ label: `Bench ${i}`, path: `/bench/${i}`, group: 'tools' }],
    cliSubcommands: [{ command: name, help: 'benchmark command' }],
  }));
}

const { loadUnifiedPlugins } = await import('../src/plugins/unified-loader.ts');

try {
  await runBench('plugin load unified manifests (8 plugins)', async () => {
    const runtime = await loadUnifiedPlugins({ dirs: [pluginsDir], warn: () => {} });
    if (runtime.routes.length !== 8 || runtime.mcpTools.length !== 8) throw new Error('plugin load failed');
    await runtime.stop();
  }, { iterations: 120, warmup: 12 });
} finally {
  rmSync(root, { recursive: true, force: true });
}
