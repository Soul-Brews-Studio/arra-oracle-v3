import { describe, it, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ALL_TOOL_NAMES,
  applyToolEnvOverrides,
  getDisabledTools,
  getEnabledToolNames,
  loadToolGroupConfig,
  resolveToolConfigSource,
  type ToolGroupConfig,
} from '../tool-groups.ts';
import { configSources } from '../tool-config-source.ts';

const ALL_ON: ToolGroupConfig = {
  search: true, knowledge: true, session: true,
  forum: true, oracle: true, trace: true, standalone: true,
};

const ENV_KEYS = ['ORACLE_ENABLED_TOOLS', 'ORACLE_DISABLED_TOOLS'] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => void): void {
  const previous = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('ORACLE_ENABLED_TOOLS / ORACLE_DISABLED_TOOLS', () => {
  it('treats ORACLE_ENABLED_TOOLS as a strict allow-list', () => {
    withEnv({ ORACLE_ENABLED_TOOLS: 'oracle_search,oracle_read,oracle_list,oracle_stats' }, () => {
      const names = getEnabledToolNames(applyToolEnvOverrides(ALL_ON));
      expect(names.sort()).toEqual(['oracle_list', 'oracle_read', 'oracle_search', 'oracle_stats']);
    });
  });

  it('subtracts ORACLE_DISABLED_TOOLS from an otherwise full surface', () => {
    withEnv({ ORACLE_DISABLED_TOOLS: 'oracle_thread, oracle_threads,oracle_thread_read,oracle_thread_update' }, () => {
      const config = applyToolEnvOverrides(ALL_ON);
      const names = getEnabledToolNames(config);
      expect(names).not.toContain('oracle_thread');
      expect(names).not.toContain('oracle_thread_update');
      expect(names).toContain('oracle_search');
      expect(getDisabledTools(config).has('oracle_threads')).toBe(true);
    });
  });

  it('composes both variables, with the block list winning', () => {
    withEnv({ ORACLE_ENABLED_TOOLS: 'oracle_search,oracle_read', ORACLE_DISABLED_TOOLS: 'oracle_read' }, () => {
      expect(getEnabledToolNames(applyToolEnvOverrides(ALL_ON))).toEqual(['oracle_search']);
    });
  });

  it('can disable an always-on bridge tool from the environment', () => {
    withEnv({ ORACLE_DISABLED_TOOLS: 'oracle_mcp_call' }, () => {
      const config = applyToolEnvOverrides(ALL_ON);
      expect(getEnabledToolNames(config)).not.toContain('oracle_mcp_call');
      expect(getEnabledToolNames(config)).toContain('oracle_mcp_list_tools');
    });
  });

  it('normalizes the arra_ alias and ignores unknown names', () => {
    // `muninn_read` is now an unknown name, not an alias — retired in #2824, so it is
    // dropped exactly like `not_a_tool` rather than resolving to `oracle_read`.
    withEnv({ ORACLE_ENABLED_TOOLS: 'arra_search,muninn_read,not_a_tool' }, () => {
      expect(getEnabledToolNames(applyToolEnvOverrides(ALL_ON)).sort()).toEqual(['oracle_search']);
    });
  });

  it('ignores an exported-but-empty variable instead of wiping the surface', () => {
    withEnv({ ORACLE_ENABLED_TOOLS: '  , ,' }, () => {
      expect(getEnabledToolNames(applyToolEnvOverrides(ALL_ON))).toHaveLength(ALL_TOOL_NAMES.size);
    });
  });

  it('applies env overrides through loadToolGroupConfig, beating the config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tool-env-'));
    try {
      fs.writeFileSync(path.join(dir, 'arra.config.json'), JSON.stringify({ disabled_tools: [] }));
      withEnv({ ORACLE_DISABLED_TOOLS: 'oracle_search' }, () => {
        expect(getEnabledToolNames(loadToolGroupConfig(dir))).not.toContain('oracle_search');
      });
      withEnv({}, () => {
        expect(getEnabledToolNames(loadToolGroupConfig(dir))).toContain('oracle_search');
      });
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});

describe('resolveToolConfigSource', () => {
  it('always names a path the loader itself reads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tool-source-'));
    try {
      const candidates = configSources(dir).map((candidate) => candidate.path);
      expect(candidates).toContain(resolveToolConfigSource(dir).path);
      // The pre-#2822 writer targeted `<root>/.arra/config.json`, which is on no tier.
      expect(candidates).not.toContain(path.join(dir, '.arra', 'config.json'));
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('resolves to the repo-root file the loader will pick, and reads back what was written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tool-source-'));
    try {
      fs.writeFileSync(path.join(dir, 'arra.config.json'), JSON.stringify({ disabled_tools: ['oracle_search'] }));
      const resolved = resolveToolConfigSource(dir);
      expect(resolved.found).toBe(true);
      expect(resolved.path).toBe(path.join(dir, 'arra.config.json'));
      withEnv({}, () => {
        expect(loadToolGroupConfig(dir).disabled_tools).toEqual(['oracle_search']);
      });
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('skips a repo-root file that carries no tool-config key at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tool-source-'));
    try {
      fs.writeFileSync(path.join(dir, 'arra.config.json'), JSON.stringify({ unrelated: true }));
      expect(resolveToolConfigSource(dir).path).not.toBe(path.join(dir, 'arra.config.json'));
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});
