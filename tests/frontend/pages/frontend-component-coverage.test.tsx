import { describe, expect, test } from 'bun:test';
import { CanvasPluginsPage } from '../../../frontend/src/pages/CanvasPluginsPage';
import { PluginsPage } from '../../../frontend/src/pages/PluginsPage';
import { VectorHealthDashboardCard } from '../../../frontend/src/pages/vector-dashboard-cards';
import { htmlFor } from '../_render';

describe('frontend component coverage', () => {
  test('renders plugin status bento details', () => {
    const html = htmlFor(<PluginsPage plugins={[{
      name: 'hermes',
      file: 'hermes.json',
      size: 42,
      modified: '2026-06-16',
      version: '2.0.0',
      status: 'ok',
      description: 'Hermes bridge plugin.',
      menu: { label: 'Hermes', path: '/plugins/hermes' },
      server: { command: 'bun', healthPath: '/health' },
      proxy: [{ path: '/api/plugins/hermes/server', targetEnv: 'HERMES_URL' }],
      apiRoutes: [{ path: '/api/plugins/hermes/ping', methods: ['GET'] }],
      mcpTools: [{ name: 'hermes_ping', description: 'Ping Hermes', readOnly: true, source: 'plugin' }],
    }]} loading={false} />);

    expect(html).toContain('1 enabled · 0 disabled · 1 registered');
    expect(html).toContain('Unified plugin surfaces');
    expect(html).toContain('ok');
    expect(html).toContain('2.0.0');
    expect(html).toContain('apiRoutes');
    expect(html).toContain('proxy');
    expect(html).toContain('/health');
  });

  test('renders vector health dashboard provider and freshness state', () => {
    const html = htmlFor(<VectorHealthDashboardCard
      providers={[
        { type: 'ollama', status: 'green', available: true, detail: 'local' },
        { type: 'openai', status: 'red', available: false, detail: 'missing key' },
      ]}
      storage={[
        { adapter: 'lancedb', status: 'green', healthy: 2, total: 2 },
        { adapter: 'qdrant', status: 'red', healthy: 0, total: 1, detail: 'down' },
      ]}
      freshness={{ status: 'stale', totalIndexed: 1532, sourceDocs: 1600, docsPending: 68, lastIndexed: '2026-06-16T00:00:00Z' }}
    />);

    expect(html).toContain('Vector health dashboard');
    expect(html).toContain('1/2 providers available');
    expect(html).toContain('1/2 storage backends healthy');
    expect(html).toContain('lancedb: 2/2');
    expect(html).toContain('qdrant: 0/1');
    expect(html).toContain('stale · 1,532 indexed');
    expect(html).toContain('68 pending of 1,600 source docs');
    expect(html).toContain('2026-06-16T00:00:00Z');
    expect(html).toContain('ollama: green');
    expect(html).toContain('openai: red');
  });

  test('renders canvas plugin targets for three and react runtimes', () => {
    const html = htmlFor(<CanvasPluginsPage plugins={[
      { id: 'wave', label: 'Wave', description: 'Wave field.', kind: 'three', mount: 'mountWave', path: '/canvas', query: { plugin: 'wave' } },
      { id: 'map', label: 'Map', description: 'Knowledge map.', kind: 'react', renderer: 'KnowledgeMap', path: '/canvas/map', query: { plugin: 'map' }, apiPath: '/api/map3d' },
    ]} loading={false} />);

    expect(html).toContain('2 registered · 1 three · 1 react');
    expect(html).toContain('/canvas?plugin=wave');
    expect(html).toContain('mountWave');
    expect(html).toContain('/canvas/map?plugin=map');
    expect(html).toContain('KnowledgeMap');
    expect(html).toContain('/api/map3d');
  });
});
