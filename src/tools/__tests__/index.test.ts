/**
 * Barrel export test — verifies all expected tools are exported.
 */

import { describe, it, expect } from 'bun:test';
import * as tools from '../index.ts';

describe('tools barrel export', () => {
  it('exports core tool definitions', () => {
    expect(tools.searchToolDef).toBeDefined();
    expect(tools.learnToolDef).toBeDefined();
    expect(tools.listToolDef).toBeDefined();
    expect(tools.statsToolDef).toBeDefined();
    expect(tools.conceptsToolDef).toBeDefined();
    expect(tools.supersedeToolDef).toBeDefined();
    expect(tools.handoffToolDef).toBeDefined();
    expect(tools.inboxToolDef).toBeDefined();
  });

  it('exports core handlers', () => {
    expect(typeof tools.handleSearch).toBe('function');
    expect(typeof tools.handleLearn).toBe('function');
    expect(typeof tools.handleList).toBe('function');
    expect(typeof tools.handleStats).toBe('function');
    expect(typeof tools.handleConcepts).toBe('function');
    expect(typeof tools.handleSupersede).toBe('function');
    expect(typeof tools.handleHandoff).toBe('function');
    expect(typeof tools.handleInbox).toBe('function');
  });

  it('exports forum tool defs and handlers', () => {
    expect(tools.forumToolDefs).toBeDefined();
    expect(typeof tools.handleThread).toBe('function');
    expect(typeof tools.handleThreads).toBe('function');
    expect(typeof tools.handleThreadRead).toBe('function');
    expect(typeof tools.handleThreadUpdate).toBe('function');
  });

  it('exports trace tool defs and handlers', () => {
    expect(tools.traceToolDefs).toBeDefined();
    expect(typeof tools.handleTrace).toBe('function');
    expect(typeof tools.handleTraceList).toBe('function');
    expect(typeof tools.handleTraceGet).toBe('function');
    expect(typeof tools.handleTraceLink).toBe('function');
    expect(typeof tools.handleTraceUnlink).toBe('function');
    expect(typeof tools.handleTraceChain).toBe('function');
  });

  it('exports search pure helpers', () => {
    expect(typeof tools.sanitizeFtsQuery).toBe('function');
    expect(typeof tools.normalizeFtsScore).toBe('function');
    expect(typeof tools.parseConceptsFromMetadata).toBe('function');
    expect(typeof tools.combineResults).toBe('function');
    expect(typeof tools.vectorSearch).toBe('function');
  });

  it('exports learn pure helpers', () => {
    expect(typeof tools.normalizeProject).toBe('function');
    expect(typeof tools.extractProjectFromSource).toBe('function');
  });

  it('does not export vault (CLI-only)', () => {
    expect((tools as any).vaultToolDefs).toBeUndefined();
    expect((tools as any).syncVault).toBeUndefined();
    expect((tools as any).initVault).toBeUndefined();
    expect((tools as any).vaultStatus).toBeUndefined();
  });
});
