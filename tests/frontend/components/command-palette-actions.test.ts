import { describe, expect, test } from 'bun:test';
import { commandPaletteActions, filterCommandPaletteActions } from '../../../frontend/src/components/CommandPalette';

describe('commandPaletteActions', () => {
  test('includes direct routes for unified plugin frontend surfaces', () => {
    const commands = commandPaletteActions(() => {});
    expect(commands.map((command) => [command.id, command.href])).toEqual(expect.arrayContaining([
      ['menu', '/menu'],
      ['plugins', '/plugins'],
      ['mcp', '/mcp'],
      ['status', '/status'],
      ['storage', '/storage'],
      ['vector', '/vector'],
      ['memory', '/memory'],
    ]));
  });

  test('keeps refresh as an action-only command', () => {
    const refresh = commandPaletteActions(() => {}).find((command) => command.id === 'refresh');
    expect(refresh?.href).toBeUndefined();
    expect(refresh?.onAction).toBeFunction();
  });

  test('filters commands by labels and descriptions', () => {
    const commands = commandPaletteActions(() => {});
    expect(filterCommandPaletteActions(commands, 'mcp').map((command) => command.id)).toEqual(['mcp']);
    expect(filterCommandPaletteActions(commands, 'heat-score').map((command) => command.id)).toEqual(['memory']);
    expect(filterCommandPaletteActions(commands, 'runtime').map((command) => command.id)).toEqual(['plugins', 'settings']);
    expect(filterCommandPaletteActions(commands, 'nope')).toEqual([]);
  });
});
