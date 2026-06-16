import { describe, expect, test } from 'bun:test';
import { CanvasPluginsPage } from '../../../frontend/src/pages/CanvasPluginsPage';
import { htmlFor } from '../_render';

const plugins = [
  { id: 'wave', label: 'Wave', description: 'Wave field scene.', kind: 'three' as const, mount: 'waveScene', path: '/canvas', query: { plugin: 'wave' }, standalonePath: '/?plugin=wave' },
  { id: 'map', label: 'Knowledge Map', description: 'React map.', kind: 'react' as const, renderer: 'KnowledgeMapCanvas', path: '/map', query: { plugin: 'map' }, standalonePath: '/map', apiPath: '/api/map3d' },
];

describe('CanvasPluginsPage', () => {
  test('renders canvas plugin list and status from initial data', () => {
    const html = htmlFor(<CanvasPluginsPage plugins={plugins} loading={false} standaloneHost="canvas.buildwithoracle.com" />);

    expect(html).toContain('Canvas plugin registry');
    expect(html).toContain('2 registered · 1 three · 1 react');
    expect(html).toContain('Wave');
    expect(html).toContain('Knowledge Map');
    expect(html).toContain('registered');
    expect(html).toContain('/api/map3d');
    expect(html).toContain('https://canvas.buildwithoracle.com/?plugin=wave');
    expect(html).toContain('https://canvas.buildwithoracle.com/map');
  });
});
