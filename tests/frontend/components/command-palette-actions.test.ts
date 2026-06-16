import { describe, expect, test } from 'bun:test';
import { commandPaletteActions } from '../../../frontend/src/components/CommandPalette';

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
    ]));
  });

  test('keeps refresh as an action-only command', () => {
    const refresh = commandPaletteActions(() => {}).find((command) => command.id === 'refresh');
    expect(refresh?.href).toBeUndefined();
    expect(refresh?.onAction).toBeFunction();
  });
});
