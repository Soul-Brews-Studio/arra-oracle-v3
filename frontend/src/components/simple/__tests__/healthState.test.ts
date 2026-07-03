import { describe, expect, test } from 'bun:test';
import {
  HEALTH_DOWN_RETRY_COUNT,
  HEALTH_STARTING_ESCAPE_MS,
  HEALTH_STARTING_GRACE_MS,
  HEALTH_STATE_COPY,
  HealthState,
  mapHealthState,
} from '../healthState.ts';

describe('simple health state mapper', () => {
  test('exposes copy for all six states', () => {
    expect(Object.keys(HEALTH_STATE_COPY).sort()).toEqual([
      'degraded-db', 'degraded-fts', 'degraded-plugin', 'down', 'healthy', 'starting',
    ].sort());
    expect(HEALTH_STATE_COPY[HealthState.Healthy].title).toBe('Awake and remembering');
    expect(HEALTH_STATE_COPY[HealthState.Down].action).toContain('Docker');
  });

  test('maps healthy payloads to healthy', () => {
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'ok', dbStatus: 'connected', pluginStatus: 'ok', vectorStatus: 'ok' } }))
      .toBe(HealthState.Healthy);
  });

  test('uses 8s startup grace for missing health and errors', () => {
    expect(mapHealthState({ msSinceLoad: HEALTH_STARTING_GRACE_MS - 1, error: new Error('boot') }))
      .toBe(HealthState.Starting);
  });

  test('escapes startup to down after 30s', () => {
    expect(mapHealthState({ msSinceLoad: HEALTH_STARTING_ESCAPE_MS, error: new Error('timeout') }))
      .toBe(HealthState.Down);
  });

  test('flips down after three failed polls', () => {
    expect(mapHealthState({ msSinceLoad: 9_000, error: 'offline', failedPolls: HEALTH_DOWN_RETRY_COUNT }))
      .toBe(HealthState.Down);
  });

  test('prioritizes database degradation over search and plugin warnings', () => {
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'degraded', dbStatus: 'down', pluginStatus: 'degraded', vectorStatus: 'down' } }))
      .toBe(HealthState.DegradedDb);
  });

  test('maps plugin degradation when storage is healthy', () => {
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'ok', dbStatus: 'connected', pluginStatus: 'degraded' } }))
      .toBe(HealthState.DegradedPlugin);
  });

  test('maps limited search/vector health to degraded fts', () => {
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'ok', dbStatus: 'connected', pluginStatus: 'ok', vectorAvailable: false } }))
      .toBe(HealthState.DegradedFts);
  });

  test('prefers backend healthStatus and subsystem details when present', () => {
    expect(mapHealthState({
      msSinceLoad: 10_000,
      health: { status: 'ok', healthStatus: 'healthy', vectorAvailable: false, subsystems: { vector: { status: 'healthy' }, fts: { status: 'healthy' } } },
    })).toBe(HealthState.Healthy);
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'ok', healthStatus: 'starting' } }))
      .toBe(HealthState.Starting);
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'ok', healthStatus: 'healthy', subsystems: { database: { status: 'down' } } } }))
      .toBe(HealthState.DegradedDb);
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'ok', healthStatus: 'healthy', subsystems: { plugins: { status: 'degraded' } } } }))
      .toBe(HealthState.DegradedPlugin);
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'degraded', healthStatus: 'degraded', subsystems: { fts: { status: 'degraded' } } } }))
      .toBe(HealthState.DegradedFts);
  });

  test('maps explicit down payloads to down', () => {
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'down' } })).toBe(HealthState.Down);
  });

  test('prefers enriched healthStatus over legacy ok status', () => {
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'ok', healthStatus: 'degraded', dbStatus: 'connected' } }))
      .toBe(HealthState.DegradedFts);
    expect(mapHealthState({ msSinceLoad: 10_000, health: { status: 'ok', healthStatus: 'down' } }))
      .toBe(HealthState.Down);
  });
});
