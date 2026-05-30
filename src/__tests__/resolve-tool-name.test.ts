import { describe, it, expect } from 'bun:test';
import { resolveToolName } from '../index.ts';

describe('resolveToolName — 3-generation alias chain (arra_* | muninn_* → oracle_*)', () => {
  describe('arra_* (original, pre-#1172)', () => {
    it('maps every legacy arra_* tool to oracle_*', () => {
      const pairs: Array<[string, string]> = [
        ['arra_search', 'oracle_search'],
        ['arra_read', 'oracle_read'],
        ['arra_list', 'oracle_list'],
        ['arra_stats', 'oracle_stats'],
        ['arra_concepts', 'oracle_concepts'],
        ['arra_learn', 'oracle_learn'],
        ['arra_supersede', 'oracle_supersede'],
        ['arra_handoff', 'oracle_handoff'],
        ['arra_inbox', 'oracle_inbox'],
        ['arra_thread', 'oracle_thread'],
        ['arra_threads', 'oracle_threads'],
        ['arra_thread_read', 'oracle_thread_read'],
        ['arra_thread_update', 'oracle_thread_update'],
        ['arra_trace', 'oracle_trace'],
        ['arra_trace_list', 'oracle_trace_list'],
        ['arra_trace_get', 'oracle_trace_get'],
        ['arra_trace_link', 'oracle_trace_link'],
        ['arra_trace_unlink', 'oracle_trace_unlink'],
        ['arra_trace_chain', 'oracle_trace_chain'],
      ];
      for (const [old, neu] of pairs) {
        expect(resolveToolName(old)).toBe(neu);
      }
    });
  });

  describe('muninn_* (briefly canonical, #1172 → #1236)', () => {
    it('maps every muninn_* tool to oracle_*', () => {
      const pairs: Array<[string, string]> = [
        ['muninn_search', 'oracle_search'],
        ['muninn_read', 'oracle_read'],
        ['muninn_list', 'oracle_list'],
        ['muninn_stats', 'oracle_stats'],
        ['muninn_concepts', 'oracle_concepts'],
        ['muninn_learn', 'oracle_learn'],
        ['muninn_supersede', 'oracle_supersede'],
        ['muninn_handoff', 'oracle_handoff'],
        ['muninn_inbox', 'oracle_inbox'],
        ['muninn_thread', 'oracle_thread'],
        ['muninn_threads', 'oracle_threads'],
        ['muninn_thread_read', 'oracle_thread_read'],
        ['muninn_thread_update', 'oracle_thread_update'],
        ['muninn_trace', 'oracle_trace'],
        ['muninn_trace_list', 'oracle_trace_list'],
        ['muninn_trace_get', 'oracle_trace_get'],
        ['muninn_trace_link', 'oracle_trace_link'],
        ['muninn_trace_unlink', 'oracle_trace_unlink'],
        ['muninn_trace_chain', 'oracle_trace_chain'],
      ];
      for (const [old, neu] of pairs) {
        expect(resolveToolName(old)).toBe(neu);
      }
    });
  });

  describe('oracle_* (canonical, advertised)', () => {
    it('passes oracle_* names through unchanged', () => {
      expect(resolveToolName('oracle_search')).toBe('oracle_search');
      expect(resolveToolName('oracle_trace_chain')).toBe('oracle_trace_chain');
    });
  });

  describe('passthroughs (no prefix strip)', () => {
    it('leaves unrelated names alone (no false rewrites)', () => {
      expect(resolveToolName('search')).toBe('search');
      expect(resolveToolName('not_arra_thing')).toBe('not_arra_thing');
      expect(resolveToolName('not_muninn_thing')).toBe('not_muninn_thing');
      expect(resolveToolName('')).toBe('');
    });

    it('only strips the LEADING legacy prefix — preserves the rest of the name', () => {
      expect(resolveToolName('arra_new_thing')).toBe('oracle_new_thing');
      expect(resolveToolName('muninn_new_thing')).toBe('oracle_new_thing');
      expect(resolveToolName('arra_a_b_c_d')).toBe('oracle_a_b_c_d');
      expect(resolveToolName('muninn_a_b_c_d')).toBe('oracle_a_b_c_d');
    });

    it('does not double-strip when a name contains both prefixes', () => {
      // Highly unlikely real-world name, but verify deterministic behavior:
      // first prefix in ALIAS_PREFIXES wins (arra_ comes before muninn_).
      expect(resolveToolName('arra_muninn_x')).toBe('oracle_muninn_x');
    });
  });
});
