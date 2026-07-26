import { describe, it, expect } from 'bun:test';
import { resolveToolName, deprecatedAliasWarning, resolveInboundToolName, retiredAliasNotice } from '../index.ts';

describe('resolveToolName — alias chain (arra_* → oracle_*; muninn_* retired)', () => {
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

  describe('muninn_* (briefly canonical #1172 → #1236, REMOVED #2824)', () => {
    /**
     * It no longer resolves. #2824's cycle: warn for one release (#2839), ship it
     * (v26.7.26-alpha.227 contains that commit), then remove — which is this.
     */
    it('no longer maps muninn_* to oracle_*', () => {
      for (const name of ['muninn_search', 'muninn_read', 'muninn_trace_chain']) {
        expect(resolveToolName(name)).toBe(name);
      }
    });

    it('says what to call instead, rather than failing silently', () => {
      /**
       * The reason #2824 required a deprecation release first: `resolveToolName` returns an
       * unmatched name unchanged, so the call dies later as a generic tool-not-found with
       * nothing pointing at the rename. Removal keeps a voice on the retired prefix.
       */
      expect(retiredAliasNotice('muninn_search')).toContain('was REMOVED');
      expect(retiredAliasNotice('muninn_search')).toContain('oracle_search');
    });

    it('resolveInboundToolName logs the notice and does not resolve', () => {
      const logs: string[] = [];
      const resolved = resolveInboundToolName('muninn_search', (m) => void logs.push(m));
      // Unchanged on purpose — resolving it anyway would make the removal cosmetic.
      expect(resolved).toBe('muninn_search');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('was REMOVED');
    });

    it('a bare muninn_ prefix has no replacement to name', () => {
      expect(retiredAliasNotice('muninn_')).toBeNull();
    });

    it('does not fire on a name that merely contains muninn_', () => {
      expect(retiredAliasNotice('not_muninn_thing')).toBeNull();
      expect(resolveToolName('not_muninn_thing')).toBe('not_muninn_thing');
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
      expect(resolveToolName('muninn_new_thing')).toBe('muninn_new_thing');
      expect(resolveToolName('arra_a_b_c_d')).toBe('oracle_a_b_c_d');
      expect(resolveToolName('muninn_a_b_c_d')).toBe('muninn_a_b_c_d');
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
      // muninn_ has completed the cycle; DEPRECATED_PREFIXES is empty, so nothing warns.
      expect(deprecatedAliasWarning('muninn_search')).toBeNull();
      expect(deprecatedAliasWarning('arra_search')).toBeNull();
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

    it('trims padded input before deciding on a retired alias', () => {
      expect(retiredAliasNotice('  muninn_oracle_search  ')).toContain('oracle_search');
    });

    it('keeps resolveToolName itself pure — resolving never logs', () => {
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => void errors.push(args);
      try {
        expect(resolveToolName('arra_search')).toBe('oracle_search');
      } finally {
        console.error = original;
      }
      expect(errors).toEqual([]);
    });
  });
});
