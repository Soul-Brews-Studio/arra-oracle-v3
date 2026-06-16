import { describe, expect, test } from 'bun:test';
import handler, { listSubcommands } from '../index.ts';

type Registry = {
  plugin: string;
  surface: string;
  cli: string;
  menu: string;
  api: string;
  commands: Array<{ name: string; help: string }>;
};

describe('maw arra dual-surface registry', () => {
  test('menu/API invoke returns the shared CLI command registry', async () => {
    const result = await handler({ source: 'api', args: {} });
    const body = JSON.parse(result.output ?? '{}') as Registry;

    expect(result.ok).toBe(true);
    expect(body).toMatchObject({ plugin: 'arra', surface: 'api', cli: 'arra', menu: '/plugins/arra', api: '/api/arra' });
    expect(body.commands.map(command => command.name)).toEqual(listSubcommands());
    expect(body.commands).toContainEqual(expect.objectContaining({ name: 'search', help: expect.stringContaining('search <q>') }));
    expect(body.commands).toContainEqual(expect.objectContaining({ name: 'serve', help: expect.stringContaining('serve') }));
  });

  test('empty CLI invoke still renders CLI usage for maw arra --help parity', async () => {
    const result = await handler({ source: 'cli', args: [] });

    expect(result).toMatchObject({ ok: false, error: 'usage' });
    expect(result.output).toContain('usage: maw arra <subcommand>');
  });
});
