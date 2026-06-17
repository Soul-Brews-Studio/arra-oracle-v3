import { describe, expect, test } from 'bun:test';
import { VectorCollectionList } from '../../../frontend/src/pages/VectorCollectionList';
import type { VectorConfigRow } from '../../../frontend/src/pages/vectorSettingsHelpers';
import { htmlFor } from '../_render';

const rows: VectorConfigRow[] = [
  { key: 'bge', collection: 'oracle_bge', model: 'bge-m3', provider: 'ollama', adapter: 'lancedb', enabled: true, count: 3, health: { ok: true, status: 'ok', collection: 'oracle_bge', adapter: 'lancedb', model: 'bge-m3' } },
  { key: 'qwen', collection: 'oracle_qwen', model: 'qwen3', provider: 'ollama', adapter: 'qdrant', enabled: false, primary: true, health: { ok: false, status: 'down', collection: 'oracle_qwen', adapter: 'qdrant', model: 'qwen3' } },
];

describe('VectorCollectionList interaction states', () => {
  test('renders busy action labels, primary locks, and per-row action feedback', () => {
    const html = htmlFor(
      <VectorCollectionList
        rows={rows}
        drafts={{ bge: { model: 'bge-large', provider: 'ollama', adapter: 'lancedb', enabled: true } }}
        saving={{ bge: true }}
        testing={{ qwen: true }}
        primarySaving="bge"
        actionMessage={{ bge: 'Saved bge.', qwen: 'qwen failed health check.' }}
        onDraft={() => {}}
        onSave={() => {}}
        onTest={() => {}}
        onPrimary={() => {}}
      />,
    );

    expect(html).toContain('Collection settings');
    expect(html).toContain('2 configured');
    expect(html).toContain('Primary');
    expect(html).toContain('role="status" aria-label="Saving"');
    expect(html).toContain('role="status" aria-label="Testing"');
    expect(html).toContain('role="status" aria-label="Setting"');
    expect(html).toContain('Saved bge.');
    expect(html).toContain('qwen failed health check.');
  });
});
