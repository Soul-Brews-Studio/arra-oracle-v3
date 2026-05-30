import { describe, it, expect } from 'bun:test';
import { resolveToolName } from '../index.ts';

describe('resolveToolName — arra_* → muninn_* backward compat (PR #1172 aliases)', () => {
  it('maps arra_search to muninn_search', () => {
    expect(resolveToolName('arra_search')).toBe('muninn_search');
  });

  it('maps arra_learn to muninn_learn', () => {
    expect(resolveToolName('arra_learn')).toBe('muninn_learn');
  });

  it('maps every legacy arra_* tool we shipped before the rename', () => {
    const pairs: Array<[string, string]> = [
      ['arra_search', 'muninn_search'],
      ['arra_read', 'muninn_read'],
      ['arra_list', 'muninn_list'],
      ['arra_stats', 'muninn_stats'],
      ['arra_concepts', 'muninn_concepts'],
      ['arra_learn', 'muninn_learn'],
      ['arra_supersede', 'muninn_supersede'],
      ['arra_handoff', 'muninn_handoff'],
      ['arra_inbox', 'muninn_inbox'],
      ['arra_thread', 'muninn_thread'],
      ['arra_threads', 'muninn_threads'],
      ['arra_thread_read', 'muninn_thread_read'],
      ['arra_thread_update', 'muninn_thread_update'],
      ['arra_trace', 'muninn_trace'],
      ['arra_trace_list', 'muninn_trace_list'],
      ['arra_trace_get', 'muninn_trace_get'],
      ['arra_trace_link', 'muninn_trace_link'],
      ['arra_trace_unlink', 'muninn_trace_unlink'],
      ['arra_trace_chain', 'muninn_trace_chain'],
    ];
    for (const [old, neu] of pairs) {
      expect(resolveToolName(old)).toBe(neu);
    }
  });

  it('passes muninn_* names through unchanged', () => {
    expect(resolveToolName('muninn_search')).toBe('muninn_search');
    expect(resolveToolName('muninn_trace_chain')).toBe('muninn_trace_chain');
  });

  it('leaves unrelated names alone (no false rewrites)', () => {
    // Tools without the arra_ prefix should not be touched, even if they
    // contain "arra" elsewhere.
    expect(resolveToolName('search')).toBe('search');
    expect(resolveToolName('not_arra_thing')).toBe('not_arra_thing');
    expect(resolveToolName('')).toBe('');
  });

  it('only strips the leading "arra_" prefix — preserves the rest of the name', () => {
    // Hypothetical future tool: arra_new_thing → muninn_new_thing
    expect(resolveToolName('arra_new_thing')).toBe('muninn_new_thing');
    // Underscore-heavy name
    expect(resolveToolName('arra_a_b_c_d')).toBe('muninn_a_b_c_d');
  });
});
