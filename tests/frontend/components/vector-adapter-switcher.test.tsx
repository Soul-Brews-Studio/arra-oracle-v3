import { describe, expect, test } from 'bun:test';
import { VectorAdapterSwitcher, adapterStatus } from '../../../frontend/src/components/VectorAdapterSwitcher';
import type { VectorConfigRow } from '../../../frontend/src/pages/vectorSettingsHelpers';
import { htmlFor } from '../_render';

const rows: VectorConfigRow[] = [
  {
    key: 'bge-m3',
    collection: 'oracle_bge_m3',
    model: 'BAAI/bge-m3',
    provider: 'ollama',
    adapter: 'lancedb',
    primary: true,
    count: 100,
    health: { ok: true, status: 'ok', collection: 'oracle_bge_m3', adapter: 'lancedb', model: 'BAAI/bge-m3' },
  },
  {
    key: 'qwen3',
    collection: 'oracle_qwen3',
    model: 'Qwen3',
    provider: 'ollama',
    adapter: 'qdrant',
    count: 40,
    health: { ok: false, status: 'down', collection: 'oracle_qwen3', adapter: 'qdrant', model: 'Qwen3' },
  },
];

describe('VectorAdapterSwitcher', () => {
  test('renders current adapter status and LanceDB/Qdrant actions', () => {
    const html = htmlFor(<VectorAdapterSwitcher rows={rows} onRefresh={() => undefined} />);

    expect(html).toContain('Adapter switcher');
    expect(html).toContain('LanceDB / Qdrant backend');
    expect(html).toContain('Current adapter');
    expect(html).toContain('mixed');
    expect(html).toContain('Use LanceDB');
    expect(html).toContain('Use Qdrant');
    expect(html).toContain('2 collections · lancedb 1 · qdrant 1 · 1/2 healthy');
  });

  test('summarizes empty and single-adapter states', () => {
    expect(adapterStatus([])).toBe('No vector collections configured.');
    expect(adapterStatus([rows[0]])).toBe('1 collections · lancedb 1 · 1/1 healthy');
  });
});
