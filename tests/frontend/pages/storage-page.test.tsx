import { describe, expect, test } from 'bun:test';
import { StoragePage, storageSummaryRows } from '../../../frontend/src/pages/StoragePage';
import type { SettingsSystemResponse } from '../../../frontend/src/types';
import { htmlFor } from '../_render';

const settings: SettingsSystemResponse = {
  storage: {
    activeBackend: 'sqlite',
    configuredBackend: 'sqlite',
    defaultBackend: 'sqlite',
    dbPath: '/data/oracle.sqlite',
    dataDir: '/data/oracle',
    repoRoot: '/repo/arra-oracle-v3',
  },
  embedder: {
    source: 'defaults',
    backend: 'ollama',
    model: 'bge-m3',
    url: 'http://localhost:11434',
    dimensions: 1024,
    embeddingEndpoint: '/api/embeddings',
    collections: [],
  },
  migrations: {
    status: 'current',
    tablePresent: true,
    appliedCount: 12,
    availableCount: 12,
    pendingCount: 0,
    latestKnown: '0012_storage.sql',
    latestAppliedAt: '2026-06-16T00:00:00.000Z',
  },
};

describe('StoragePage', () => {
  test('renders the storage backend config from settings system data', () => {
    const html = htmlFor(<StoragePage initialSettings={settings} />);
    expect(html).toContain('Storage backend');
    expect(html).toContain('/api/settings/system');
    expect(html).toContain('/data/oracle.sqlite');
    expect(html).toContain('current');
    expect(html).toContain('12/12 migrations applied');
  });

  test('summarizes active backend and migrations for dashboard cards', () => {
    const rows = storageSummaryRows(settings);
    expect(rows.map((row) => row.label)).toContain('Active backend');
    expect(rows.find((row) => row.label === 'Migration state')?.value).toBe('current');
  });
});
