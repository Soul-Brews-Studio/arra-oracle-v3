import { disableGlobalPlugin, enableGlobalPlugin } from '../lib/config.ts';

const CORE_SERVER_PLUGINS = new Set([
  'health',
  'search',
  'knowledge',
  'concepts',
  'verify',
  'vector',
  'files',
  'indexer',
]);

function pluginName(value: string | undefined): string {
  if (!value) throw new Error('missing plugin name');
  if (!/^[a-z0-9-]+$/.test(value)) {
    throw new Error(`plugin name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(value)}`);
  }
  return value;
}

function printLists(config: { disabledPlugins?: string[]; enabledPlugins?: string[] }) {
  const disabled = config.disabledPlugins?.join(', ') || '(none)';
  const enabled = config.enabledPlugins?.join(', ') || '(none)';
  console.log(`Disabled server plugins: ${disabled}`);
  console.log(`Enabled server plugins: ${enabled}`);
}

export async function pluginsDisable(args: string[]): Promise<number> {
  try {
    const name = pluginName(args[0]);
    if (CORE_SERVER_PLUGINS.has(name)) {
      throw new Error(`Cannot disable core server plugin "${name}"`);
    }
    const loaded = disableGlobalPlugin(name);
    console.log(`disabled server plugin: ${name}`);
    console.log(`Config: ${loaded.path}`);
    printLists(loaded.config);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export async function pluginsEnable(args: string[]): Promise<number> {
  try {
    const name = pluginName(args[0]);
    const loaded = enableGlobalPlugin(name);
    console.log(`enabled server plugin: ${name}`);
    console.log(`Config: ${loaded.path}`);
    printLists(loaded.config);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
