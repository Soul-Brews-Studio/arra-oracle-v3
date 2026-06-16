import { describe, expect, test } from 'bun:test';
import { VectorProviderServicePanel } from '../../../frontend/src/components/VectorProviderServicePanel';
import { htmlFor } from '../_render';

const providers = [
  { type: 'ollama', available: true, status: 'available', models: ['bge-m3'] },
  { type: 'gemini', available: false, status: 'unavailable', models: ['text-embedding-004'] },
];

const services = [
  { name: 'lancedb', type: 'builtin' as const, health: { status: 'up' } },
  { name: 'turbovec', type: 'proxy' as const, endpoint: 'http://localhost:8787', health: { status: 'down' } },
];

describe('VectorProviderServicePanel', () => {
  test('renders provider selector and vector service registry controls', () => {
    const html = htmlFor(<VectorProviderServicePanel initialProviders={providers} initialServices={services} />);
    expect(html).toContain('Provider + service registry');
    expect(html).toContain('Embedding provider selector');
    expect(html).toContain('ollama');
    expect(html).toContain('gemini');
    expect(html).toContain('Register vector service');
    expect(html).toContain('turbovec');
    expect(html).toContain('Test selected provider');
  });
});
