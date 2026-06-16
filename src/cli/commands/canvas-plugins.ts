import { findCanvasPlugin, listCanvasPlugins, type CanvasPluginKind } from '../../canvas/plugins.ts';

interface Options {
  json: boolean;
  kind?: CanvasPluginKind;
  id?: string;
}

function parseArgs(args: string[]): Options {
  const options: Options = { json: false };
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--kind') options.kind = args[++i] as CanvasPluginKind;
    else if (arg === '--id') options.id = args[++i];
    else if (arg) throw new Error(`unknown canvas-plugins option: ${arg}`);
  }
  return options;
}

function printTable(plugins: ReturnType<typeof listCanvasPlugins>): void {
  for (const plugin of plugins) {
    const target = `${plugin.path}?plugin=${plugin.query.plugin}`;
    console.log(`${plugin.id}\t${plugin.kind}\t${plugin.label}\t${target}`);
  }
}

export async function canvasPluginsCommand(args: string[]): Promise<number> {
  try {
    const options = parseArgs(args);
    const plugins = options.id
      ? [findCanvasPlugin(options.id)].filter(Boolean) as ReturnType<typeof listCanvasPlugins>
      : listCanvasPlugins(options.kind);
    if (options.json) console.log(JSON.stringify({ plugins, count: plugins.length }, null, 2));
    else printTable(plugins);
    return plugins.length || !options.id ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
