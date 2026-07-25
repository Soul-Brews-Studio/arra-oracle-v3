import { describe, it, expect } from 'bun:test';
import { resolveToolName, deprecatedAliasWarning, resolveInboundToolName } from '../index.ts';

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

  describe('deprecation warning (#2824 — muninn_* warns for one release, then goes)', () => {
    const collect = (name: string) => {
      const logs: string[] = [];
      const resolved = resolveInboundToolName(name, (m) => logs.push(m));
      return { resolved, logs };
    };

    it('still resolves muninn_* AND warns, naming the replacement', () => {
      const { resolved, logs } = collect('muninn_search');
      expect(resolved).toBe('oracle_search');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toBe(
        '[MCP] tool alias "muninn_search" is deprecated — use "oracle_search" (removal planned next release)',
      );
    });

    it('resolves arra_* with NO warning — arra_ is not deprecated', () => {
      const { resolved, logs } = collect('arra_search');
      expect(resolved).toBe('oracle_search');
      expect(logs).toEqual([]);
      expect(deprecatedAliasWarning('arra_search')).toBeNull();
    });

    it('stays silent when no rewrite happened', () => {
      // Nothing was aliased away, so there is nothing to migrate off of.
      for (const name of ['oracle_search', 'muninn_', 'not_muninn_thing', 'search', '']) {
        expect(deprecatedAliasWarning(name)).toBeNull();
        expect(collect(name).logs).toEqual([]);
      }
    });

    it('does not warn for arra_muninn_x — arra_ wins the prefix scan', () => {
      const { resolved, logs } = collect('arra_muninn_x');
      expect(resolved).toBe('oracle_muninn_x');
      expect(logs).toEqual([]);
    });

    it('warns on the trimmed name for padded muninn_* input', () => {
      expect(deprecatedAliasWarning('  muninn_oracle_search  ')).toBe(
        '[MCP] tool alias "muninn_oracle_search" is deprecated — use "oracle_search" (removal planned next release)',
      );
    });

    it('keeps resolveToolName itself pure — resolving never logs', () => {
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => void errors.push(args);
      try {
        expect(resolveToolName('muninn_search')).toBe('oracle_search');
      } finally {
        console.error = original;
      }
      expect(errors).toEqual([]);
    });
  });
});
